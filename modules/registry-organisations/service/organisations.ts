// The organisation record: list, read, create, update, delete, and the registered types. The service
// layer is the only way to change this data (CLAUDE.md rule 5): the routes call it, and so will the
// jobs and the migration tool. Every method takes the `actor` and checks the permission first.
import { Conflict, DomainError, Invalid, NotFound, z, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import { ids, type Db, type DbTx, type ModuleContext } from '@scorpion/kernel';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
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
import {
  ORG_TYPE_REGISTRY,
  ORG_USAGE_REGISTRY,
  type OrgTypeEntry,
  type OrgUsageEntry,
} from './registries.ts';

export const PERMISSION_READ = 'registry.organisations.organisation.read';
export const PERMISSION_MANAGE = 'registry.organisations.organisation.manage';

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
  /** Only for a reader who may see the contact point (sprint 1: an Admin; sprint 2 widens it). */
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
    // Sprint 1: the contact point and the audit columns are for administrators. Sprint 2 widens the
    // contact point (setting and managers); the columns stay Admin only (ADR-0033, field table).
    const admin = await deps.authz.can(actor, PERMISSION_MANAGE);
    return {
      ...summary(row),
      description: row.description,
      website: row.website,
      rorId: row.rorId,
      sameAs: row.sameAs,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ...(admin && {
        contactEmail: row.contactEmail,
        contactType: row.contactType,
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
        // By id and nothing else. Sprint 2 releases the logo here and sprint 3 removes the memberships.
        await tx.delete(organisation).where(eq(organisation.id, id));
        await ctx.events.emit('registry.organisation.deleted@1', {
          organisationId: id,
          type: current.type,
          actorId: actorId(actor),
        });
      });
    },

    async listTypes(actor, locale = 'en') {
      await deps.authz.require(actor, PERMISSION_READ);
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
    },
  };
}
