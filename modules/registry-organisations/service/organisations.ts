// The organisation record: list, read, create, update, delete, and the registered types. The service
// layer is the only way to change this data (CLAUDE.md rule 5): the routes call it, and so will the
// jobs and the migration tool. Every method takes the `actor` and checks the permission first.
import { Conflict, DomainError, Invalid, NotFound, z, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { BlobService } from '@scorpion/core-blob/public';
import { ids, mountPath, type Db, type DbTx, type ModuleContext } from '@scorpion/kernel';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { organisation } from '../db/schema.ts';
import { OrganisationInUse } from './errors.ts';
import { escapeLike } from './fields.ts';
import { fieldsOfBody, fieldsOfInput, requiredAccess, type Access } from './field-rules.ts';
import {
  createOrganisationSchema,
  parseInput,
  updateOrganisationSchema,
  type CreateOrganisationInput,
  type UpdateOrganisationInput,
} from './input.ts';
import { settingsSchema } from '../settings-schema.ts';
import { toSchemaOrg, type SchemaOrgProfile } from './schema-org.ts';
import {
  ORG_TYPE_REGISTRY,
  ORG_USAGE_REGISTRY,
  type OrgTypeEntry,
  type OrgUsageEntry,
} from './registries.ts';

export const PERMISSION_READ = 'registry.organisations.organisation.read';
export const PERMISSION_MANAGE = 'registry.organisations.organisation.manage';
/** Scoped to `organisation`: Admin everywhere; sprint 3 adds the managers of the organisation. */
export const PERMISSION_READ_CONTACT = 'registry.organisations.organisation.read-contact';
/** The resource type of the scoped permissions of this module. */
export const RESOURCE_TYPE = 'organisation';

/** The reference that keeps a logo alive in `core.blob`: owner, purpose, organisation. */
export const logoReference = (organisationId: string) =>
  `registry.organisations:logo:${organisationId}`;

type Row = typeof organisation.$inferSelect;

/** What a list shows: never the contact point or the `sameAs` links. */
export interface OrganisationSummary {
  id: string;
  type: string;
  /** False when the type is no longer registered (the module that contributed it left the profile). */
  typeKnown: boolean;
  abbreviation: string;
  name: string;
  memberCount: number;
}

export interface OrganisationView extends OrganisationSummary {
  description: string | null;
  website: string | null;
  rorId: string | null;
  sameAs: string[];
  /**
   * The logo as a path below the base path (`/api/internal/files/{hash}`); absent without a logo.
   * The file is public by its hash.
   */
  logoUrl?: string;
  /** Only for a reader who may see the contact point (see `canSeeContact`). */
  contactEmail?: string | null;
  contactType?: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Only for an Admin. */
  createdBy?: string | null;
  updatedBy?: string | null;
}

export interface TypeView {
  id: string;
  label: string;
  labels: { en: string; de?: string | undefined };
  membership: boolean;
  schemaType: string;
  order: number;
}

/**
 * What a trusted caller (M7, M8) gets: the descriptive fields. No contact point, no audit columns, no
 * logo hash: a trusted read cannot leak what an organisation keeps from other readers.
 */
export interface OrganisationRecord extends OrganisationSummary {
  description: string | null;
  website: string | null;
  rorId: string | null;
  sameAs: string[];
}

export interface ListFilter {
  q?: string | undefined;
  type?: string | undefined;
}

export interface OrganisationsService {
  list: (
    actor: Actor,
    filter: ListFilter,
    page: { page: number; pageSize: number },
  ) => Promise<{ organisations: OrganisationSummary[]; total: number }>;
  get: (actor: Actor, id: string) => Promise<OrganisationView>;
  create: (actor: Actor, input: CreateOrganisationInput) => Promise<OrganisationView>;
  update: (actor: Actor, id: string, input: UpdateOrganisationInput) => Promise<OrganisationView>;
  delete: (actor: Actor, id: string) => Promise<void>;
  listTypes: (actor: Actor, locale?: string) => Promise<TypeView[]>;
  /**
   * The Schema.org profile of an organisation for a reader: the contact point only when
   * `canSeeContact` says so. Needs `…organisation.read`.
   */
  schemaOrg: (actor: Actor, id: string) => Promise<SchemaOrgProfile>;
  /** Needs `…organisation.manage` (sprint 4: or `…organisation.edit`). `bytes` is the raw image. */
  setLogo: (actor: Actor, id: string, bytes: Uint8Array) => Promise<OrganisationView>;
  /** Needs `…organisation.manage`. `NotFound` when there is no logo. */
  clearLogo: (actor: Actor, id: string) => Promise<OrganisationView>;

  // Trusted reads for other modules (ADR-0015): no permission check, no caller named. A route that
  // uses one must check the permission itself.
  findByIdsAsSystem: (ids: readonly string[]) => Promise<OrganisationRecord[]>;
  findByAbbreviationAsSystem: (
    type: string,
    abbreviation: string,
  ) => Promise<OrganisationRecord | undefined>;
  existsAsSystem: (id: string) => Promise<boolean>;
  listTypesAsSystem: () => Promise<TypeView[]>;
  /** `undefined` for an unknown id. `includeContact` defaults to `false`: a trusted caller leaks nothing. */
  toSchemaOrgAsSystem: (
    id: string,
    options?: { includeContact?: boolean },
  ) => Promise<SchemaOrgProfile | undefined>;
}

const CONSTRAINT_FIELDS: Record<string, string> = {
  org_organisation_type_abbreviation_idx: 'abbreviation',
  org_organisation_type_name_idx: 'name',
  org_organisation_ror_id_idx: 'rorId',
};

/** The name of the violated unique constraint, if `error` (or its cause) is a duplicate-key error. */
function duplicateField(error: unknown): string | undefined {
  for (let e: unknown = error, depth = 0; e && depth < 4; depth++) {
    const err = e as { code?: string; constraint?: string; cause?: unknown };
    if (err.code === '23505' && err.constraint) return CONSTRAINT_FIELDS[err.constraint];
    e = err.cause;
  }
  return undefined;
}

class Duplicate extends DomainError {
  constructor(field: string) {
    super(409, 'Conflict', `An organisation with this ${field} already exists.`, [
      { in: 'body', path: field, message: `This ${field} is already taken.` },
    ]);
  }
}

export interface OrganisationsDeps {
  authz: Pick<AuthzService, 'require' | 'can'>;
  blob: Pick<BlobService, 'put' | 'setReference'>;
}

export function createOrganisationsService(
  ctx: ModuleContext,
  deps: OrganisationsDeps,
): OrganisationsService {
  const db: Db = ctx.db;

  /** The registered types by id. Two contributors for one id is a mistake the module refuses at start. */
  const types = new Map<string, OrgTypeEntry>();
  for (const entry of ctx.registry(ORG_TYPE_REGISTRY) as readonly OrgTypeEntry[]) {
    if (types.has(entry.id)) {
      throw new Error(
        `registry.organisations: the organisation type "${entry.id}" is contributed twice`,
      );
    }
    types.set(entry.id, entry);
  }
  const usages = ctx.registry(ORG_USAGE_REGISTRY) as readonly OrgUsageEntry[];

  const base = mountPath(ctx.config);
  const logoPath = (hash: string) => `${base}/api/internal/files/${hash}`;
  const record = (row: Row): OrganisationRecord => ({
    ...summary(row),
    description: row.description,
    website: row.website,
    rorId: row.rorId,
    sameAs: row.sameAs,
  });

  /**
   * Who sees the contact point (plan §6 item 6): whoever holds `…read-contact` on the organisation
   * (Admin now; sprint 3's policy adds its managers), and every other signed-in person while the
   * setting `organisation.exposeContactPoint` is on. The caller has passed `…organisation.read`.
   */
  async function canSeeContact(actor: Actor, id: string): Promise<boolean> {
    if (await deps.authz.can(actor, PERMISSION_READ_CONTACT, { type: RESOURCE_TYPE, id })) {
      return true;
    }
    return settingsSchema.parse(await ctx.settings.get()).exposeContactPoint;
  }

  const summary = (row: Row): OrganisationSummary => ({
    id: row.id,
    type: row.type,
    typeKnown: types.has(row.type),
    abbreviation: row.abbreviation,
    name: row.name,
    // The count comes from org_membership in sprint 3; until then nobody can be a member.
    memberCount: 0,
  });

  async function view(actor: Actor, row: Row): Promise<OrganisationView> {
    // The audit columns are for administrators; the contact point follows `canSeeContact`
    // (ADR-0033, field table).
    const [admin, contact] = await Promise.all([
      deps.authz.can(actor, PERMISSION_MANAGE),
      canSeeContact(actor, row.id),
    ]);
    return {
      ...summary(row),
      description: row.description,
      website: row.website,
      rorId: row.rorId,
      sameAs: row.sameAs,
      ...(row.logoHash && { logoUrl: logoPath(row.logoHash) }),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(contact && { contactEmail: row.contactEmail, contactType: row.contactType }),
      ...(admin && {
        createdBy: row.createdBy,
        updatedBy: row.updatedBy,
      }),
    };
  }

  function requireType(id: string): OrgTypeEntry {
    const entry = types.get(id);
    if (!entry) {
      throw new Invalid('The request is not valid.', [
        {
          in: 'body',
          path: 'type',
          message: `"${id.slice(0, 32)}" is not a registered organisation type.`,
        },
      ]);
    }
    return entry;
  }

  /** The module ids of the contributors that still count a reference. */
  async function usedBy(tx: DbTx, organisationId: string): Promise<string[]> {
    const used: string[] = [];
    for (const entry of usages)
      if ((await entry.count(tx, organisationId)) > 0) used.push(entry.id);
    return used;
  }

  function typeViews(locale: string): TypeView[] {
    return [...types.values()]
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((entry) => ({
        id: entry.id,
        label: (entry.labels as Record<string, string | undefined>)[locale] ?? entry.labels.en,
        labels: entry.labels,
        membership: entry.membership,
        schemaType: entry.schemaType,
        order: entry.order,
      }));
  }

  /** The profile of a row. A type that is no longer registered falls back to `Organization`. */
  function profile(row: Row, includeContact: boolean): SchemaOrgProfile {
    return toSchemaOrg(
      {
        id: row.id,
        schemaType: types.get(row.type)?.schemaType ?? 'Organization',
        abbreviation: row.abbreviation,
        name: row.name,
        description: row.description,
        website: row.website,
        rorId: row.rorId,
        sameAs: row.sameAs,
        logoHash: row.logoHash,
        contactEmail: row.contactEmail,
        contactType: row.contactType,
      },
      { origin: ctx.config.ORIGIN, basePath: base, includeContact },
    );
  }

  /** In sprints 1 to 3 both kinds of access need `manage`; sprint 4 lets the managers pass `edit`. */
  async function requireAccess(actor: Actor, access: Access): Promise<void> {
    // Both kinds need `manage` for now; the switch on `access` is what sprint 4 changes.
    void access;
    await deps.authz.require(actor, PERMISSION_MANAGE);
  }

  const actorId = (actor: Actor): string | null => (actor.kind === 'user' ? actor.userId : null);

  /** An id that is no UUID is a bad request (422), never a database error (500). */
  function requireId(id: string): void {
    if (!z.uuid().safeParse(id).success) {
      throw new Invalid('The request is not valid.', [
        { in: 'path', path: 'id', message: 'The id must be a UUID.' },
      ]);
    }
  }

  async function load(tx: Pick<DbTx, 'select'>, id: string, lock = false): Promise<Row> {
    const query = tx.select().from(organisation).where(eq(organisation.id, id));
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new NotFound('There is no such organisation.');
    return row;
  }

  return {
    async list(actor, filter, page) {
      await deps.authz.require(actor, PERMISSION_READ);
      const conditions: (SQL | undefined)[] = [];
      const q = filter.q?.trim();
      if (q) {
        const pattern = `%${escapeLike(q)}%`;
        conditions.push(
          sql`(${organisation.abbreviation} ilike ${pattern} escape '\\' or ${organisation.name} ilike ${pattern} escape '\\')`,
        );
      }
      if (filter.type) conditions.push(eq(organisation.type, filter.type));
      const where = and(...conditions);
      const [rows, [count]] = await Promise.all([
        db
          .select()
          .from(organisation)
          .where(where)
          .orderBy(
            sql`lower(${organisation.abbreviation})`,
            asc(organisation.abbreviation),
            asc(organisation.id),
          )
          .limit(page.pageSize)
          .offset(page.page * page.pageSize),
        db
          .select({ total: sql<number>`count(*)::int` })
          .from(organisation)
          .where(where),
      ]);
      return { organisations: rows.map(summary), total: count?.total ?? 0 };
    },

    async get(actor, id) {
      await deps.authz.require(actor, PERMISSION_READ);
      requireId(id);
      return view(actor, await load(db, id));
    },

    async create(actor, input) {
      await requireAccess(actor, 'admin'); // only an Admin creates
      const body = parseInput(createOrganisationSchema, input);
      requireType(body.type);
      const id = ids.uuidv7();
      let row: Row | undefined;
      try {
        row = await db.tx(async (tx) => {
          const [inserted] = await tx
            .insert(organisation)
            .values({
              id,
              type: body.type,
              abbreviation: body.abbreviation,
              name: body.name,
              description: body.description ?? null,
              website: body.website ?? null,
              rorId: body.rorId ?? null,
              sameAs: body.sameAs ?? [],
              contactEmail: body.contactEmail ?? null,
              contactType: body.contactType ?? null,
              createdBy: actorId(actor),
              updatedBy: actorId(actor),
            })
            .returning();
          await ctx.events.emit('registry.organisation.created@1', {
            organisationId: id,
            type: body.type,
            actorId: actorId(actor),
          });
          return inserted!;
        });
      } catch (error) {
        const field = duplicateField(error);
        if (field) throw new Duplicate(field);
        throw error;
      }
      return view(actor, row);
    },

    async update(actor, id, input) {
      // The permission first, so a caller without it learns nothing about the input or the id.
      await requireAccess(actor, requiredAccess(fieldsOfInput(input)));
      requireId(id);
      const body = parseInput(updateOrganisationSchema, input);
      try {
        const row = await db.tx(async (tx) => {
          const current = await load(tx, id, true);
          if (!types.has(current.type)) {
            throw new Conflict(
              `The organisation type "${current.type}" is not registered in this profile; the organisation cannot be changed until the module that contributes it is back.`,
            );
          }
          if (body.type !== undefined && body.type !== current.type) {
            requireType(body.type);
            const used = await usedBy(tx, id);
            if (used.length > 0) throw new OrganisationInUse(used);
          }
          const next = {
            type: body.type ?? current.type,
            abbreviation: body.abbreviation ?? current.abbreviation,
            name: body.name ?? current.name,
            description: body.description === undefined ? current.description : body.description,
            website: body.website === undefined ? current.website : body.website,
            rorId: body.rorId === undefined ? current.rorId : body.rorId,
            sameAs: body.sameAs ?? current.sameAs,
            contactEmail:
              body.contactEmail === undefined ? current.contactEmail : body.contactEmail,
            contactType: body.contactType === undefined ? current.contactType : body.contactType,
          };
          const changed = fieldsOfBody(
            Object.fromEntries(
              Object.entries(next).filter(([key, value]) => {
                const before = current[key as keyof Row];
                return JSON.stringify(before) !== JSON.stringify(value);
              }),
            ),
          );
          if (changed.length === 0) return current;
          const [updated] = await tx
            .update(organisation)
            .set({ ...next, updatedAt: new Date(), updatedBy: actorId(actor) })
            .where(eq(organisation.id, id))
            .returning();
          // The names of the fields, never their values (a test checks the payload).
          await ctx.events.emit('registry.organisation.updated@1', {
            organisationId: id,
            fields: changed,
            by: 'admin',
            actorId: actorId(actor),
          });
          return updated!;
        });
        return view(actor, row);
      } catch (error) {
        const field = duplicateField(error);
        if (field) throw new Duplicate(field);
        throw error;
      }
    },

    async delete(actor, id) {
      await requireAccess(actor, 'admin');
      requireId(id);
      await db.tx(async (tx) => {
        const current = await load(tx, id, true);
        const used = await usedBy(tx, id);
        if (used.length > 0) throw new OrganisationInUse(used);
        // By id and nothing else. The logo is released here, so a rollback keeps it; sprint 3 removes
        // the memberships in this transaction too.
        await tx.delete(organisation).where(eq(organisation.id, id));
        if (current.logoBlobId) await deps.blob.setReference(logoReference(id), null);
        await ctx.events.emit('registry.organisation.deleted@1', {
          organisationId: id,
          type: current.type,
          actorId: actorId(actor),
        });
      });
    },

    async listTypes(actor, locale = 'en') {
      await deps.authz.require(actor, PERMISSION_READ);
      return typeViews(locale);
    },

    async schemaOrg(actor, id) {
      await deps.authz.require(actor, PERMISSION_READ);
      requireId(id);
      const row = await load(db, id);
      return profile(row, await canSeeContact(actor, id));
    },

    async setLogo(actor, id, bytes) {
      // The permission first, so a caller without it leaves no file behind.
      await requireAccess(actor, 'edit');
      requireId(id);
      await load(db, id); // an unknown organisation stores no file either
      const stored = await deps.blob.put(actor, bytes);
      const row = await db.tx(async (tx) => {
        const current = await load(tx, id, true);
        if (current.logoBlobId === stored.id) return current; // the same image: nothing changes
        const [updated] = await tx
          .update(organisation)
          .set({
            logoBlobId: stored.id,
            logoHash: stored.hash,
            updatedAt: new Date(),
            updatedBy: actorId(actor),
          })
          .where(eq(organisation.id, id))
          .returning();
        // Releases the old file and holds the new one, inside this transaction: if the event cannot
        // be stored the reference and the columns roll back together.
        await deps.blob.setReference(logoReference(id), stored.id);
        await ctx.events.emit('registry.organisation.updated@1', {
          organisationId: id,
          fields: ['logo'],
          by: 'admin',
          actorId: actorId(actor),
        });
        return updated!;
      });
      return view(actor, row);
    },

    async clearLogo(actor, id) {
      await requireAccess(actor, 'edit');
      requireId(id);
      const row = await db.tx(async (tx) => {
        const current = await load(tx, id, true);
        if (!current.logoBlobId) throw new NotFound('The organisation has no logo.');
        const [updated] = await tx
          .update(organisation)
          .set({
            logoBlobId: null,
            logoHash: null,
            updatedAt: new Date(),
            updatedBy: actorId(actor),
          })
          .where(eq(organisation.id, id))
          .returning();
        await deps.blob.setReference(logoReference(id), null);
        await ctx.events.emit('registry.organisation.updated@1', {
          organisationId: id,
          fields: ['logo'],
          by: 'admin',
          actorId: actorId(actor),
        });
        return updated!;
      });
      return view(actor, row);
    },

    async findByIdsAsSystem(wanted) {
      const valid = [...new Set(wanted)].filter((id) => z.uuid().safeParse(id).success);
      if (valid.length === 0) return [];
      const rows = await db
        .select()
        .from(organisation)
        .where(inArray(organisation.id, valid))
        .orderBy(asc(organisation.id));
      return rows.map(record);
    },

    async findByAbbreviationAsSystem(type, abbreviation) {
      const [row] = await db
        .select()
        .from(organisation)
        .where(
          and(
            eq(organisation.type, type),
            sql`lower(${organisation.abbreviation}) = lower(${abbreviation})`,
          ),
        );
      return row && record(row);
    },

    async existsAsSystem(id) {
      if (!z.uuid().safeParse(id).success) return false;
      const [row] = await db
        .select({ id: organisation.id })
        .from(organisation)
        .where(eq(organisation.id, id));
      return row !== undefined;
    },

    async listTypesAsSystem() {
      return typeViews('en');
    },

    async toSchemaOrgAsSystem(id, options) {
      if (!z.uuid().safeParse(id).success) return undefined;
      const [row] = await db.select().from(organisation).where(eq(organisation.id, id));
      return row && profile(row, options?.includeContact ?? false);
    },
  };
}
