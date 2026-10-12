// The service record: list, read, create and the trusted reads. The service layer is the only way to
// change this data (CLAUDE.md rule 5): the routes call it, and so will the wizard, M8 and M13. Every
// method takes the `actor` and checks the permission first. `update`, the icon and publication come in
// sprint 2 with the policy `service.member`.
import { Invalid, NotFound, z, type Actor, type FieldProblem } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import type { Spdx, SpdxLicense } from '@scorpion/integrations';
import { ids, mountPath, type Db, type ModuleContext } from '@scorpion/kernel';
import type { OrganisationRecord } from '@scorpion/registry-organisations/public';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { OrganisationsPublic } from '@scorpion/registry-organisations/public';
import type { ResolvedConfig } from '../config/validate.ts';
import { fieldValue, service, serviceOrganisation, slugHistory } from '../db/schema.ts';
import { settingsSchema } from '../settings-schema.ts';
import { validateBody, dotted } from './body.ts';
import { SlugTaken } from './errors.ts';
import { escapeLike } from './fields.ts';
import { PERMISSION_MANAGE, PERMISSION_READ } from './permissions.ts';
import type { FieldEnv, OrgRoleEntry } from './registries.ts';

export { PERMISSION_MANAGE, PERMISSION_READ, RESOURCE_TYPE } from './permissions.ts';

type Row = typeof service.$inferSelect;

/** An organisation on a service, with the role it plays. */
export interface ServiceOrganisation {
  role: string;
  id: string;
  abbreviation: string;
  name: string;
}

/** What a list shows: never the contact point, the description or the `sameAs` links. */
export interface ServiceSummary {
  id: string;
  slug: string;
  name: string;
  stage: string;
  license: string | null;
  /** The icon as a path below the base path (`/api/internal/files/{hash}`); absent without an icon. */
  iconUrl?: string;
  public: boolean;
  /** By the order of the roles, then the name. */
  organisations: ServiceOrganisation[];
}

export interface ServiceView extends ServiceSummary {
  description: string | null;
  url: string | null;
  sameAs: string[];
  /** The values of the configured fields that are stored in `svc_field_value`, by field key. */
  values: Record<string, unknown>;
  /** Only for a reader who may see the contact point (see `canSeeContact`). */
  contactEmail?: string | null;
  contactType?: string | null;
  /** Set when the slug asked for is an old one: the record answers under its current slug. */
  redirectedFrom?: string;
  createdAt: Date;
  updatedAt: Date;
  /** Only for an Admin. */
  createdBy?: string | null;
  updatedBy?: string | null;
}

/**
 * What a trusted caller (M8, M9, M13) gets: the stored descriptive fields and the organisation ids. No
 * contact point, no audit columns: a trusted read cannot leak what a service keeps from other readers.
 */
export interface ServiceRecord {
  id: string;
  slug: string;
  name: string;
  stage: string;
  license: string | null;
  description: string | null;
  url: string | null;
  sameAs: string[];
  iconUrl?: string;
  public: boolean;
  /** Organisation ids by role. */
  organisations: { role: string; id: string }[];
  values: Record<string, unknown>;
}

export interface RoleView {
  id: string;
  label: string;
  labels: { en: string; de?: string | undefined };
  orgTypes: string[];
  min: number;
  max: number;
  order: number;
}

