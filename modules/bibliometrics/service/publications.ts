// The publications of a service (ADR-0056): add by DOI, list with their metadata, remove by id. The one way to change
// `biblio_publication`; routes, the demo seed and (sprint 2) the job go through it.
//
// Adding checks the scoped write, normalises the DOI, refuses a duplicate with 409, and writes the row and its audit entry
// in one transaction. The metadata is then resolved in the request (decision 6) and written outside that transaction: it
// is a cache shared by every service that lists the DOI, and a slow or failing resolver keeps the publication with
// `failed` metadata instead of undoing it.
import {
  Conflict,
  Invalid,
  NotFound,
  type Actor,
  type FieldProblem,
  type PageQuery,
} from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import { normaliseDoi, type DoiResolver, type DoiResult } from '@scorpion/integrations';
import { ids, type AuditActor, type Db, type ModuleContext } from '@scorpion/kernel';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { doiMetadata, publication } from '../db/schema.ts';
import type { CitationService, ServiceCitations } from './citations.ts';
import { PERMISSION_READ, PERMISSION_WRITE, RESOURCE_SERVICE } from './permissions.ts';

/** Publications per page when the caller gives no size (FEATURES §3.12), and the most one page holds. */
export const DEFAULT_PAGE_SIZE = 5;
export const MAX_PAGE_SIZE = 50;

export type MetadataStatus = 'ok' | 'not-found' | 'failed';

/** What the DOI resolver said about the publication's DOI. */
export interface PublicationMetadata {
  status: MetadataStatus;
  /** Set when `status` is `ok`. */
  title: string | null;
  authors: string[];
  /** `2020`, `2020-09` or `2020-09-16`: as precise as the registration agency knows it. */
  issued: string | null;
  container: string | null;
  type: string | null;
  resolvedAt: Date;
}

export interface Publication {
  id: string;
  serviceId: string;
  /** Normalised: lower case, no `https://doi.org/` or `doi:` prefix. */
  doi: string;
  addedBy: string | null;
  addedAt: Date;
  /** `null` until the DOI has been looked up (lookups are off, see the setting `enabled`). */
  metadata: PublicationMetadata | null;
  /** The latest count of the citation source; `null` while it is unknown (never asked, not found, failed). Never a made-up 0. */
  citedByCount: number | null;
  /** When `citedByCount` was taken; `null` with it. */
  citationsAsOf: Date | null;
}

export interface PublicationPage {
  totalCount: number;
  items: Publication[];
  /** The citations of the whole service (every page), and over how many publications they are taken. */
  citations: ServiceCitations;
  /**
   * Whether the caller holds `bibliometrics.publication.write` on this service (add, remove, "check now"). The page shows its
   * controls only then; the write itself checks again.
   */
  canEdit: boolean;
}

export interface PublicationsService {
  /**
   * Adds a publication to a service. Needs `bibliometrics.publication.write` on the service (Admin, or an approved member
   * of its provider); the order of the answers is 401, 403, 404 (no such service), 422 (not a DOI), 409 (the service lists
   * the DOI already). The metadata is looked up before the answer, unless a lookup of the DOI already succeeded.
   */
  add(actor: Actor, serviceId: string, doi: unknown): Promise<Publication>;
  /**
   * The publications of a service, newest `issued` first (unknown dates last), then by id. Needs the plain
   * `bibliometrics.publication.read`; 404 for an unknown service.
   */
  list(actor: Actor, serviceId: string, page: PageQuery): Promise<PublicationPage>;
  /**
   * Removes a publication of the service, by id. Needs the scoped write; 404 when the service does not exist or the
   * publication is not one of **this** service's (a publication of another service is never touched). The DOI's metadata
   * stays: other services may list the DOI.
   */
  remove(actor: Actor, serviceId: string, publicationId: string): Promise<void>;
}

export interface PublicationsDeps {
  authz: Pick<AuthzService, 'require' | 'can'>;
  services: Pick<ServicesPublic, 'existsAsSystem'>;
  resolver: DoiResolver;
  /** The setting `enabled`: off, no DOI is looked up. */
  lookupsEnabled: () => Promise<boolean>;
  /** The citation counts the list shows. */
  citations: Pick<CitationService, 'latest' | 'serviceTotal'>;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const problem = (
  path: string,
  message: string,
  where: FieldProblem['in'] = 'body',
): FieldProblem => ({
  in: where,
  path,
  message,
});

/** The Postgres error code of a unique violation, looking through wrapped causes. */
function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 4; depth++) {
    const err = e as { code?: string; cause?: unknown };
    if (err.code === '23505') return true;
    e = err.cause;
  }
  return false;
}

