// The job `bibliometrics.citations.refresh`: weekly (Monday 04:00 UTC) for every service, and queued by "check now" for one.
// One run handles one slice of at most 2,000 DOIs and queues the next. It is safe to run twice: a second run on a day
// adds a second snapshot per DOI, and the history keeps the latest of each day.
import { z } from '@scorpion/contracts';
import type { JobResult, JobRun } from '@scorpion/kernel';
import type { CitationService, RefreshJobData } from './citations.ts';

/** The data of a queued run; the schedule passes none, which is a scheduled run from the first DOI. */
export const refreshJobDataSchema = z.strictObject({
  trigger: z.enum(['schedule', 'manual']),
  /** "Check now" names its one service. */
  serviceIds: z.array(z.uuid()).min(1).max(1).optional(),
  /** The runs "check now" created, waiting for this job. */
  runIds: z.array(z.uuid()).max(10).optional(),
  /** The slice starts after this DOI. */
  after: z.string().min(1).max(256).optional(),
  /** When the refresh's first slice began (set on the later slices): the KPI counts only this refresh's counts. */
  since: z.iso.datetime().optional(),
});

export async function runRefreshJob(
  job: Pick<JobRun, 'data' | 'signal'>,
  citations: Pick<CitationService, 'refresh'>,
  enqueue: (data: RefreshJobData) => Promise<unknown>,
): Promise<JobResult> {
  const data: RefreshJobData =
    job.data === undefined || job.data === null
      ? { trigger: 'schedule' }
      : refreshJobDataSchema.parse(job.data);
  const report = await citations.refresh(data.trigger, {
    serviceIds: data.serviceIds,
    after: data.after,
    runIds: data.runIds,
    since: data.since === undefined ? undefined : new Date(data.since),
    signal: job.signal,
  });
  if (report.next !== undefined)
    await enqueue({
      trigger: data.trigger,
      ...(data.serviceIds ? { serviceIds: data.serviceIds } : {}),
      after: report.next,
      since: report.since.toISOString(),
    });
  // Counts only, for the job-run history.
  return {
    ...(report.skipped ? { skipped: report.skipped } : {}),
    dois: report.dois,
    services: report.services,
    sources: report.sources,
    asked: report.asked,
    found: report.found,
    notFound: report.notFound,
    failed: report.failed,
    metadataRetried: report.metadataRetried,
    metadataOk: report.metadataOk,
    nextSlice: report.next !== undefined,
    // The two Bibliographic KPIs: `off` with their setting empty.
    citationsKpi: report.citationsKpi,
    citationsWritten: report.citationsWritten,
    citationsSkippedNotInSet: report.citationsSkippedNotInSet,
    citationsSkippedIncomplete: report.citationsSkippedIncomplete,
    publicationsKpi: report.publicationsKpi,
    publicationsWritten: report.publicationsWritten,
    publicationsSkippedNotInSet: report.publicationsSkippedNotInSet,
    publicationsSkippedUndated: report.publicationsSkippedUndated,
    kpiFailed: report.kpiFailed,
  };
}
