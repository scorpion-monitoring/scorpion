// The citation counts of the publications (ADR-0056, plan §4): the refresh that asks every citation source that is on, the
// "check now" of one service, the history of a publication and the counts the list shows. The one way to change
// `biblio_citation_run` and `biblio_citation_snapshot`; the job and the routes go through it.
//
// A missing number is never a zero (decision 5): a DOI a source does not know, a failed batch and a source that is off have
// no snapshot, and the reads say `null`. Snapshots belong to the DOI, so a DOI that two services list is asked once.
import { DomainError, NotFound, Conflict, Invalid, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import { ids, type Db, type ModuleContext } from '@scorpion/kernel';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { citationRun, citationSnapshot, doiMetadata, publication } from '../db/schema.ts';
import type { BibliometricsSettings } from '../settings-schema.ts';
import { PERMISSION_READ, PERMISSION_WRITE, RESOURCE_SERVICE } from './permissions.ts';
import type { MetadataStore } from './publications.ts';
import { kpiOff, writeKpi, type KpiReport, type KpiWriteDeps } from './kpi-write.ts';
import { SOURCE_BATCH_SIZE, type CitationSourceEntry, type SourceCounts } from './sources.ts';

export const REFRESH_JOB = 'bibliometrics.citations.refresh';
export const CITATIONS_UPDATED_EVENT = 'bibliometrics.citations.updated@1';
/** The most DOIs one run of the job handles; the next slice is queued. Also the most services one event names. */
export const SLICE_SIZE = 2000;
/** "Check now" is refused for this long after the last manual refresh of the service. */
export const MANUAL_COOLDOWN_SECONDS = 600;
/** The most points the history of a publication has: ten years of weeks. */
export const HISTORY_MAX_POINTS = 520;
/** The most DOIs whose metadata one slice looks up again (each lookup may take up to 5 s). */
export const METADATA_RETRIES_PER_SLICE = 200;

export type RefreshTrigger = 'schedule' | 'manual';

/** 429 from the service: "check now" was used for this service less than ten minutes ago. */
export class TooManyRequests extends DomainError {
  constructor(detail: string, retryAfterSeconds: number) {
    super(429, 'Too Many Requests', detail);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface RefreshOptions {
  /** Only the DOIs of these services; all services when absent (the schedule). */
  serviceIds?: readonly string[] | undefined;
  /** The slice starts after this DOI (in DOI order). */
  after?: string | undefined;
  /** Runs created by `requestRefresh`, waiting for this job; filled instead of new ones. */
  runIds?: readonly string[] | undefined;
  /** When the first slice of this refresh began; a later slice carries it, so the KPI counts only this refresh's counts. */
  since?: Date | undefined;
  signal?: AbortSignal | undefined;
}

/**
 * What one slice did: counts only, for the job-run history. `next` is the DOI the next slice starts after, `since` when the
 * refresh began (for the next slice). The `kpi*` counts are the Bibliographic KPI's (sprint 3).
 */
export interface RefreshReport extends KpiReport {
  /** `disabled` when the setting `enabled` is off: nothing was asked. */
  skipped?: 'disabled';
  dois: number;
  services: number;
  sources: number;
  asked: number;
  found: number;
  notFound: number;
  failed: number;
  metadataRetried: number;
  metadataOk: number;
  runIds: string[];
  next?: string;
  since: Date;
}

export interface HistoryPoint {
  source: string;
  /** The UTC day of the snapshot, `YYYY-MM-DD`. */
  day: string;
  citedByCount: number;
  takenAt: Date;
}

export interface History {
  publicationId: string;
  doi: string;
  /** Oldest first: at most one point per source and day (the latest of that day), at most 520. */
  points: HistoryPoint[];
}

export interface CitationCount {
  citedByCount: number;
  takenAt: Date;
}

/** The citations of a service: the sum over the publications whose count is known, and over how many it is taken. */
export interface ServiceCitations {
  /** The id of the source the counts come from, `null` when no source exists. */
  source: string | null;
  /** `null` when no publication has a count: unknown is not zero. */
  total: number | null;
  found: number;
  of: number;
}

export interface CitationService {
  /**
   * Trusted (the job; no route calls it): one slice of at most 2,000 DOIs of the given services, asked of every source
   * that is on, in batches of 100, one transaction per batch for its snapshots. Also looks up again the metadata of the
   * slice's DOIs whose lookup failed or never happened (never `not-found`).
   */
  refresh(trigger: RefreshTrigger, options?: RefreshOptions): Promise<RefreshReport>;
  /**
   * "Check now" for one service: needs `bibliometrics.publication.write` on the service; 404 for an unknown service, 409
   * when lookups are off, 429 with `Retry-After` within ten minutes of the last one. Records a waiting run per source and
   * queues the job. Answers the run ids.
   */
  requestRefresh(actor: Actor, serviceId: string): Promise<{ runIds: string[] }>;
  /** The history of a publication of this service (the plain read); 404 for a publication of another service. */
  history(actor: Actor, serviceId: string, publicationId: string): Promise<History>;
  /** The latest count by DOI from the primary source (no permission check: the caller has checked it). */
  latest(
    dois: readonly string[],
  ): Promise<{ source: string | null; counts: Map<string, CitationCount> }>;
  /** The total of a service from the primary source (no permission check: the caller has checked it). */
  serviceTotal(serviceId: string): Promise<ServiceCitations>;
}

export interface CitationDeps {
  authz: Pick<AuthzService, 'require'>;
  services: Pick<ServicesPublic, 'existsAsSystem'>;
  /** The entries of `biblio.citationSource`, in registry order. */
  sources: () => readonly CitationSourceEntry[];
  settings: () => Promise<BibliometricsSettings>;
  metadata: MetadataStore;
  /** Queues the job for a manual refresh. */
  enqueue: (data: RefreshJobData) => Promise<unknown>;
  /** The Bibliographic KPI: kpi.framework's trusted reads and kpi.ingestion's trusted write. Absent: no KPI (the demo seed). */
  kpi?: KpiWriteDeps;
  clock?: () => Date;
}

/** The data of a queued job; the schedule passes none. */
export interface RefreshJobData {
  trigger: RefreshTrigger;
  serviceIds?: string[];
  runIds?: string[];
  after?: string;
  /** ISO time the refresh began; set on the slices after the first. */
  since?: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A fixed text for a run's `error`: the reasons and how many DOIs each, never a key or a URL. */
function errorText(reasons: Map<string, number>): string | null {
  if (reasons.size === 0) return null;
  const text = [...reasons]
    .map(([reason, n]) => `${reason}: ${n} DOI${n === 1 ? '' : 's'}`)
    .join('; ');
  return text.slice(0, 500);
}

/** A source's failure reason as stored: a fixed code of at most 32 characters (a third-party entry may give anything). */
const reasonCode = (reason: unknown) =>
  typeof reason === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(reason) ? reason : 'source-error';

export function createCitationService(
  ctx: Pick<ModuleContext, 'db' | 'log' | 'events'>,
  deps: CitationDeps,
): CitationService {
  const db: Db = ctx.db;
  const clock = deps.clock ?? (() => new Date());

  async function serviceMustExist(serviceId: string): Promise<string> {
    if (!uuidPattern.test(serviceId))
      throw new Invalid('The request is not valid.', [
        { in: 'path', path: 'serviceId', message: 'must be the id of a service' },
      ]);
    if (!(await deps.services.existsAsSystem(serviceId.toLowerCase())))
      throw new NotFound('There is no such service.');
    return serviceId.toLowerCase();
  }

  /** The sources that are on with these settings, in registry order; none when the module's `enabled` is off. */
  function enabledSources(settings: BibliometricsSettings): CitationSourceEntry[] {
    if (!settings.enabled) return [];
    return deps.sources().filter((entry) => {
      try {
        return entry.enabled(settings);
      } catch {
        return false;
      }
    });
  }

  /** The source the list and the total show: the first that is on, else the first there is. */
  async function primarySource(): Promise<string | null> {
    const all = deps.sources();
    const settings = await deps.settings();
    return (enabledSources(settings)[0] ?? all[0])?.id ?? null;
  }

  /** The slice: distinct DOIs after `after`, in DOI order, with the services that list each; at most 2,000 of both. */
  async function slice(options: RefreshOptions) {
    const services = options.serviceIds?.map((id) => id.toLowerCase());
    const where = and(
      options.after ? gt(publication.doi, options.after) : undefined,
      services ? inArray(publication.serviceId, services) : undefined,
    );
    const rows = await db
      .select({
        doi: publication.doi,
        serviceIds: sql<string[]>`array_agg(distinct ${publication.serviceId})`,
      })
      .from(publication)
      .where(where)
      .groupBy(publication.doi)
      .orderBy(publication.doi)
      .limit(SLICE_SIZE + 1);
    const dois: string[] = [];
    const serviceSet = new Set<string>();
    for (const row of rows.slice(0, SLICE_SIZE)) {
      const added = row.serviceIds.filter((id) => !serviceSet.has(id));
      // Never more services in one event than it may name; the rest waits for the next slice.
      if (dois.length > 0 && serviceSet.size + added.length > SLICE_SIZE) break;
      dois.push(row.doi);
      for (const id of added) serviceSet.add(id);
    }
    const more = rows.length > dois.length;
    return { dois, serviceIds: [...serviceSet], next: more ? dois.at(-1) : undefined };
  }

  /** Stores one batch's snapshots in one transaction; on failure none of the batch is stored. Returns how many. */
  async function storeBatch(
    runId: string,
    source: string,
    counts: ReadonlyMap<string, number>,
    batch: readonly string[],
  ) {
    const rows = batch.flatMap((doi) => {
      const count = counts.get(doi);
      return count === undefined || !Number.isSafeInteger(count) || count < 0
        ? []
        : [{ runId, doi, source, citedByCount: count, takenAt: clock() }];
    });
    if (rows.length === 0) return 0;
    await db.tx(async (tx) => {
      await tx
        .insert(citationSnapshot)
        .values(rows)
        .onConflictDoUpdate({
          target: [citationSnapshot.runId, citationSnapshot.doi],
          set: { citedByCount: sql`excluded.cited_by_count`, takenAt: sql`excluded.taken_at` },
        });
    });
    return rows.length;
  }

  /** Asks one source for the slice and fills its run. */
  async function runSource(
    entry: CitationSourceEntry,
    runId: string,
    dois: readonly string[],
    serviceIds: readonly string[],
    signal: AbortSignal | undefined,
  ) {
    let found = 0;
    let notFound = 0;
    let failed = 0;
    const reasons = new Map<string, number>();
    const fail = (reason: string, n: number) => {
      failed += n;
      reasons.set(reason, (reasons.get(reason) ?? 0) + n);
    };
    for (let start = 0; start < dois.length; start += SOURCE_BATCH_SIZE) {
      const batch = dois.slice(start, start + SOURCE_BATCH_SIZE);
      if (signal?.aborted) {
        fail('timeout', batch.length);
        continue;
      }
      let answer: SourceCounts;
      try {
        answer = await entry.fetchCounts(batch, { signal });
      } catch {
        // A thrown error may carry a URL; only the fixed code is kept.
        fail('source-error', batch.length);
        continue;
      }
      const asked = new Set(batch);
      const failedHere = new Set<string>();
      for (const group of answer.failed) {
        const mine = group.dois.filter((doi) => asked.has(doi) && !failedHere.has(doi));
        mine.forEach((doi) => failedHere.add(doi));
        if (mine.length > 0) fail(reasonCode(group.reason), mine.length);
      }
      const known = new Map(
        [...answer.counts].filter(([doi]) => asked.has(doi) && !failedHere.has(doi)),
      );
      try {
        found += await storeBatch(runId, entry.id, known, batch);
      } catch (error) {
        ctx.log.warn(
          { source: entry.id, err: error },
          'bibliometrics: a batch of snapshots could not be stored',
        );
        fail('store-failed', known.size);
        continue;
      }
      notFound += batch.length - failedHere.size - known.size;
    }
    // The run's counts and the event commit together.
    await db.tx(async (tx) => {
      await tx
        .update(citationRun)
        .set({
          asked: dois.length,
          found,
          failed,
          error: errorText(reasons),
          finishedAt: sql`now()`,
        })
        .where(eq(citationRun.id, runId));
      await ctx.events.emit(CITATIONS_UPDATED_EVENT, {
        runId,
        serviceIds: serviceIds.slice(0, SLICE_SIZE),
        found,
        failed,
      });
    });
    if (failed > 0)
      ctx.log.warn(
        { source: entry.id, runId, failed, reasons: Object.fromEntries(reasons) },
        'bibliometrics: some citation counts could not be fetched',
      );
    return { found, notFound, failed };
  }

  /** Looks up again the metadata of the slice's DOIs whose lookup failed or never happened. */
  async function retryMetadata(dois: readonly string[], signal: AbortSignal | undefined) {
    if (dois.length === 0) return { retried: 0, ok: 0 };
    const known = await db
      .select({ doi: doiMetadata.doi, status: doiMetadata.status })
      .from(doiMetadata)
      .where(inArray(doiMetadata.doi, [...dois]));
    const status = new Map(known.map((row) => [row.doi, row.status]));
    // `not-found` is not asked again (the backlog has the case of a DOI registered later).
    const due = dois
      .filter((doi) => (status.get(doi) ?? 'failed') === 'failed')
      .slice(0, METADATA_RETRIES_PER_SLICE);
    let ok = 0;
    let retried = 0;
    for (const doi of due) {
      if (signal?.aborted) break;
      retried++;
      const row = await deps.metadata.resolveAndStore(doi, signal ? { signal } : {});
      if (row?.status === 'ok') ok++;
    }
    return { retried, ok };
  }

  async function newRun(trigger: RefreshTrigger, source: string, serviceId: string | null) {
    const [row] = await db
      .insert(citationRun)
      .values({ id: ids.uuidv7(), trigger, source, serviceId })
      .returning({ id: citationRun.id });
    return row!.id;
  }

  return {
    async refresh(trigger, options = {}) {
      const since = options.since ?? clock();
      const settings = await deps.settings();
      const sources = enabledSources(settings);
      const report: RefreshReport = {
        ...kpiOff(),
        since,
        dois: 0,
        services: 0,
        sources: sources.length,
        asked: 0,
        found: 0,
        notFound: 0,
        failed: 0,
        metadataRetried: 0,
        metadataOk: 0,
        runIds: [],
      };
      const waiting = options.runIds?.length
        ? await db
            .select()
            .from(citationRun)
            .where(inArray(citationRun.id, [...options.runIds]))
        : [];
      if (!settings.enabled) {
        // Nothing is asked and nothing becomes a zero; a waiting run says why it stayed empty.
        for (const run of waiting.filter((r) => r.finishedAt === null))
          await db
            .update(citationRun)
            .set({ error: 'lookups are turned off', finishedAt: sql`now()` })
            .where(eq(citationRun.id, run.id));
        return { ...report, skipped: 'disabled' };
      }

      const part = await slice(options);
      report.dois = part.dois.length;
      report.services = part.serviceIds.length;
      const manualService = trigger === 'manual' ? (options.serviceIds?.[0] ?? null) : null;
      const sourceIds = new Set(sources.map((entry) => entry.id));
      // A waiting run of a source that has been turned off meanwhile is closed, not filled.
      for (const run of waiting.filter((r) => r.finishedAt === null && !sourceIds.has(r.source)))
        await db
          .update(citationRun)
          .set({ error: 'the source is turned off', finishedAt: sql`now()` })
          .where(eq(citationRun.id, run.id));

      for (const entry of sources) {
        const waitingRun = waiting.find((r) => r.source === entry.id && r.finishedAt === null);
        // A slice with no DOI (an instance with no publications) records no run, unless one waits for it.
        if (!waitingRun && part.dois.length === 0) continue;
        const runId = waitingRun?.id ?? (await newRun(trigger, entry.id, manualService));
        report.runIds.push(runId);
        const counts = await runSource(entry, runId, part.dois, part.serviceIds, options.signal);
        report.asked += part.dois.length;
        report.found += counts.found;
        report.notFound += counts.notFound;
        report.failed += counts.failed;
      }

      // The KPI after the counts of every source are stored; only here (a test checks that nothing else writes it).
      if (deps.kpi && sources.length > 0)
        Object.assign(
          report,
          await writeKpi(db, deps.kpi, {
            settings,
            source: sources[0]!.id,
            serviceIds: part.serviceIds,
            lastDoi: part.next,
            since,
            now: clock(),
            log: ctx.log,
          }),
        );

      const metadata = await retryMetadata(part.dois, options.signal);
      report.metadataRetried = metadata.retried;
      report.metadataOk = metadata.ok;
      if (part.next) report.next = part.next;
      return report;
    },

    async requestRefresh(actor, serviceId) {
      await deps.authz.require(actor, PERMISSION_WRITE, { type: RESOURCE_SERVICE, id: serviceId });
      const service = await serviceMustExist(serviceId);
      const settings = await deps.settings();
      const sources = enabledSources(settings);
      if (sources.length === 0)
        throw new Conflict('Citation lookups are turned off on this instance.');
      const runIds = await db.tx(async (tx) => {
        // One request per service at a time: the check and the insert are one step.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`biblio-refresh:${service}`}))`,
        );
        const [last] = await tx
          .select({ startedAt: citationRun.startedAt })
          .from(citationRun)
          .where(and(eq(citationRun.serviceId, service), eq(citationRun.trigger, 'manual')))
          .orderBy(sql`${citationRun.startedAt} desc`)
          .limit(1);
        if (last) {
          const waited = (clock().getTime() - last.startedAt.getTime()) / 1000;
          if (waited < MANUAL_COOLDOWN_SECONDS)
            throw new TooManyRequests(
              'The citations of this service were checked less than ten minutes ago.',
              Math.max(Math.ceil(MANUAL_COOLDOWN_SECONDS - waited), 1),
            );
        }
        const created: string[] = [];
        for (const entry of sources) {
          const [row] = await tx
            .insert(citationRun)
            .values({
              id: ids.uuidv7(),
              trigger: 'manual',
              source: entry.id,
              serviceId: service,
              startedAt: clock(),
            })
            .returning({ id: citationRun.id });
          created.push(row!.id);
        }
        return created;
      });
      await deps.enqueue({ trigger: 'manual', serviceIds: [service], runIds });
      return { runIds };
    },

    async history(actor, serviceId, publicationId) {
      await deps.authz.require(actor, PERMISSION_READ);
      const service = await serviceMustExist(serviceId);
      if (!uuidPattern.test(publicationId))
        throw new Invalid('The request is not valid.', [
          { in: 'path', path: 'publicationId', message: 'must be the id of a publication' },
        ]);
      const [row] = await db
        .select({ id: publication.id, doi: publication.doi })
        .from(publication)
        .where(
          and(eq(publication.id, publicationId.toLowerCase()), eq(publication.serviceId, service)),
        );
      if (!row) throw new NotFound('This service has no such publication.');
      const { rows } = await db.execute<{
        source: string;
        day: string;
        cited_by_count: number;
        taken_at: Date | string;
      }>(sql`
        select source, day, cited_by_count, taken_at from (
          select distinct on (source, day) source, day, cited_by_count, taken_at
            from (
              select source, to_char(taken_at at time zone 'UTC', 'YYYY-MM-DD') as day, cited_by_count, taken_at
                from ${citationSnapshot}
               where doi = ${row.doi}
            ) snapshots
           order by source, day, taken_at desc
        ) daily
        order by taken_at desc
        limit ${HISTORY_MAX_POINTS}`);
      return {
        publicationId: row.id,
        doi: row.doi,
        points: rows
          .map((point) => ({
            source: point.source,
            day: point.day,
            citedByCount: Number(point.cited_by_count),
            takenAt: new Date(point.taken_at),
          }))
          .reverse(),
      };
    },

    async latest(dois) {
      const source = await primarySource();
      const counts = new Map<string, CitationCount>();
      if (!source || dois.length === 0) return { source, counts };
      const rows = await db
        .selectDistinctOn([citationSnapshot.doi], {
          doi: citationSnapshot.doi,
          citedByCount: citationSnapshot.citedByCount,
          takenAt: citationSnapshot.takenAt,
        })
        .from(citationSnapshot)
        .where(and(eq(citationSnapshot.source, source), inArray(citationSnapshot.doi, [...dois])))
        .orderBy(citationSnapshot.doi, sql`${citationSnapshot.takenAt} desc`);
      for (const row of rows)
        counts.set(row.doi, { citedByCount: row.citedByCount, takenAt: row.takenAt });
      return { source, counts };
    },

    async serviceTotal(serviceId) {
      const source = await primarySource();
      const service = serviceId.toLowerCase();
      const { rows } = await db.execute<{ of: number; found: number; total: string | null }>(sql`
        select count(*)::int as of, count(latest.count)::int as found, sum(latest.count)::text as total
          from ${publication} p
          left join lateral (
            select s.cited_by_count as count
              from ${citationSnapshot} s
             where s.doi = p.doi and s.source = ${source ?? ''}
             order by s.taken_at desc
             limit 1
          ) latest on true
         where p.service_id = ${service}`);
      const row = rows[0];
      const found = Number(row?.found ?? 0);
      return {
        source,
        total: found === 0 || row?.total == null ? null : Number(row.total),
        found,
        of: Number(row?.of ?? 0),
      };
    },
  };
}
