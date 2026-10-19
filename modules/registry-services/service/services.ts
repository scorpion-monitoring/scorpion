// The service record: list, read, create and the trusted reads. The service layer is the only way to
// change this data (CLAUDE.md rule 5): the routes call it, and so will the wizard, M8 and M13. Every
// method takes the `actor` and checks the permission first. A delegated route (`update`, the icon) carries
// the plain `…service.read` and the service decides with the policy `service.member` (ADR-0034, ADR-0036).
import {
  Conflict,
  Forbidden,
  Invalid,
  NotFound,
  z,
  type Actor,
  type FieldProblem,
} from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { BlobService } from '@scorpion/core-blob/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import type { Spdx, SpdxLicense } from '@scorpion/integrations';
import { ids, mountPath, type Db, type ModuleContext } from '@scorpion/kernel';
import type {
  OrganisationRecord,
  OrganisationsPublic,
  SchemaOrgProfile,
} from '@scorpion/registry-organisations/public';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { ResolvedConfig } from '../config/validate.ts';
import { fieldValue, service, serviceOrganisation, slugHistory } from '../db/schema.ts';
import { settingsSchema } from '../settings-schema.ts';
import { dotted, fieldKeysOfInput, validateBody, validatePatch, valueAt } from './body.ts';
import {
  createCatalogue,
  slugCondition,
  type CatalogueFacet,
  type CatalogueQuery,
  type CatalogueRow,
} from './catalogue.ts';
import { buildCreateSchema, type CreateSchema } from './create-schema.ts';
import { SlugTaken } from './errors.ts';
import type { PublicationMail } from './publication-mail.ts';
import {
  allows,
  editableFields,
  identityFieldsOf,
  requiredAccess,
  type Access,
  type AccessLevel,
} from './field-rules.ts';
import {
  BRAND_ROLE,
  OWNER_ROLE,
  PERMISSION_CREATE,
  PERMISSION_EDIT,
  PERMISSION_EDIT_IDENTITY,
  PERMISSION_MANAGE,
  PERMISSION_PUBLISH,
  PERMISSION_READ,
  PERMISSION_READ_CONTACT,
  PERMISSION_V1_READ,
  RESOURCE_TYPE,
} from './permissions.ts';
import type { MemberPolicy } from './policy.ts';
import {
  CATALOGUE_SORT_KEYS,
  FACET_EMPTY,
  type Choice,
  type ChoiceEnv,
  type FacetEntry,
  type FieldEnv,
  type FieldSchemaOrgProperty,
  type OrgRoleEntry,
  type ProfileContributorEntry,
} from './registries.ts';
import { toSchemaOrg, type Contribution, type ServiceProfile } from './schema-org.ts';

export {
  PERMISSION_CREATE,
  PERMISSION_EDIT,
  PERMISSION_EDIT_IDENTITY,
  PERMISSION_MANAGE,
  PERMISSION_PUBLISH,
  PERMISSION_READ,
  PERMISSION_READ_CONTACT,
  PERMISSION_V1_READ,
  RESOURCE_TYPE,
} from './permissions.ts';

/** The reference that keeps an icon alive in `core.blob`: owner, purpose, service. */
export const iconReference = (serviceId: string) => `registry.services:icon:${serviceId}`;

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
  /** The keys of the fields this caller may write (the same table the update checks). */
  editableFields: string[];
  /** What this caller may do now; the screens draw their buttons from it, never from a role. */
  allowedActions: ServiceAction[];
}

export type ServiceAction = 'edit' | 'publish' | 'unpublish';

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

/** An organisation on a public record. `public` is always true: an organisation of a public service is public (ADR-0036). */
export interface PublicOrganisationRef {
  id: string;
  name: string;
  public: true;
}

/**
 * What an anonymous reader gets of a public service (ADR-0036 part 2): a pinned list of fields, no contact
 * point, no audit column, no `published_*`, no configured value, no `editableFields`.
 */
export interface PublicServiceRecord {
  id: string;
  slug: string;
  name: string;
  /** Below the base path (`/api/internal/files/{hash}`); absent without an icon. */
  logoUrl?: string;
  description: string | null;
  url: string | null;
  sameAs: string[];
  license: string | null;
  stage: string;
  provider: PublicOrganisationRef;
  consortia: PublicOrganisationRef[];
}