export const SORT_KEYS = ['name', 'slug', 'stage'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface ListFilter {
  q?: string | undefined;
  sort?: SortKey | undefined;
  dir?: 'asc' | 'desc' | undefined;
}

export interface ServicesService {
  list: (
    actor: Actor,
    filter: ListFilter,
    page: { page: number; pageSize: number },
  ) => Promise<{ services: ServiceSummary[]; total: number }>;
  get: (actor: Actor, id: string) => Promise<ServiceView>;
  /** An old slug answers the current record with `redirectedFrom`. `NotFound` for a slug nobody had. */
  getBySlug: (actor: Actor, slug: string) => Promise<ServiceView>;
  /** Needs `…service.manage` in this sprint; the member rules arrive with the policy. `input` is the nested form object. */
  create: (actor: Actor, input: unknown) => Promise<ServiceView>;
  /** The SPDX search for the licence field; needs `…service.read`. */
  searchLicences: (actor: Actor, query: string, limit?: number) => Promise<SpdxLicense[]>;
  listRoles: (actor: Actor, locale?: string) => Promise<RoleView[]>;

  // Trusted reads for other modules (ADR-0015): no permission check, no caller named. A route that
  // uses one must check the permission itself.
  findByIdsAsSystem: (ids: readonly string[]) => Promise<ServiceRecord[]>;
  /** An old slug resolves too; `redirectedFrom` is then the slug that was asked for. */
  findBySlugAsSystem: (
    slug: string,
  ) => Promise<(ServiceRecord & { redirectedFrom?: string }) | undefined>;
  listByOrganisationAsSystem: (organisationId: string, role?: string) => Promise<ServiceRecord[]>;
  existsAsSystem: (id: string) => Promise<boolean>;
}

const CONSTRAINT_ERRORS = new Set(['svc_service_slug_idx', 'svc_slug_history_slug_idx']);

/** Whether `error` (or its cause) is a duplicate-key error on a slug index. */
function isSlugClash(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 4; depth++) {
    const err = e as { code?: string; constraint?: string; cause?: unknown };
    if (err.code === '23505' && err.constraint && CONSTRAINT_ERRORS.has(err.constraint))
      return true;
    e = err.cause;
  }
  return false;
}

export interface ServicesDeps {
  authz: Pick<AuthzService, 'require' | 'can'>;
  settings: Pick<SettingsService, 'validateTerm'>;
  organisations: Pick<OrganisationsPublic, 'findByIdsAsSystem'>;
  spdx: Spdx;
  config: ResolvedConfig;
  roles: readonly OrgRoleEntry[];
}