function auditActor(actor: Actor): AuditActor {
  if (actor.kind !== 'user') return { kind: 'anonymous' };
  return actor.via === 'token'
    ? { kind: 'token', userId: actor.userId, tokenId: actor.tokenId ?? null }
    : { kind: 'user', userId: actor.userId };
}

type MetadataRow = typeof doiMetadata.$inferSelect;

/** `issued` as stored (the first day of its period) back to the precision it has. */
function issuedOf(row: Pick<MetadataRow, 'issued' | 'issuedPrecision'>): string | null {
  if (!row.issued) return null;
  if (row.issuedPrecision === 'year') return row.issued.slice(0, 4);
  if (row.issuedPrecision === 'month') return row.issued.slice(0, 7);
  return row.issued;
}

function metadataOut(row: MetadataRow | null): PublicationMetadata | null {
  if (!row) return null;
  return {
    status: row.status as MetadataStatus,
    title: row.title,
    authors: Array.isArray(row.authors) ? (row.authors as string[]) : [],
    issued: issuedOf(row),
    container: row.container,
    type: row.type,
    resolvedAt: row.resolvedAt,
  };
}

/** The row to store for a resolver's answer. */
function metadataRow(doi: string, result: DoiResult): typeof doiMetadata.$inferInsert {
  const empty = {
    doi,
    reason: null,
    title: null,
    authors: [],
    issued: null,
    issuedPrecision: null,
    container: null,
    type: null,
  };
  if (result.status === 'not-found') return { ...empty, status: 'not-found' };
  if (result.status === 'failed') return { ...empty, status: 'failed', reason: result.reason };
  const { metadata } = result;
  const issued = metadata.issued;
  return {
    doi,
    status: 'ok',
    reason: null,
    title: metadata.title,
    authors: metadata.authors,
    issued: issued
      ? issued.precision === 'year'
        ? `${issued.date}-01-01`
        : issued.precision === 'month'
          ? `${issued.date}-01`
          : issued.date
      : null,
    issuedPrecision: issued?.precision ?? null,
    container: metadata.container,
    type: metadata.type,
  };
}

/** The cache of DOI metadata: read a row, or look a DOI up and store the answer. Shared by `add` and the weekly retry. */
export interface MetadataStore {
  stored(doi: string): Promise<MetadataRow | null>;
  /** Looks the DOI up and stores the answer. A lookup that throws counts as failed; this never throws. */
  resolveAndStore(doi: string, options?: { signal?: AbortSignal }): Promise<MetadataRow | null>;
}