/** A public service as another module's public page lists it. */
export interface PublicServiceLink {
  id: string;
  slug: string;
  name: string;
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

/**
 * A service as `GET /api/v1/services` returns it (ADR-0037 decision 9): the legacy `abbreviation`, `name`, `provider`,
 * `license`, `consortia` and `stage`, with `provider` and `consortia` as abbreviations, and what is added to them.
 * Never the contact point, the icon path, the configured values or an audit column.
 */
export interface ServiceV1 {
  id: string;
  /** The current slug. */
  abbreviation: string;
  name: string;
  /** The key of a term of the `stage` vocabulary. */
  stage: string;
  license: string | null;
  public: boolean;
  /** The abbreviation of the organisation with the owning role; `null` only for a record the roles do not describe. */
  provider: string | null;
  providerId: string | null;
  /** Abbreviations of the organisations with the role `consortium`, by name then id (`consortiaIds` in the same order). */
  consortia: string[];
  consortiaIds: string[];
  /**
   * The name of the service's KPI set: added to the row by the facet that declares `v1.field: 'category'`
   * (kpi.framework); `null` for a service without one and in a profile without such a module.
   */
  category: string | null;
}

export interface ServiceRecordV1 extends ServiceV1 {
  description: string | null;
  url: string | null;
  sameAs: string[];
}

/** The filters of `GET /api/v1/services`: abbreviations for the first two, catalogue values for the others. */
export interface ListV1Filter {
  services?: readonly string[] | undefined;
  providers?: readonly string[] | undefined;
  stage?: readonly string[] | undefined;
  license?: readonly string[] | undefined;
  /** Names of KPI sets (the `category` of the row), compared as the facet's `v1.keysOf` says. */
  category?: readonly string[] | undefined;
}

export const SORT_KEYS = CATALOGUE_SORT_KEYS;
export type SortKey = (typeof SORT_KEYS)[number];

/** The question of the catalogue: the search, the chosen facet values by facet id, the sort. */
export type ListFilter = CatalogueQuery;

export interface ServicesService {
  /**
   * The catalogue (ADR-0035): a page of services, filtered by the search and the facets, in the order
   * asked for (the sort key, then the id), and the number of services in all. A service is one row
   * whatever its number of consortia. `Invalid` (422) for a filter that names nothing.
   */
  list: (
    actor: Actor,
    filter: ListFilter,
    page: { page: number; pageSize: number },
    locale?: string,
  ) => Promise<{ services: CatalogueRow[]; total: number }>;
  /** The facets with the number of services per value, over the set the other facets and the search leave. */
  facets: (actor: Actor, filter: ListFilter, locale?: string) => Promise<CatalogueFacet[]>;
  /**
   * The services for a token (needs `registry.services.v1.read`), through the catalogue's query: by current slug
   * without case, then id; each service once; `total` counts the filtered set. `Invalid` (422) for an abbreviation
   * that names no service or provider and for a stage or licence that names nothing.
   */
  listV1: (
    actor: Actor,
    filter: ListV1Filter,
    page: { page: number; pageSize: number },
  ) => Promise<{ services: ServiceV1[]; total: number }>;
  /** One service for a token: `NotFound` for an unknown id and `Invalid` for one that is no UUID. */
  getV1: (actor: Actor, id: string) => Promise<ServiceRecordV1>;
  /** The Schema.org profile for a token: the profile of {@link schemaOrg} (never the contact point), the v1 permission. */
  schemaOrgV1: (actor: Actor, id: string) => Promise<ServiceProfile>;
  get: (actor: Actor, id: string) => Promise<ServiceView>;
  /** An old slug answers the current record with `redirectedFrom`. `NotFound` for a slug nobody had. */
  getBySlug: (actor: Actor, slug: string) => Promise<ServiceView>;
  /**
   * Needs `…service.create`, and an Admin or an approved member of the chosen provider (Decision 14).
   * `input` is the nested form object.
   */
  create: (actor: Actor, input: unknown) => Promise<ServiceView>;
  /**
   * Changes the named fields (a partial nested object; `null` clears an optional field). The route carries
   * the plain `…service.read`; this method is the authorization (ADR-0034, ADR-0036): 404, then 403 (the
   * request is refused whole when a field needs an access the caller lacks), then 422.
   */
  update: (actor: Actor, id: string, patch: unknown) => Promise<ServiceView>;
  /** Replaces the icon; the caller needs `…service.edit` on the service, checked before the file is stored. */
  setIcon: (actor: Actor, id: string, bytes: Uint8Array) => Promise<ServiceView>;
  clearIcon: (actor: Actor, id: string) => Promise<ServiceView>;
  /** Makes the service public or private; needs `…service.publish` (Reviewers and Admin). A no-op changes nothing. */
  setPublication: (
    actor: Actor,
    id: string,
    publication: { public: boolean },
  ) => Promise<ServiceView>;
  /**
   * The Schema.org `Service` profile for a signed-in reader; needs `…service.read`. Any service, private ones
   * included, and never the contact point.
   */
  schemaOrg: (actor: Actor, id: string) => Promise<ServiceProfile>;
  /**
   * The public record of a service by id or slug (an old slug works). `undefined` for a service that is not
   * public, for `allowPublic` off and for a ref nobody has: the caller answers all three alike. The flag is
   * read in the same statement as the record.
   */
  getPublicAsSystem: (ref: string) => Promise<PublicServiceRecord | undefined>;
  /** The profile of a public service; `undefined` exactly when {@link getPublicAsSystem} is. */
  schemaOrgPublicAsSystem: (ref: string) => Promise<ServiceProfile | undefined>;
  /** The public services an organisation is the provider or a consortium of, by name; empty with `allowPublic` off. */
  listPublicByOrganisationAsSystem: (organisationId: string) => Promise<PublicServiceLink[]>;
  /** The SPDX search for the licence field; needs `…service.read`. */
  searchLicences: (actor: Actor, query: string, limit?: number) => Promise<SpdxLicense[]>;
  listRoles: (actor: Actor, locale?: string) => Promise<RoleView[]>;
  /**
   * What the create wizard draws itself from: the steps, the fields with their widgets, one JSON Schema per
   * step, the limits and the registry data the widgets need. Needs `…service.create`, the permission of the
   * wizard. It holds nothing of any person or service; the server still judges every value of a create.
   */
  createSchema: (actor: Actor, locale?: string) => Promise<CreateSchema>;