export function createServicesService(ctx: ModuleContext, deps: ServicesDeps): ServicesService {
  const db: Db = ctx.db;
  const roles = new Map(deps.roles.map((role) => [role.id, role]));
  const roleOrder = (id: string) => roles.get(id)?.order ?? Number.MAX_SAFE_INTEGER;
  const base = mountPath(ctx.config);
  const iconPath = (hash: string) => `${base}/api/internal/files/${hash}`;
  const actorId = (actor: Actor): string | null => (actor.kind === 'user' ? actor.userId : null);

  const fieldEnv: FieldEnv = {
    async vocabularyHas(vocabulary, key) {
      try {
        await deps.settings.validateTerm(vocabulary, key);
        return true;
      } catch (error) {
        if (error instanceof Invalid) return false;
        throw error;
      }
    },
    findLicence: (id) => deps.spdx.find(id),
  };

  const columnFields = deps.config.fields.filter((f) => f.field.storage.kind === 'column');
  const valueFields = deps.config.fields.filter((f) => f.field.storage.kind === 'value');
  const roleFields = deps.config.fields.filter((f) => f.field.storage.kind === 'organisations');

  /** An id that is no UUID is a bad request (422), never a database error (500). */
  function requireId(id: string): void {
    if (!z.uuid().safeParse(id).success) {
      throw new Invalid('The request is not valid.', [
        { in: 'path', path: 'id', message: 'The id must be a UUID.' },
      ]);
    }
  }

  /** Whoever holds `…service.manage` sees the contact point; every other reader follows the setting (sprint 2 adds the provider's members). */
  async function canSeeContact(actor: Actor): Promise<boolean> {
    if (await deps.authz.can(actor, PERMISSION_MANAGE)) return true;
    return settingsSchema.parse(await ctx.settings.get()).exposeContactPoint;
  }

  /** The organisation links of `serviceIds` with their names, two queries for any number of services. */
  async function organisationsOf(
    serviceIds: readonly string[],
  ): Promise<Map<string, ServiceOrganisation[]>> {
    const out = new Map<string, ServiceOrganisation[]>();
    if (serviceIds.length === 0) return out;
    const links = await db
      .select()
      .from(serviceOrganisation)
      .where(inArray(serviceOrganisation.serviceId, [...serviceIds]));
    const records = new Map(
      (
        await deps.organisations.findByIdsAsSystem([...new Set(links.map((l) => l.organisationId))])
      ).map((organisation) => [organisation.id, organisation]),
    );
    for (const link of links) {
      const organisation: OrganisationRecord | undefined = records.get(link.organisationId);
      const list = out.get(link.serviceId) ?? [];
      list.push({
        role: link.role,
        id: link.organisationId,
        abbreviation: organisation?.abbreviation ?? '',
        name: organisation?.name ?? '',
      });
      out.set(link.serviceId, list);
    }
    for (const list of out.values()) {
      list.sort(
        (a, b) =>
          roleOrder(a.role) - roleOrder(b.role) ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      );
    }
    return out;
  }

  async function valuesOf(
    serviceIds: readonly string[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const out = new Map<string, Record<string, unknown>>();
    if (serviceIds.length === 0) return out;
    const rows = await db
      .select()
      .from(fieldValue)
      .where(inArray(fieldValue.serviceId, [...serviceIds]));
    for (const row of rows) {
      const values = out.get(row.serviceId) ?? {};
      values[row.fieldKey] = row.value;
      out.set(row.serviceId, values);
    }
    return out;
  }

  const summary = (row: Row, organisations: ServiceOrganisation[]): ServiceSummary => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    stage: row.stage,
    license: row.license,
    ...(row.iconHash && { iconUrl: iconPath(row.iconHash) }),
    public: row.public,
    organisations,
  });

  async function views(actor: Actor, rows: readonly Row[]): Promise<ServiceView[]> {
    const wanted = rows.map((row) => row.id);
    const [organisations, values, contact, admin] = await Promise.all([
      organisationsOf(wanted),
      valuesOf(wanted),
      canSeeContact(actor),
      deps.authz.can(actor, PERMISSION_MANAGE),
    ]);
    return rows.map((row) => ({
      ...summary(row, organisations.get(row.id) ?? []),
      description: row.description,
      url: row.url,
      sameAs: row.sameAs,
      values: values.get(row.id) ?? {},
      ...(contact && { contactEmail: row.contactEmail, contactType: row.contactType }),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(admin && { createdBy: row.createdBy, updatedBy: row.updatedBy }),
    }));
  }

  async function records(rows: readonly Row[]): Promise<ServiceRecord[]> {
    const wanted = rows.map((row) => row.id);
    const [organisations, values] = await Promise.all([organisationsOf(wanted), valuesOf(wanted)]);
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      stage: row.stage,
      license: row.license,
      description: row.description,
      url: row.url,
      sameAs: row.sameAs,
      ...(row.iconHash && { iconUrl: iconPath(row.iconHash) }),
      public: row.public,
      organisations: (organisations.get(row.id) ?? []).map(({ role, id }) => ({ role, id })),
      values: values.get(row.id) ?? {},
    }));
  }

  /** The row for a slug, current or old, and the slug that matched. */
  async function bySlug(slug: string): Promise<{ row: Row; matched: string } | undefined> {
    const text = slug.trim();
    if (text === '' || text.length > 64) return undefined;
    const [hit] = await db
      .select({ row: service, matched: slugHistory.slug })
      .from(slugHistory)
      .innerJoin(service, eq(service.id, slugHistory.serviceId))
      .where(sql`lower(${slugHistory.slug}) = lower(${text})`);
    return hit ? { row: hit.row, matched: hit.matched } : undefined;
  }

  /** The organisations of a create, checked: known, of a type the role accepts, within `min` and `max`. */
  async function resolveLinks(
    values: Map<string, unknown>,
  ): Promise<{ role: string; organisationId: string }[]> {
    const problems: FieldProblem[] = [];
    const wanted: { role: OrgRoleEntry; path: string; id: string }[] = [];
    for (const resolved of roleFields) {
      const storage = resolved.field.storage;
      if (storage.kind !== 'organisations') continue;
      const role = roles.get(storage.role)!;
      const raw = values.get(resolved.field.key);
      const list =
        raw === undefined ? [] : Array.isArray(raw) ? (raw as string[]) : [raw as string];
      const unique = [...new Set(list)];
      if (unique.length < role.min || unique.length > role.max) {
        problems.push({
          in: 'body',
          path: dotted(resolved.field.path),
          message:
            role.min === role.max
              ? `Exactly ${role.min} ${role.min === 1 ? 'organisation is' : 'organisations are'} needed.`
              : `Between ${role.min} and ${role.max} organisations are needed.`,
        });
        continue;
      }
      unique.forEach((id, index) =>
        wanted.push({
          role,
          id,
          path: Array.isArray(raw)
            ? `${dotted(resolved.field.path)}.${index}`
            : dotted(resolved.field.path),
        }),
      );
    }
    const found = new Map(
      (await deps.organisations.findByIdsAsSystem([...new Set(wanted.map((w) => w.id))])).map(
        (organisation) => [organisation.id, organisation],
      ),
    );
    for (const { role, id, path } of wanted) {
      const organisation = found.get(id);
      if (!organisation) {
        problems.push({ in: 'body', path, message: 'This is not a known organisation.' });
      } else if (!role.orgTypes.includes(organisation.type)) {
        problems.push({
          in: 'body',
          path,
          message: `This organisation cannot take the role "${role.labels.en}".`,
        });
      }
    }
    if (problems.length > 0) throw new Invalid('The request is not valid.', problems);
    return wanted.map(({ role, id }) => ({ role: role.id, organisationId: id }));
  }

  return {
    async list(actor, filter, page) {
      await deps.authz.require(actor, PERMISSION_READ);
      const conditions: (SQL | undefined)[] = [];
      const q = filter.q?.trim();
      if (q) {
        const pattern = `%${escapeLike(q)}%`;
        conditions.push(
          sql`(${service.slug} ilike ${pattern} escape '\\' or ${service.name} ilike ${pattern} escape '\\')`,
        );
      }
      const where = and(...conditions);
      const key = filter.sort ?? 'name';
      const direction = filter.dir === 'desc' ? desc : asc;
      const sortColumn =
        key === 'slug'
          ? sql`lower(${service.slug})`
          : key === 'stage'
            ? service.stage
            : sql`lower(${service.name})`;
      const [rows, [count]] = await Promise.all([
        db
          .select()
          .from(service)
          .where(where)
          .orderBy(direction(sortColumn), asc(service.id))
          .limit(page.pageSize)
          .offset(page.page * page.pageSize),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(service)
          .where(where),
      ]);
      const organisations = await organisationsOf(rows.map((row) => row.id));
      return {
        services: rows.map((row) => summary(row, organisations.get(row.id) ?? [])),
        total: count?.total ?? 0,
      };
    },

    async get(actor, id) {
      await deps.authz.require(actor, PERMISSION_READ);
      requireId(id);
      const [row] = await db.select().from(service).where(eq(service.id, id));
      if (!row) throw new NotFound('There is no such service.');
      return (await views(actor, [row]))[0]!;
    },

    async getBySlug(actor, slug) {
      await deps.authz.require(actor, PERMISSION_READ);
      const hit = await bySlug(slug);
      if (!hit) throw new NotFound('There is no such service.');
      const view = (await views(actor, [hit.row]))[0]!;
      return hit.matched.toLowerCase() === hit.row.slug.toLowerCase()
        ? view
        : { ...view, redirectedFrom: hit.matched };
    },

    async create(actor, input) {
      await deps.authz.require(actor, PERMISSION_MANAGE); // sprint 2: members of the provider too
      const values = await validateBody(deps.config, input, fieldEnv);
      const links = await resolveLinks(values);
      const id = ids.uuidv7();
      const by = actorId(actor);

      // The row's columns come from the configured column fields; the rest of the row is set here.
      const columns: Record<string, unknown> = {};
      for (const resolved of columnFields) {
        if (resolved.field.storage.kind !== 'column') continue;
        const value = values.get(resolved.field.key);
        if (value !== undefined) columns[resolved.field.storage.column] = value;
      }
      let row: Row;
      try {
        row = await db.tx(async (tx) => {
          const [inserted] = await tx
            .insert(service)
            .values({
              ...(columns as Pick<typeof service.$inferInsert, 'slug' | 'name' | 'stage'>),
              id,
              createdBy: by,
              updatedBy: by,
            })
            .returning();
          // The slug history holds the current slug too, so one index decides whether a slug is free.
          await tx
            .insert(slugHistory)
            .values({ id: ids.uuidv7(), slug: inserted!.slug, serviceId: id });
          if (links.length > 0) {
            await tx.insert(serviceOrganisation).values(
              links.map((link) => ({
                id: ids.uuidv7(),
                serviceId: id,
                organisationId: link.organisationId,
                role: link.role,
              })),
            );
          }
          const stored = valueFields.flatMap((resolved) => {
            const value = values.get(resolved.field.key);
            if (value === undefined) return [];
            const mapped = resolved.type.toValue?.(value, resolved.config) ?? value;
            return [
              { id: ids.uuidv7(), serviceId: id, fieldKey: resolved.field.key, value: mapped },
            ];
          });
          if (stored.length > 0) await tx.insert(fieldValue).values(stored);
          await ctx.events.emit('registry.service.created@1', {
            serviceId: id,
            by: 'admin',
            actorId: by,
          });
          return inserted!;
        });
      } catch (error) {
        if (isSlugClash(error)) throw new SlugTaken();
        throw error;
      }
      return (await views(actor, [row]))[0]!;
    },

    async searchLicences(actor, query, limit) {
      await deps.authz.require(actor, PERMISSION_READ);
      return deps.spdx.search(query, limit === undefined ? undefined : { limit });
    },

    async listRoles(actor, locale = 'en') {
      await deps.authz.require(actor, PERMISSION_READ);
      return [...roles.values()]
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
        .map((role) => ({
          id: role.id,
          label: (role.labels as Record<string, string | undefined>)[locale] ?? role.labels.en,
          labels: role.labels,
          orgTypes: [...role.orgTypes],
          min: role.min,
          max: role.max,
          order: role.order,
        }));
    },

    async findByIdsAsSystem(wanted) {
      const valid = [...new Set(wanted)].filter((id) => z.uuid().safeParse(id).success);
      if (valid.length === 0) return [];
      const rows = await db
        .select()
        .from(service)
        .where(inArray(service.id, valid))
        .orderBy(asc(service.id));
      return records(rows);
    },

    async findBySlugAsSystem(slug) {
      const hit = await bySlug(slug);
      if (!hit) return undefined;
      const [record] = await records([hit.row]);
      return hit.matched.toLowerCase() === hit.row.slug.toLowerCase()
        ? record!
        : { ...record!, redirectedFrom: hit.matched };
    },

    async listByOrganisationAsSystem(organisationId, role) {
      if (!z.uuid().safeParse(organisationId).success) return [];
      const rows = await db
        .selectDistinct({ row: service })
        .from(service)
        .innerJoin(serviceOrganisation, eq(serviceOrganisation.serviceId, service.id))
        .where(
          and(
            eq(serviceOrganisation.organisationId, organisationId),
            role === undefined ? undefined : eq(serviceOrganisation.role, role),
          ),
        )
        .orderBy(asc(service.id));
      return records(rows.map((r) => r.row));
    },

    async existsAsSystem(id) {
      if (!z.uuid().safeParse(id).success) return false;
      const [row] = await db.select({ id: service.id }).from(service).where(eq(service.id, id));
      return row !== undefined;
    },
  };
}