export function createMetadataStore(
  ctx: Pick<ModuleContext, 'db' | 'log'>,
  resolver: DoiResolver,
): MetadataStore {
  const db: Db = ctx.db;
  async function storedMetadata(doi: string): Promise<MetadataRow | null> {
    const [row] = await db.select().from(doiMetadata).where(eq(doiMetadata.doi, doi));
    return row ?? null;
  }

  async function resolveAndStore(
    doi: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<MetadataRow | null> {
    let result: DoiResult;
    try {
      result = await resolver.resolve(doi, options);
    } catch {
      result = { status: 'failed', reason: 'network' };
    }
    if (result.status === 'failed')
      ctx.log.warn({ doi, reason: result.reason }, 'bibliometrics: the DOI lookup failed');
    const row = metadataRow(doi, result);
    const update = { ...row, doi: undefined };
    try {
      const [stored] = await db
        .insert(doiMetadata)
        .values(row)
        .onConflictDoUpdate({
          target: doiMetadata.doi,
          set: { ...update, resolvedAt: sql`now()` },
          // A failed lookup never replaces a good answer that another request stored meanwhile.
          setWhere: sql`${doiMetadata.status} <> 'ok' or excluded.status = 'ok'`,
        })
        .returning();
      return stored ?? (await storedMetadata(doi));
    } catch (error) {
      ctx.log.warn({ doi, err: error }, 'bibliometrics: the DOI metadata could not be stored');
      return storedMetadata(doi);
    }
  }

  return { stored: storedMetadata, resolveAndStore };
}

export function createPublicationsService(
  ctx: Pick<ModuleContext, 'db' | 'log' | 'audit'>,
  deps: PublicationsDeps,
): PublicationsService {
  const db: Db = ctx.db;

  async function serviceMustExist(serviceId: string): Promise<void> {
    if (!uuidPattern.test(serviceId))
      throw new Invalid('The request is not valid.', [
        problem('serviceId', 'must be the id of a service', 'path'),
      ]);
    if (!(await deps.services.existsAsSystem(serviceId.toLowerCase())))
      throw new NotFound('There is no such service.');
  }

  const metadata = createMetadataStore(ctx, deps.resolver);

  return {
    async add(actor, serviceId, rawDoi) {
      await deps.authz.require(actor, PERMISSION_WRITE, { type: RESOURCE_SERVICE, id: serviceId });
      await serviceMustExist(serviceId);
      const service = serviceId.toLowerCase();
      const checked = normaliseDoi(rawDoi);
      if (!checked.ok)
        throw new Invalid('The DOI is not valid.', [problem('doi', checked.problem)]);
      const doi = checked.doi;

      const [existing] = await db
        .select({ id: publication.id })
        .from(publication)
        .where(and(eq(publication.serviceId, service), eq(publication.doi, doi)));
      const duplicate = (id: string | undefined) =>
        new Conflict(
          `This service lists the DOI ${doi} already${id ? ` (publication ${id})` : ''}.`,
        );
      if (existing) throw duplicate(existing.id);

      const addedBy = actor.kind === 'user' ? actor.userId : null;
      let row: typeof publication.$inferSelect;
      try {
        row = await db.tx(async (tx) => {
          const [inserted] = await tx
            .insert(publication)
            .values({ id: ids.uuidv7(), serviceId: service, doi, addedBy })
            .returning();
          await ctx.audit({
            action: 'bibliometrics.publication.added',
            outcome: 'ok',
            actor: auditActor(actor),
            subject: { type: 'bibliometrics.publication', id: inserted!.id },
            payload: { serviceId: service, doi },
          });
          return inserted!;
        });
      } catch (error) {
        // Two adds of the same DOI at once: the second meets the unique key.
        if (isUniqueViolation(error)) throw duplicate(undefined);
        throw error;
      }

      let stored = await metadata.stored(doi);
      if (stored?.status !== 'ok' && (await deps.lookupsEnabled()))
        stored = await metadata.resolveAndStore(doi);
      // Another service may list the DOI already, and its count is the DOI's.
      const known = (await deps.citations.latest([doi])).counts.get(doi);
      return {
        ...row,
        metadata: metadataOut(stored),
        citedByCount: known?.citedByCount ?? null,
        citationsAsOf: known?.takenAt ?? null,
      };
    },

    async list(actor, serviceId, page) {
      await deps.authz.require(actor, PERMISSION_READ);
      await serviceMustExist(serviceId);
      const service = serviceId.toLowerCase();
      const where = eq(publication.serviceId, service);
      const [total] = await db.select({ n: count() }).from(publication).where(where);
      const rows = await db
        .select({ publication, metadata: doiMetadata })
        .from(publication)
        .leftJoin(doiMetadata, eq(doiMetadata.doi, publication.doi))
        .where(where)
        .orderBy(sql`${doiMetadata.issued} desc nulls last`, asc(publication.id))
        .limit(page.pageSize)
        .offset(page.page * page.pageSize);
      const { counts } = await deps.citations.latest(rows.map((r) => r.publication.doi));
      return {
        totalCount: total?.n ?? 0,
        items: rows.map((r) => {
          const known = counts.get(r.publication.doi);
          return {
            ...r.publication,
            metadata: metadataOut(r.metadata),
            citedByCount: known?.citedByCount ?? null,
            citationsAsOf: known?.takenAt ?? null,
          };
        }),
        citations: await deps.citations.serviceTotal(service),
        canEdit: await deps.authz.can(actor, PERMISSION_WRITE, {
          type: RESOURCE_SERVICE,
          id: service,
        }),
      };
    },

    async remove(actor, serviceId, publicationId) {
      await deps.authz.require(actor, PERMISSION_WRITE, { type: RESOURCE_SERVICE, id: serviceId });
      await serviceMustExist(serviceId);
      const service = serviceId.toLowerCase();
      if (!uuidPattern.test(publicationId))
        throw new Invalid('The request is not valid.', [
          problem('publicationId', 'must be the id of a publication', 'path'),
        ]);
      await db.tx(async (tx) => {
        const [removed] = await tx
          .delete(publication)
          .where(
            and(
              eq(publication.id, publicationId.toLowerCase()),
              eq(publication.serviceId, service),
            ),
          )
          .returning({ id: publication.id, doi: publication.doi });
        if (!removed) throw new NotFound('This service has no such publication.');
        await ctx.audit({
          action: 'bibliometrics.publication.removed',
          outcome: 'ok',
          actor: auditActor(actor),
          subject: { type: 'bibliometrics.publication', id: removed.id },
          payload: { serviceId: service, doi: removed.doi },
        });
      });
    },
  };
}