  // Trusted reads for other modules (ADR-0015): no permission check, no caller named. A route that
  // uses one must check the permission itself.
  findByIdsAsSystem: (ids: readonly string[]) => Promise<ServiceRecord[]>;
  /** An old slug resolves too (without regard to case); `redirectedFrom` is then that old slug as it was stored. */
  findBySlugAsSystem: (
    slug: string,
  ) => Promise<(ServiceRecord & { redirectedFrom?: string }) | undefined>;
  listByOrganisationAsSystem: (organisationId: string, role?: string) => Promise<ServiceRecord[]>;
  existsAsSystem: (id: string) => Promise<boolean>;
  /**
   * Whether the user is an approved **manager** of the service's provider: the group that holds `service.edit-identity` in the policy
   * `service.member` (ADR-0036). A module whose own permission is scoped to a service uses it in its own `authz.resourcePolicy`
   * entry, so the rule is written once. `false` for an unknown service.
   */
  isProviderManagerAsSystem: (userId: string, serviceId: string) => Promise<boolean>;
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
  blob: Pick<BlobService, 'put' | 'setReference'>;
  settings: Pick<SettingsService, 'validateTerm' | 'listTerms'>;
  organisations: Pick<
    OrganisationsPublic,
    | 'findByIdsAsSystem'
    | 'findByAbbreviationAsSystem'
    | 'isManagerAsSystem'
    | 'listApprovedOrganisationIdsAsSystem'
    | 'toSchemaOrgAsSystem'
  >;
  spdx: Spdx;
  config: ResolvedConfig;
  roles: readonly OrgRoleEntry[];
  /** The notice to the provider on a publication; absent in a unit test that does not need it. */
  publicationMail?: PublicationMail;
  /** The entries of `service.profileContributor`. */
  contributors?: readonly ProfileContributorEntry[];
  /** The entries of `service.facet`; the catalogue is empty of facets without them. */
  facets?: readonly FacetEntry[];
  /** Whether the schema tells the wizard to offer the JSON console (never in production). Default: no. */
  devConsole?: boolean;
  /** The policy `service.member`; without it `isProviderManagerAsSystem` answers no. */
  memberPolicy?: Pick<MemberPolicy, 'allows'>;
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
  // Fields whose type stores the value itself, in the create transaction (ADR-0040 addendum).
  const moduleFields = deps.config.fields.filter((f) => f.field.storage.kind === 'module');
  const roleFields = deps.config.fields.filter((f) => f.field.storage.kind === 'organisations');

  /** An id that is no UUID is a bad request (422), never a database error (500). */
  function requireId(id: string): void {
    if (!z.uuid().safeParse(id).success) {
      throw new Invalid('The request is not valid.', [
        { in: 'path', path: 'id', message: 'The id must be a UUID.' },
      ]);
    }
  }

  /** What the registry calls the owning role, for a message ("provider"): the code does not spell it. */
  const ownerLabel = (roles.get(OWNER_ROLE)?.labels.en ?? 'owner').toLowerCase();
  const settingsNow = async () => settingsSchema.parse(await ctx.settings.get());
  // `editableFields` names what a patch may change: a field of the storage `module` is changed through its module's
  // own route, so the edit form does not draw it (and the patch refuses it).
  const fieldKeys = deps.config.fields
    .filter((resolved) => resolved.field.storage.kind !== 'module')
    .map((resolved) => resolved.field.key);

  /**
   * The contact point is shown to Admin and the provider's members always (the scoped `…service.read-contact`),
   * and to every other signed-in reader while `exposeContactPoint` is on.
   */
  async function canSeeContact(actor: Actor, id: string, exposed: boolean): Promise<boolean> {
    if (await deps.authz.can(actor, PERMISSION_READ_CONTACT, { type: RESOURCE_TYPE, id })) {
      return true;
    }
    return exposed;
  }

  /**
   * What the caller holds on this service: `edit` and `identity` as the scoped permissions say (an Admin
   * holds both everywhere, a manager of the provider both, a member `edit`). One function for the update,
   * the icon and `editableFields`, so the screens and the checks cannot disagree.
   */
  async function accessLevel(actor: Actor, id: string): Promise<AccessLevel> {
    const resource = { type: RESOURCE_TYPE, id };
    const [edit, identity] = await Promise.all([
      deps.authz.can(actor, PERMISSION_EDIT, resource),
      deps.authz.can(actor, PERMISSION_EDIT_IDENTITY, resource),
    ]);
    return { edit, identity };
  }

  /**
   * The check of a change to an existing service: `needed` against what the caller holds on it. Whoever
   * holds nothing gets the plain 403 (or 401), as for any other route. A caller who holds `edit` but asks
   * for the slug or the provider is told which fields they may not change, never their values, and nothing
   * is written (the request is refused whole). Returns what the caller holds.
   */
  async function requireAccess(
    actor: Actor,
    id: string,
    needed: readonly Access[],
    fields: readonly string[] = [],
  ): Promise<AccessLevel> {
    const level = await accessLevel(actor, id);
    if (allows(level, needed)) return level;
    if (!level.edit && !level.identity) {
      // Throws 401 or 403 as the pipeline would for a route without the permission.
      await deps.authz.require(
        actor,
        needed.includes('edit') ? PERMISSION_EDIT : PERMISSION_EDIT_IDENTITY,
        {
          type: RESOURCE_TYPE,
          id,
        },
      );
      throw new Forbidden();
    }
    if (!level.identity && needed.includes('identity')) {
      throw new Forbidden(
        `These fields can only be changed by a manager of the ${ownerLabel} or an administrator: ${identityFieldsOf(fields).join(', ')}.`,
      );
    }
    throw new Forbidden();
  }

  /** The row, or 404. `lock` holds it until the transaction ends. */
  async function load(reader: Pick<Db, 'select'>, id: string, lock = false): Promise<Row> {
    const query = reader.select().from(service).where(eq(service.id, id));
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new NotFound('There is no such service.');
    return row;
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

  const catalogue = createCatalogue({
    db,
    facets: deps.facets ?? [],
    organisationsOf,
    iconPath,
    env: (locale) => ({
      locale,
      async organisationNames(wanted) {
        const found = await deps.organisations.findByIdsAsSystem([...wanted]);
        return new Map(found.map((organisation) => [organisation.id, organisation.name]));
      },
      async termLabels(vocabulary) {
        const terms = await deps.settings.listTerms(vocabulary, { includeInactive: true, locale });
        return new Map(terms.map((term) => [term.key, term.label]));
      },
      findLicence: (id) => fieldEnv.findLicence(id),
    }),
  });

  async function views(actor: Actor, rows: readonly Row[]): Promise<ServiceView[]> {
    const wanted = rows.map((row) => row.id);
    const [organisations, values, admin, settings, canPublish] = await Promise.all([
      organisationsOf(wanted),
      valuesOf(wanted),
      deps.authz.can(actor, PERMISSION_MANAGE),
      settingsNow(),
      deps.authz.can(actor, PERMISSION_PUBLISH),
    ]);
    return Promise.all(
      rows.map(async (row): Promise<ServiceView> => {
        const [contact, level] = await Promise.all([
          canSeeContact(actor, row.id, settings.exposeContactPoint),
          accessLevel(actor, row.id),
        ]);
        const editable = editableFields(level, fieldKeys);
        const actions: ServiceAction[] = [];
        if (editable.length > 0) actions.push('edit');
        if (canPublish && !row.public && settings.allowPublic) actions.push('publish');
        if (canPublish && row.public) actions.push('unpublish');
        return {
          ...summary(row, organisations.get(row.id) ?? []),
          description: row.description,
          url: row.url,
          sameAs: row.sameAs,
          values: values.get(row.id) ?? {},
          ...(contact && { contactEmail: row.contactEmail, contactType: row.contactType }),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          ...(admin && { createdBy: row.createdBy, updatedBy: row.updatedBy }),
          editableFields: editable,
          allowedActions: actions,
        };
      }),
    );
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

  /**
   * The organisations of a create or a patch, checked: known, of a type the role accepts, within `min` and
   * `max`. With `partial` a role whose field the body did not name is left alone, and `null` empties one.
   */
  async function resolveLinks(
    values: Map<string, unknown>,
    partial = false,
  ): Promise<{ role: string; organisationId: string }[]> {
    const problems: FieldProblem[] = [];
    const wanted: { role: OrgRoleEntry; path: string; id: string }[] = [];
    for (const resolved of roleFields) {
      const storage = resolved.field.storage;
      if (storage.kind !== 'organisations') continue;
      if (partial && !values.has(resolved.field.key)) continue;
      const role = roles.get(storage.role)!;
      const raw = values.get(resolved.field.key) ?? undefined;
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

  /** The key of the configured icon field, for the event of an icon change. */
  const iconKey =
    deps.config.fields.find((resolved) => resolved.field.storage.kind === 'icon')?.field.key ??
    'icon';

  /**
   * Writes the new slug to the history (the old one stays there, so it keeps resolving and is never given
   * to another service). A slug of this service itself (a change of case, or a return to an old one) is
   * reused; a slug of another service is taken. The unique index on the history decides a race.
   */
  async function renameSlug(
    tx: Pick<Db, 'select' | 'insert' | 'update'>,
    current: Row,
    slug: string,
  ) {
    const [known] = await tx
      .select()
      .from(slugHistory)
      .where(sql`lower(${slugHistory.slug}) = lower(${slug})`);
    if (known && known.serviceId !== current.id) throw new SlugTaken();
    if (!known) {
      await tx.insert(slugHistory).values({ id: ids.uuidv7(), slug, serviceId: current.id });
    } else if (known.slug !== slug) {
      await tx.update(slugHistory).set({ slug }).where(eq(slugHistory.id, known.id));
    }
  }

  /** A caller who is not Admin may move a service only to an organisation they manage. */
  async function requireManagesNewProvider(
    actor: Actor,
    id: string,
    admin: boolean,
    links: readonly { role: string; organisationId: string }[],
  ): Promise<void> {
    if (admin) return;
    const moved = links.filter((link) => link.role === OWNER_ROLE);
    if (moved.length === 0) return;
    const [current] = await db
      .select({ organisationId: serviceOrganisation.organisationId })
      .from(serviceOrganisation)
      .where(and(eq(serviceOrganisation.serviceId, id), eq(serviceOrganisation.role, OWNER_ROLE)));
    for (const { organisationId } of moved) {
      if (organisationId === current?.organisationId) continue;
      const manages =
        actor.kind === 'user' &&
        (await deps.organisations.isManagerAsSystem(actor.userId, organisationId));
      if (!manages) {
        throw new Forbidden(
          `You can only move a service to an organisation you manage: ${ownerFieldKeys.join(', ')}.`,
        );
      }
    }
  }

  /** The organisations a user is an approved member of must include the provider the input names. */
  async function requireProviderMembership(actor: Actor, input: unknown): Promise<void> {
    if (actor.kind !== 'user') throw new Forbidden();
    const asked: string[] = [];
    for (const resolved of roleFields) {
      const storage = resolved.field.storage;
      if (storage.kind !== 'organisations' || storage.role !== OWNER_ROLE) continue;
      const raw =
        typeof input === 'object' && input !== null && !Array.isArray(input)
          ? valueAt(input as Record<string, unknown>, resolved.field.path)
          : undefined;
      for (const candidate of Array.isArray(raw) ? raw : [raw]) {
        if (typeof candidate === 'string' && z.uuid().safeParse(candidate).success) {
          asked.push(candidate);
        }
      }
    }
    if (asked.length === 0) return;
    const member = new Set(
      await deps.organisations.listApprovedOrganisationIdsAsSystem(actor.userId),
    );
    if (asked.some((id) => !member.has(id))) {
      throw new Forbidden(
        `You can only choose an organisation you are an approved member of: ${ownerFieldKeys.join(', ')}.`,
      );
    }
  }
  const ownerFieldKeys = roleFields
    .filter((r) => r.field.storage.kind === 'organisations' && r.field.storage.role === OWNER_ROLE)
    .map((r) => r.field.key);

  // ----- the profile and the public reads (ADR-0036 part 2) --------------------------------------------

  const contributors = [...(deps.contributors ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const schemaFields = deps.config.fields.flatMap((resolved) =>
    resolved.field.storage.kind === 'value' && resolved.field.schemaOrg !== undefined
      ? [
          {
            key: resolved.field.key,
            property: resolved.field.schemaOrg as FieldSchemaOrgProperty,
          },
        ]
      : [],
  );

  /** The profile of one service from its row, its links and its values; never the contact point. */
  async function profileOf(
    row: Row,
    links: readonly { role: string; id: string }[],
    values: Record<string, unknown>,
  ): Promise<ServiceProfile> {
    const profiles = new Map<string, SchemaOrgProfile>();
    for (const id of new Set(links.map((link) => link.id))) {
      const profile = await deps.organisations.toSchemaOrgAsSystem(id, { includeContact: false });
      if (profile) profiles.set(id, profile);
    }
    const organisations = links
      .filter((link) => profiles.has(link.id))
      .map((link) => ({ role: link.role, profile: profiles.get(link.id)! }))
      .sort(
        (a, b) =>
          roleOrder(a.role) - roleOrder(b.role) ||
          a.profile.name.localeCompare(b.profile.name) ||
          a.profile['@id'].localeCompare(b.profile['@id']),
      );
    const contributions: Contribution[] = [];
    for (const entry of contributors) {
      try {
        const properties = await entry.contribute(
          { id: row.id, slug: row.slug, name: row.name, values },
          { db },
        );
        contributions.push({ id: entry.id, properties });
      } catch (error) {
        // A broken contributor must not take the profile (and the public page) down with it.
        ctx.log.warn({ err: error, contributor: entry.id }, 'a profile contributor failed');
      }
    }
    const licence = row.license ? await deps.spdx.find(row.license) : undefined;
    return toSchemaOrg(
      {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        url: row.url,
        sameAs: row.sameAs,
        iconHash: row.iconHash,
        licenseId: licence?.id ?? null,
        values,
      },
      {
        origin: ctx.config.ORIGIN,
        basePath: base,
        organisations,
        contributors: contributions,
        fields: schemaFields,
        onRejected: (contributor, property) =>
          ctx.log.warn(
            { contributor, property },
            'a profile contributor offered a property that is not allowed',
          ),
      },
    );
  }

  /**
   * The row of a public service for an id or a slug (current or old), with its organisation links and its
   * configured values, in ONE statement: the flag, the record and the links come from one snapshot, so a
   * publication racing this read gives a complete record or nothing.
   */
  async function publicRow(ref: string) {
    if (!(await settingsNow()).allowPublic) return undefined;
    const text = ref.trim();
    if (text === '' || text.length > 200) return undefined;
    // The subselects name their tables outright: Drizzle leaves the table off a column of a single-table query,
    // and an unqualified `id` inside a subselect would be the subselect's own.
    const related = {
      links: sql<{ role: string; id: string }[]>`coalesce((
        select json_agg(json_build_object('role', so.role, 'id', so.organisation_id) order by so.id)
        from svc_service_organisation so where so.service_id = svc_service.id), '[]'::json)`,
      values: sql<Record<string, unknown>>`coalesce((
        select jsonb_object_agg(fv.field_key, fv.value)
        from svc_field_value fv where fv.service_id = svc_service.id), '{}'::jsonb)`,
    };
    if (z.uuid().safeParse(text).success) {
      const [hit] = await db
        .select({ row: service, ...related })
        .from(service)
        .where(and(eq(service.id, text), eq(service.public, true)));
      return hit;
    }
    const [hit] = await db
      .select({ row: service, ...related })
      .from(slugHistory)
      .innerJoin(service, eq(service.id, slugHistory.serviceId))
      .where(and(sql`lower(${slugHistory.slug}) = lower(${text})`, eq(service.public, true)));
    return hit;
  }

  /** The v1 row of a service: abbreviations for the legacy fields, ids beside them, the consortia only as the brand. */
  function v1Of(
    row: Pick<Row, 'id' | 'slug' | 'name' | 'stage' | 'license' | 'public'>,
    links: readonly ServiceOrganisation[],
    category: string | null,
  ): ServiceV1 {
    const owner = links.find((link) => link.role === OWNER_ROLE);
    const consortia = links.filter((link) => link.role === BRAND_ROLE);
    return {
      id: row.id,
      abbreviation: row.slug,
      name: row.name,
      stage: row.stage,
      license: row.license,
      public: row.public,
      provider: owner?.abbreviation ?? null,
      providerId: owner?.id ?? null,
      consortia: consortia.map((link) => link.abbreviation),
      consortiaIds: consortia.map((link) => link.id),
      category,
    };
  }

  /** The facet that adds `category` to the v1 rows, when a module contributes one. */
  const categoryFacet = (deps.facets ?? []).find((facet) => facet.v1?.field === 'category');
  const categoriesOf = async (ids: readonly string[]): Promise<Map<string, string | null>> =>
    categoryFacet?.v1 ? categoryFacet.v1.valuesOf(ids, db) : new Map();

  /** The profile of any service for a reader who passed their own permission check: never the contact point. */
  async function schemaOrgOf(id: string): Promise<ServiceProfile> {
    requireId(id);
    const row = await load(db, id);
    const [links, values] = await Promise.all([organisationsOf([id]), valuesOf([id])]);
    return profileOf(
      row,
      (links.get(id) ?? []).map(({ role, id: organisationId }) => ({ role, id: organisationId })),
      values.get(id) ?? {},
    );
  }

  return {
    async list(actor, filter, page, locale = 'en') {
      await deps.authz.require(actor, PERMISSION_READ);
      const { rows, total } = await catalogue.rows(filter, page, locale);
      return { services: rows, total };
    },

    async listV1(actor, filter, page) {
      await deps.authz.require(actor, PERMISSION_V1_READ);
      const problems: FieldProblem[] = [];
      for (const name of ['stage', 'license'] as const) {
        if (filter[name]?.includes(FACET_EMPTY)) {
          problems.push({
            in: 'query',
            path: name,
            message: `"${FACET_EMPTY}" is not a value of this filter.`,
          });
        }
      }
      if (filter.services) {
        const found = await db
          .select({ slug: service.slug })
          .from(service)
          .where(slugCondition(filter.services));
        const known = new Set(found.map((row) => row.slug.toLowerCase()));
        for (const slug of filter.services) {
          if (!known.has(slug.toLowerCase())) {
            problems.push({
              in: 'query',
              path: 'service',
              message: `"${slug.slice(0, 64)}" is not the abbreviation of a service.`,
            });
          }
        }
      }
      const providerIds: string[] = [];
      if (filter.providers) {
        const types = roles.get(OWNER_ROLE)?.orgTypes ?? [];
        for (const abbreviation of filter.providers) {
          let found: OrganisationRecord | undefined;
          for (const type of types) {
            found ??= await deps.organisations.findByAbbreviationAsSystem(type, abbreviation);
          }
          if (found) providerIds.push(found.id);
          else {
            problems.push({
              in: 'query',
              // The name of the filter is the key of the owning role, as the catalogue's facet of it is.
              path: OWNER_ROLE,
              message: `"${abbreviation.slice(0, 64)}" is not the abbreviation of a ${ownerLabel}.`,
            });
          }
        }
      }
      const categoryKeys: string[] = [];
      if (filter.category) {
        const keys = categoryFacet?.v1
          ? await categoryFacet.v1.keysOf(filter.category, db)
          : undefined;
        for (const name of filter.category) {
          const key = keys?.get(name);
          if (key !== undefined) categoryKeys.push(key);
          else
            problems.push({
              in: 'query',
              path: 'category',
              message: `"${name.slice(0, 64)}" is not the name of a KPI set.`,
            });
        }
      }
      if (problems.length > 0) throw new Invalid('The request is not valid.', problems);
      const filters: Record<string, readonly string[]> = {
        ...(categoryFacet && filter.category && { [categoryFacet.id]: categoryKeys }),
        ...(filter.providers && { provider: providerIds }),
        ...(filter.stage && { stage: filter.stage }),
        ...(filter.license && { license: filter.license }),
      };
      const { rows, total } = await catalogue.rows(
        { slugs: filter.services, filters, sort: 'slug' },
        page,
        'en',
      );
      const categories = await categoriesOf(rows.map((row) => row.id));
      return {
        services: rows.map((row) =>
          v1Of(
            row,
            row.provider ? [row.provider, ...row.consortia] : row.consortia,
            categories.get(row.id) ?? null,
          ),
        ),
        total,
      };
    },

    async getV1(actor, id) {
      await deps.authz.require(actor, PERMISSION_V1_READ);
      requireId(id);
      const row = await load(db, id);
      const links = (await organisationsOf([id])).get(id) ?? [];
      const category = (await categoriesOf([id])).get(id) ?? null;
      return {
        ...v1Of(row, links, category),
        description: row.description,
        url: row.url,
        sameAs: row.sameAs,
      };
    },

    async schemaOrgV1(actor, id) {
      await deps.authz.require(actor, PERMISSION_V1_READ);
      return schemaOrgOf(id);
    },

    async facets(actor, filter, locale = 'en') {
      await deps.authz.require(actor, PERMISSION_READ);
      return catalogue.facets(filter, locale);
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
      await deps.authz.require(actor, PERMISSION_CREATE);
      const admin = await deps.authz.can(actor, PERMISSION_MANAGE);
      // Admin creates for any provider; everybody else only for an organisation they are an approved member
      // of (Decision 14). Before the body is parsed, so a non-member learns nothing from a 422.
      if (!admin) await requireProviderMembership(actor, input);
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
          // A module's own storage: written here so the service and the value commit or roll back together.
          for (const resolved of moduleFields) {
            const value = values.get(resolved.field.key);
            if (value === undefined) continue;
            await resolved.type.store?.(tx, {
              serviceId: id,
              value,
              config: resolved.config,
              actorId: by,
            });
          }
          await ctx.events.emit('registry.service.created@1', {
            serviceId: id,
            by: admin ? 'admin' : 'member',
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

    async update(actor, id, input) {
      // The route carries `…service.read` (ADR-0034), so this method is the authorization: the id first (a
      // service is readable by every signed-in person, so 404 before 403 reveals nothing), then the access
      // the named fields need, then the input.
      await deps.authz.require(actor, PERMISSION_READ);
      requireId(id);
      await load(db, id);
      const named = fieldKeysOfInput(deps.config, input);
      const needed = requiredAccess(named);
      await requireAccess(actor, id, needed, named);
      const values = await validatePatch(deps.config, input, fieldEnv);
      const admin = await deps.authz.can(actor, PERMISSION_MANAGE);
      const links = await resolveLinks(values, true);
      // A move needs the new owner to be one the caller manages (Admin is never restricted).
      await requireManagesNewProvider(actor, id, admin, links);

      try {
        const row = await db.tx(async (tx) => {
          const current = await load(tx, id, true);
          const by = actorId(actor);
          const changed: string[] = [];

          // Columns: only the ones the patch names; the contact point is one thing (both parts or neither).
          const next: Record<string, unknown> = {};
          for (const resolved of columnFields) {
            if (resolved.field.storage.kind !== 'column') continue;
            if (!values.has(resolved.field.key)) continue;
            const column = resolved.field.storage.column;
            const value = values.get(resolved.field.key) ?? (column === 'sameAs' ? [] : null);
            if (JSON.stringify(current[column as keyof Row]) !== JSON.stringify(value)) {
              next[column] = value;
              changed.push(resolved.field.key);
            }
          }
          const after = { ...current, ...next };
          if ((after.contactEmail === null) !== (after.contactType === null)) {
            throw new Invalid('The request is not valid.', [
              {
                in: 'body',
                path: 'contact',
                message: 'A contact point needs both an address and a type, or neither.',
              },
            ]);
          }
          const slugChanged = 'slug' in next;
          if (slugChanged) await renameSlug(tx, current, next.slug as string);

          // Organisation links: replace the links of each role the patch names, by id and scoped to the service.
          const linkRows = await tx
            .select()
            .from(serviceOrganisation)
            .where(eq(serviceOrganisation.serviceId, id));
          for (const resolved of roleFields) {
            const storage = resolved.field.storage;
            if (storage.kind !== 'organisations' || !values.has(resolved.field.key)) continue;
            const had = linkRows.filter((l) => l.role === storage.role);
            const wantedIds = new Set(
              links.filter((l) => l.role === storage.role).map((l) => l.organisationId),
            );
            const hadIds = new Set(had.map((l) => l.organisationId));
            const gone = had.filter((l) => !wantedIds.has(l.organisationId));
            const added = [...wantedIds].filter((organisationId) => !hadIds.has(organisationId));
            if (gone.length === 0 && added.length === 0) continue;
            if (gone.length > 0) {
              await tx.delete(serviceOrganisation).where(
                and(
                  eq(serviceOrganisation.serviceId, id),
                  inArray(
                    serviceOrganisation.id,
                    gone.map((l) => l.id),
                  ),
                ),
              );
            }
            if (added.length > 0) {
              await tx.insert(serviceOrganisation).values(
                added.map((organisationId) => ({
                  id: ids.uuidv7(),
                  serviceId: id,
                  organisationId,
                  role: storage.role,
                })),
              );
            }
            changed.push(resolved.field.key);
          }

          // Configured fields that are not columns live in `svc_field_value`; null removes the row.
          const stored = await tx.select().from(fieldValue).where(eq(fieldValue.serviceId, id));
          for (const resolved of valueFields) {
            if (!values.has(resolved.field.key)) continue;
            const key = resolved.field.key;
            const before = stored.find((row) => row.fieldKey === key);
            const raw = values.get(key);
            if (raw === null) {
              if (!before) continue;
              await tx
                .delete(fieldValue)
                .where(and(eq(fieldValue.serviceId, id), eq(fieldValue.fieldKey, key)));
            } else {
              const mapped = resolved.type.toValue?.(raw, resolved.config) ?? raw;
              if (before && JSON.stringify(before.value) === JSON.stringify(mapped)) continue;
              await tx
                .insert(fieldValue)
                .values({ id: ids.uuidv7(), serviceId: id, fieldKey: key, value: mapped })
                .onConflictDoUpdate({
                  target: [fieldValue.serviceId, fieldValue.fieldKey],
                  set: { value: mapped, updatedAt: new Date() },
                });
            }
            changed.push(key);
          }

          if (changed.length === 0) return current; // nothing differs: no write, no event
          const [updated] = await tx
            .update(service)
            .set({ ...next, updatedAt: new Date(), updatedBy: by })
            .where(eq(service.id, id))
            .returning();
          // The names of the fields, never their values (a test checks the payload).
          await ctx.events.emit('registry.service.updated@1', {
            serviceId: id,
            fields: changed,
            by: admin ? 'admin' : needed.includes('identity') ? 'manager' : 'member',
            actorId: by,
          });
          if (slugChanged) {
            await ctx.events.emit('registry.service.slugChanged@1', { serviceId: id, actorId: by });
          }
          return updated!;
        });
        return (await views(actor, [row]))[0]!;
      } catch (error) {
        if (isSlugClash(error)) throw new SlugTaken();
        throw error;
      }
    },

    async setIcon(actor, id, bytes) {
      await deps.authz.require(actor, PERMISSION_READ);
      requireId(id);
      await load(db, id); // an unknown service stores no file either
      // The permission before the file is stored, so a caller without it leaves none behind.
      const level = await requireAccess(actor, id, ['edit'], ['icon']);
      const stored = await deps.blob.put(actor, bytes);
      const admin = await deps.authz.can(actor, PERMISSION_MANAGE);
      const row = await db.tx(async (tx) => {
        const current = await load(tx, id, true);
        if (current.iconBlobId === stored.id) return current; // the same image: nothing changes
        const [updated] = await tx
          .update(service)
          .set({
            iconBlobId: stored.id,
            iconHash: stored.hash,
            updatedAt: new Date(),
            updatedBy: actorId(actor),
          })
          .where(eq(service.id, id))
          .returning();
        // Releases the old file and holds the new one, inside this transaction: if the event cannot be
        // stored the reference and the columns roll back together.
        await deps.blob.setReference(iconReference(id), stored.id);
        await ctx.events.emit('registry.service.updated@1', {
          serviceId: id,
          fields: [iconKey],
          by: admin ? 'admin' : level.identity ? 'manager' : 'member',
          actorId: actorId(actor),
        });
        return updated!;
      });
      return (await views(actor, [row]))[0]!;
    },

    async clearIcon(actor, id) {
      await deps.authz.require(actor, PERMISSION_READ);
      requireId(id);
      await load(db, id);
      const level = await requireAccess(actor, id, ['edit'], ['icon']);
      const admin = await deps.authz.can(actor, PERMISSION_MANAGE);
      const row = await db.tx(async (tx) => {
        const current = await load(tx, id, true);
        if (!current.iconBlobId) throw new NotFound('The service has no icon.');
        const [updated] = await tx
          .update(service)
          .set({
            iconBlobId: null,
            iconHash: null,
            updatedAt: new Date(),
            updatedBy: actorId(actor),
          })
          .where(eq(service.id, id))
          .returning();
        await deps.blob.setReference(iconReference(id), null);
        await ctx.events.emit('registry.service.updated@1', {
          serviceId: id,
          fields: [iconKey],
          by: admin ? 'admin' : level.identity ? 'manager' : 'member',
          actorId: actorId(actor),
        });
        return updated!;
      });
      return (await views(actor, [row]))[0]!;
    },

    async setPublication(actor, id, publication) {
      await deps.authz.require(actor, PERMISSION_PUBLISH);
      requireId(id);
      await load(db, id);
      const by = actorId(actor);
      const row = await db.tx(async (tx) => {
        // The row lock serialises two publications: the second sees the state the first left.
        const current = await load(tx, id, true);
        if (current.public === publication.public) return current; // a no-op: no write, no event
        if (publication.public && !(await settingsNow()).allowPublic) {
          throw new Conflict('Public services are switched off on this instance.');
        }
        const now = new Date();
        const [updated] = await tx
          .update(service)
          .set(
            publication.public
              ? { public: true, publishedAt: now, publishedBy: by }
              : { public: false, publishedAt: null, publishedBy: null },
          )
          .where(eq(service.id, id))
          .returning();
        await ctx.events.emit(
          publication.public ? 'registry.service.published@1' : 'registry.service.unpublished@1',
          { serviceId: id, actorId: by },
        );
        // The notice is in the same transaction: a rollback sends nothing.
        if (deps.publicationMail) {
          const [owner] = await tx
            .select({ organisationId: serviceOrganisation.organisationId })
            .from(serviceOrganisation)
            .where(
              and(eq(serviceOrganisation.serviceId, id), eq(serviceOrganisation.role, OWNER_ROLE)),
            );
          await deps.publicationMail.notify(tx, {
            serviceId: id,
            serviceName: updated!.name,
            providerId: owner?.organisationId,
            createdBy: updated!.createdBy,
            actorId: by,
            state: publication.public ? 'public' : 'private',
          });
        }
        return updated!;
      });
      return (await views(actor, [row]))[0]!;
    },

    async schemaOrg(actor, id) {
      await deps.authz.require(actor, PERMISSION_READ);
      return schemaOrgOf(id);
    },

    async getPublicAsSystem(ref) {
      const hit = await publicRow(ref);
      if (!hit) return undefined;
      const owner = hit.links.find((link) => link.role === OWNER_ROLE);
      if (!owner) return undefined; // cannot happen (`min: 1`); nothing to show without an owner
      const consortia = hit.links.filter((link) => link.role === BRAND_ROLE);
      const names = new Map(
        (await deps.organisations.findByIdsAsSystem([owner.id, ...consortia.map((c) => c.id)])).map(
          (organisation) => [organisation.id, organisation.name],
        ),
      );
      const reference = (id: string): PublicOrganisationRef => ({
        id,
        name: names.get(id) ?? '',
        public: true,
      });
      const { row } = hit;
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        ...(row.iconHash && { logoUrl: iconPath(row.iconHash) }),
        description: row.description,
        url: row.url,
        sameAs: row.sameAs,
        license: row.license,
        stage: row.stage,
        provider: reference(owner.id),
        consortia: consortia
          .map((c) => reference(c.id))
          .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      };
    },

    async schemaOrgPublicAsSystem(ref) {
      const hit = await publicRow(ref);
      return hit && profileOf(hit.row, hit.links, hit.values);
    },

    async listPublicByOrganisationAsSystem(organisationId) {
      if (!z.uuid().safeParse(organisationId).success) return [];
      if (!(await settingsNow()).allowPublic) return [];
      const rows = await db
        .selectDistinct({
          id: service.id,
          slug: service.slug,
          name: service.name,
          sortName: sql<string>`lower(${service.name})`,
        })
        .from(service)
        .innerJoin(serviceOrganisation, eq(serviceOrganisation.serviceId, service.id))
        .where(
          and(
            eq(service.public, true),
            eq(serviceOrganisation.organisationId, organisationId),
            inArray(serviceOrganisation.role, [OWNER_ROLE, BRAND_ROLE]),
          ),
        )
        .orderBy(asc(sql`lower(${service.name})`), asc(service.id));
      return rows.map(({ id, slug, name }) => ({ id, slug, name }));
    },

    async searchLicences(actor, query, limit) {
      await deps.authz.require(actor, PERMISSION_READ);
      return deps.spdx.search(query, limit === undefined ? undefined : { limit });
    },

    async createSchema(actor, locale = 'en') {
      await deps.authz.require(actor, PERMISSION_CREATE);
      const choices = new Map<string, Choice[]>();
      const env: ChoiceEnv = {
        async terms(vocabulary) {
          const terms = await deps.settings.listTerms(vocabulary, { locale });
          return terms.map((term) => ({ key: term.key, label: term.label }));
        },
      };
      for (const resolved of deps.config.fields) {
        if (resolved.type.choices) {
          choices.set(resolved.field.key, await resolved.type.choices(resolved.config, env));
        }
      }
      return buildCreateSchema(deps.config, deps.roles, {
        choices,
        locale,
        devConsole: deps.devConsole === true,
      });
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

    async isProviderManagerAsSystem(userId, serviceId) {
      if (!deps.memberPolicy || !z.uuid().safeParse(serviceId).success) return false;
      return deps.memberPolicy.allows({
        actor: { kind: 'user', userId, username: '', roles: [], via: 'session' },
        permission: PERMISSION_EDIT_IDENTITY,
        resource: { type: RESOURCE_TYPE, id: serviceId },
      });
    },

    async existsAsSystem(id) {
      if (!z.uuid().safeParse(id).success) return false;
      const [row] = await db.select({ id: service.id }).from(service).where(eq(service.id, id));
      return row !== undefined;
    },
  };
}
