// The citation refresh against real Postgres, the real authoriser and the real outbox: one snapshot per found DOI and per
// source, a shared DOI asked once, a second source from another module, unknown is null and never zero, a failed batch,
// the rollback of a batch's snapshots, "check now" (who may, the 10-minute rule), the job's slices and the history's one
// point per day, the metadata retry, the event's payload, and the key that never reaches a log line. No test reaches the
// network: OpenAlex is a stub, or the real adapter over a fake `fetch`.
import { Forbidden, Unauthorized, type Actor } from '@scorpion/contracts';
import { createOpenAlex, createStubOpenAlex, type DoiResolver } from '@scorpion/integrations';
import type { JobRun, ModuleContext } from '@scorpion/kernel';
import { makeDoiMetadata, makePublication } from '@scorpion/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  countRows,
  uniqueDoi,
  useBibliometrics,
  world,
  type BiblioStarted,
  type FixtureModule,
} from '../test/harness.ts';
import {
  CITATIONS_UPDATED_EVENT,
  HISTORY_MAX_POINTS,
  MANUAL_COOLDOWN_SECONDS,
  REFRESH_JOB,
  SLICE_SIZE,
  TooManyRequests,
} from './citations.ts';
import { CITATION_SOURCE_REGISTRY, OPENALEX_KEY_SECRET, type SourceCounts } from './sources.ts';

const h = useBibliometrics();
const anonymous: Actor = { kind: 'anonymous' };

/** Runs the job's handler as the worker would, with a fake `ctx.jobs` that records what it queues. */
async function runJob(s: BiblioStarted, data?: unknown) {
  const queued: unknown[] = [];
  const def = s.manifest.jobs!.find((job) => job.name === REFRESH_JOB)!;
  const job: JobRun = {
    id: crypto.randomUUID(),
    name: REFRESH_JOB,
    data,
    attempt: 1,
    signal: new AbortController().signal,
  };
  const ctx = {
    jobs: {
      enqueue: (_name: string, value: unknown) => {
        queued.push(value);
        return Promise.resolve('job');
      },
    },
  } as unknown as ModuleContext;
  const report = (await def.handler(job, ctx)) as Record<string, unknown>;
  return { report, queued };
}

interface SnapshotRow {
  doi: string;
  source: string;
  cited_by_count: number;
}
const snapshotsOf = async (s: BiblioStarted, dois: string[]) =>
  (
    await s.pool.query<SnapshotRow>(
      'select doi, source, cited_by_count from biblio_citation_snapshot where doi = any($1) order by doi, source',
      [dois],
    )
  ).rows;

/** A module that contributes a second citation source; nothing in bibliometrics changes for it. */
function secondSource(
  id: string,
  answer: (dois: readonly string[]) => SourceCounts,
): FixtureModule {
  return {
    manifest: {
      id: `fixture.${id}`,
      version: '0.1.0',
      contributes: {
        [CITATION_SOURCE_REGISTRY]: [
          {
            id,
            label: `Fixture ${id}`,
            enabled: () => true,
            fetchCounts: (dois: readonly string[]) => Promise.resolve(answer(dois)),
          },
        ],
      },
    },
    packageJson: {
      name: `@scorpion/fixture-${id}`,
      version: '0.0.0',
      dependencies: { '@scorpion/bibliometrics': 'workspace:*' },
    },
  };
}

describe('the refresh', () => {
  it('stores one snapshot per found DOI, asks a DOI that two services list once, and writes no row for an unknown one', async () => {
    const [shared, own, unknown] = [uniqueDoi('shared'), uniqueDoi('own'), uniqueDoi('unknown')];
    const stub = createStubOpenAlex({ [shared]: 12, [own]: 0 });
    const w = await world(await h.start({ openAlex: () => stub }));
    await makePublication(w.pool, { serviceId: w.svc.id, doi: shared });
    await makePublication(w.pool, { serviceId: w.elsewhereSvc.id, doi: shared });
    await makePublication(w.pool, { serviceId: w.svc.id, doi: own });
    await makePublication(w.pool, { serviceId: w.svc.id, doi: unknown });

    const report = await w.biblio.citations.refresh('schedule');
    expect(stub.calls.flat().sort()).toEqual([shared, own, unknown].sort());
    expect(report).toMatchObject({
      dois: 3,
      services: 2,
      sources: 1,
      asked: 3,
      found: 2,
      notFound: 1,
      failed: 0,
    });
    expect(await snapshotsOf(w, [shared, own, unknown])).toEqual(
      [
        { doi: shared, source: 'openalex', cited_by_count: 12 },
        // A real count of 0 is a count; an unknown DOI has no row at all.
        { doi: own, source: 'openalex', cited_by_count: 0 },
      ].sort((a, b) => a.doi.localeCompare(b.doi)),
    );
    const { rows } = await w.pool.query(
      'select trigger, source, service_id, asked, found, failed, error, finished_at is not null as finished from biblio_citation_run',
    );
    expect(rows).toEqual([
      {
        trigger: 'schedule',
        source: 'openalex',
        service_id: null,
        asked: 3,
        found: 2,
        failed: 0,
        error: null,
        finished: true,
      },
    ]);
  });

  it('asks a second source from another module as well and stores its snapshots under its own id', async () => {
    const doi = uniqueDoi('two-sources');
    const asked: string[][] = [];
    const s = await h.start({
      openAlex: () => createStubOpenAlex({ [doi]: 5 }),
      extra: [
        secondSource('fixture-cites', (dois) => {
          asked.push([...dois]);
          return { counts: new Map(dois.map((d) => [d, 8])), notFound: [], failed: [] };
        }),
      ],
    });
    const w = await world(s);
    await makePublication(w.pool, { serviceId: w.svc.id, doi });
    const report = await w.biblio.citations.refresh('schedule');
    expect(report).toMatchObject({ sources: 2, asked: 2, found: 2 });
    expect(report.runIds).toHaveLength(2);
    expect(asked).toEqual([[doi]]);
    expect(await snapshotsOf(w, [doi])).toEqual([
      { doi, source: 'fixture-cites', cited_by_count: 8 },
      { doi, source: 'openalex', cited_by_count: 5 },
    ]);
    // The list shows the first source of the registry (OpenAlex), and says which.
    const page = await w.biblio.publications.list(w.people.plain, w.svc.id, {
      page: 0,
      pageSize: 5,
    });
    expect(page.items[0]!.citedByCount).toBe(5);
    expect(page.citations.source).toBe('openalex');
  });

  it('says null and "2 of 3 found" for an unknown DOI, never 0', async () => {
    const [a, b, c] = [uniqueDoi('a'), uniqueDoi('b'), uniqueDoi('c')];
    const w = await world(
      await h.start({ openAlex: () => createStubOpenAlex({ [a]: 3, [b]: 4 }) }),
    );
    for (const doi of [a, b, c]) await makePublication(w.pool, { serviceId: w.svc.id, doi });

    const before = await w.biblio.publications.list(w.people.plain, w.svc.id, {
      page: 0,
      pageSize: 5,
    });
    expect(before.items.map((item) => item.citedByCount)).toEqual([null, null, null]);
    expect(before.citations).toEqual({ source: 'openalex', total: null, found: 0, of: 3 });

    await w.biblio.citations.refresh('schedule');
    const after = await w.biblio.publications.list(w.people.plain, w.svc.id, {
      page: 0,
      pageSize: 5,
    });
    const byDoi = Object.fromEntries(after.items.map((item) => [item.doi, item]));
    expect(byDoi[a]!.citedByCount).toBe(3);
    expect(byDoi[a]!.citationsAsOf).toBeInstanceOf(Date);
    expect(byDoi[c]!.citedByCount).toBeNull();
    expect(byDoi[c]!.citationsAsOf).toBeNull();
    expect(after.citations).toEqual({ source: 'openalex', total: 7, found: 2, of: 3 });
  });

  it('stores nothing for the DOIs of a failed batch, records them as failed with a fixed reason, and keeps the other batch', async () => {
    const dois = Array.from({ length: 150 }, (_, i) => uniqueDoi(`batch${i}`)).sort();
    const answers = [
      () =>
        Promise.resolve(
          new Response('<html>busy</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
        ),
      (url: URL) => {
        const asked = url.searchParams.get('filter')!.slice(4).split('|');
        return Promise.resolve(
          Response.json({
            results: asked.map((doi) => ({ doi: `https://doi.org/${doi}`, cited_by_count: 2 })),
          }),
        );
      },
    ];
    const fake = vi.fn((input: string | URL | Request) =>
      answers.shift()!(new URL(input instanceof Request ? input.url : input.toString())),
    );
    const w = await world(
      await h.start({ openAlex: (apiKey) => createOpenAlex({ apiKey, fetch: fake }) }),
    );
    for (const doi of dois) await makePublication(w.pool, { serviceId: w.svc.id, doi });

    const report = await w.biblio.citations.refresh('schedule');
    expect(report).toMatchObject({ asked: 150, found: 50, failed: 100, notFound: 0 });
    expect(await snapshotsOf(w, dois.slice(0, 100))).toEqual([]);
    expect(await snapshotsOf(w, dois.slice(100))).toHaveLength(50);
    const { rows } = await w.pool.query<{ failed: number; error: string }>(
      'select failed, error from biblio_citation_run',
    );
    expect(rows).toEqual([{ failed: 100, error: 'not-json: 100 DOIs' }]);
    expect(await countRows(w.pool, 'biblio_citation_snapshot', 'cited_by_count = 0')).toBe(0);
  });

  it('rolls a batch back when one of its snapshots cannot be written: none of that batch is stored', async () => {
    const dois = Array.from({ length: 101 }, (_, i) => uniqueDoi(`rb${i}`)).sort();
    const poisoned = dois[50]!;
    const w = await world(
      await h.start({
        openAlex: () => createStubOpenAlex(Object.fromEntries(dois.map((doi) => [doi, 1]))),
      }),
    );
    for (const doi of dois) await makePublication(w.pool, { serviceId: w.svc.id, doi });
    await w.pool.query(`
      create or replace function test_break_snapshot() returns trigger as $$
      begin
        if new.doi = '${poisoned}' then raise exception 'snapshot refused for this test'; end if;
        return new;
      end $$ language plpgsql;
      create trigger test_break_snapshot before insert on biblio_citation_snapshot
        for each row execute function test_break_snapshot();`);
    const report = await w.biblio.citations.refresh('schedule');
    await w.pool.query('drop trigger test_break_snapshot on biblio_citation_snapshot');
    expect(await snapshotsOf(w, dois.slice(0, 100))).toEqual([]);
    expect(await snapshotsOf(w, dois.slice(100))).toHaveLength(1);
    expect(report).toMatchObject({ found: 1, failed: 100 });
    const { rows } = await w.pool.query<{ error: string }>('select error from biblio_citation_run');
    expect(rows[0]!.error).toBe('store-failed: 100 DOIs');
  });

  it('asks nothing and writes nothing with the setting enabled off', async () => {
    const stub = createStubOpenAlex();
    const w = await world(await h.start({ openAlex: () => stub, settings: { enabled: false } }));
    await makePublication(w.pool, { serviceId: w.svc.id });
    expect(await w.biblio.citations.refresh('schedule')).toMatchObject({
      skipped: 'disabled',
      asked: 0,
    });
    expect(stub.calls).toEqual([]);
    expect(await countRows(w.pool, 'biblio_citation_run')).toBe(0);
    expect(await countRows(w.pool, 'biblio_citation_snapshot')).toBe(0);
  });

  it('emits bibliometrics.citations.updated@1 with ids and counts only: no DOI, title or URL', async () => {
    const doi = uniqueDoi('event');
    const w = await world(await h.start({ openAlex: () => createStubOpenAlex({ [doi]: 1 }) }));
    await makePublication(w.pool, {
      serviceId: w.svc.id,
      doi,
      metadata: { title: 'A title that must not travel' },
    });
    const { runIds } = await w.biblio.citations.refresh('schedule');
    const { rows } = await w.pool.query<{ payload: Record<string, unknown> }>(
      'select payload from kernel_outbox where name = $1',
      [CITATIONS_UPDATED_EVENT],
    );
    expect(rows.map((row) => row.payload)).toEqual([
      { runId: runIds[0], serviceIds: [w.svc.id], found: 1, failed: 0 },
    ]);
    const text = JSON.stringify(rows);
    expect(text).not.toContain(doi);
    expect(text).not.toContain('A title');
    expect(text).not.toContain('http');
  });

  it('looks up again the metadata that failed or was never looked up, but not a DOI doi.org does not know', async () => {
    const [failed, missing, notFound, ok] = [
      uniqueDoi('mf'),
      uniqueDoi('mm'),
      uniqueDoi('mn'),
      uniqueDoi('mo'),
    ];
    const asked: string[] = [];
    const resolver: DoiResolver = {
      resolve(doi) {
        asked.push(doi);
        return Promise.resolve({
          status: 'ok',
          metadata: {
            title: `Found ${doi}`,
            authors: [],
            issued: null,
            container: null,
            type: null,
          },
        });
      },
    };
    const w = await world(await h.start({ resolver }));
    await makePublication(w.pool, {
      serviceId: w.svc.id,
      doi: failed,
      metadata: { status: 'failed' },
    });
    await makePublication(w.pool, { serviceId: w.svc.id, doi: missing });
    await makePublication(w.pool, {
      serviceId: w.svc.id,
      doi: notFound,
      metadata: { status: 'not-found' },
    });
    await makePublication(w.pool, { serviceId: w.svc.id, doi: ok, metadata: {} });
    const report = await w.biblio.citations.refresh('schedule');
    expect(asked.sort()).toEqual([failed, missing].sort());
    expect(report).toMatchObject({ metadataRetried: 2, metadataOk: 2 });
    const { rows } = await w.pool.query<{ doi: string; status: string }>(
      'select doi, status from biblio_doi_metadata where doi = any($1) order by doi',
      [[failed, missing, notFound]],
    );
    expect(Object.fromEntries(rows.map((row) => [row.doi, row.status]))).toEqual({
      [failed]: 'ok',
      [missing]: 'ok',
      [notFound]: 'not-found',
    });
  });
});

describe('check now', () => {
  it('lets a member, a manager and Admin ask, each answered with the run ids [ASVS-8.2.1]', async () => {
    let now = new Date('2026-11-25T10:00:00Z');
    const w = await world(await h.start({ clock: () => now }));
    for (const who of ['member', 'manager', 'admin'] as const) {
      const { runIds } = await w.biblio.citations.requestRefresh(w.people[who], w.svc.id);
      expect(runIds, who).toHaveLength(1);
      now = new Date(now.getTime() + (MANUAL_COOLDOWN_SECONDS + 1) * 1000);
    }
    const { rows } = await w.pool.query(
      `select trigger, service_id, finished_at from biblio_citation_run order by started_at`,
    );
    expect(rows).toEqual(
      Array.from({ length: 3 }, () => ({
        trigger: 'manual',
        service_id: w.svc.id,
        finished_at: null,
      })),
    );
  });

  it('refuses an anonymous caller (401) and a non-member, a requested or left member and another provider (403), recording nothing [ASVS-8.2.1]', async () => {
    const w = await world(await h.start());
    await expect(w.biblio.citations.requestRefresh(anonymous, w.svc.id)).rejects.toBeInstanceOf(
      Unauthorized,
    );
    for (const who of ['plain', 'requested', 'left', 'elsewhere'] as const)
      await expect(
        w.biblio.citations.requestRefresh(w.people[who], w.svc.id),
        who,
      ).rejects.toBeInstanceOf(Forbidden);
    expect(await countRows(w.pool, 'biblio_citation_run')).toBe(0);
  });

  it('answers 429 with Retry-After within ten minutes of the last check of the service, and not for another service', async () => {
    let now = new Date('2026-11-25T10:00:00Z');
    const w = await world(await h.start({ clock: () => now }));
    await w.biblio.citations.requestRefresh(w.people.member, w.svc.id);
    now = new Date(now.getTime() + 4 * 60 * 1000);
    const refused = await w.biblio.citations
      .requestRefresh(w.people.manager, w.svc.id)
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(TooManyRequests);
    expect((refused as TooManyRequests).status).toBe(429);
    expect((refused as TooManyRequests).retryAfterSeconds).toBe(6 * 60);
    // Another service has its own ten minutes.
    await w.biblio.citations.requestRefresh(w.people.admin, w.elsewhereSvc.id);
    now = new Date(now.getTime() + 6 * 60 * 1000);
    await w.biblio.citations.requestRefresh(w.people.member, w.svc.id);
    expect(await countRows(w.pool, 'biblio_citation_run', 'service_id = $1', [w.svc.id])).toBe(2);
  });

  it('is refused with 409 while lookups are off', async () => {
    const w = await world(await h.start({ settings: { enabled: false } }));
    await expect(w.biblio.citations.requestRefresh(w.people.admin, w.svc.id)).rejects.toMatchObject(
      {
        status: 409,
      },
    );
  });

  it('fills the waiting run when the job runs, and fetches only that service', async () => {
    const [mine, theirs] = [uniqueDoi('mine'), uniqueDoi('theirs')];
    const stub = createStubOpenAlex({ [mine]: 4, [theirs]: 9 });
    const w = await world(await h.start({ openAlex: () => stub }));
    await makePublication(w.pool, { serviceId: w.svc.id, doi: mine });
    await makePublication(w.pool, { serviceId: w.elsewhereSvc.id, doi: theirs });
    const { runIds } = await w.biblio.citations.requestRefresh(w.people.member, w.svc.id);
    const { report } = await runJob(w, { trigger: 'manual', serviceIds: [w.svc.id], runIds });
    expect(report).toMatchObject({ dois: 1, found: 1, nextSlice: false });
    expect(stub.calls).toEqual([[mine]]);
    const { rows } = await w.pool.query(
      'select id, asked, found, finished_at is not null as finished from biblio_citation_run',
    );
    expect(rows).toEqual([{ id: runIds[0], asked: 1, found: 1, finished: true }]);
  });
});

describe('the job', () => {
  it('handles a fixture larger than a slice in two slices, queuing the second', async () => {
    const stub = createStubOpenAlex();
    const w = await world(await h.start({ openAlex: () => stub }));
    // One more DOI than a slice holds, written in one statement.
    await w.pool.query(
      `insert into biblio_publication (id, service_id, doi)
       select gen_random_uuid(), $1, '10.5555/slice-' || lpad(n::text, 5, '0') from generate_series(1, $2) n`,
      [w.svc.id, SLICE_SIZE + 1],
    );
    await w.pool.query(
      `insert into biblio_doi_metadata (doi, status) select doi, 'not-found' from biblio_publication where service_id = $1`,
      [w.svc.id],
    );
    const first = await runJob(w);
    expect(first.report).toMatchObject({
      dois: SLICE_SIZE,
      asked: SLICE_SIZE,
      notFound: SLICE_SIZE,
      nextSlice: true,
    });
    // The second slice carries when the refresh began, so the KPI counts only this refresh's counts.
    expect(first.queued).toEqual([
      { trigger: 'schedule', after: '10.5555/slice-02000', since: expect.any(String) },
    ]);
    const since = (first.queued[0] as { since: string }).since;
    expect(new Date(since).toISOString()).toBe(since);
    const second = await runJob(w, first.queued[0]);
    expect(second.report).toMatchObject({ dois: 1, asked: 1, nextSlice: false });
    expect(second.queued).toEqual([]);
    expect(stub.calls.flat()).toHaveLength(SLICE_SIZE + 1);
  });

  it('can run twice on a day: the history shows one point per day, the latest', async () => {
    let count = 10;
    const doi = uniqueDoi('twice');
    const w = await world(
      await h.start({
        openAlex: () => ({
          citedByCount: (dois) =>
            Promise.resolve({
              counts: new Map(dois.map((d) => [d, count])),
              notFound: [],
              failed: [],
            }),
        }),
      }),
    );
    const row = await makePublication(w.pool, { serviceId: w.svc.id, doi, metadata: {} });
    await runJob(w);
    count = 11;
    await runJob(w);
    expect(await countRows(w.pool, 'biblio_citation_snapshot', 'doi = $1', [doi])).toBe(2);
    const history = await w.biblio.citations.history(w.people.plain, w.svc.id, row.id);
    expect(history.points).toHaveLength(1);
    expect(history.points[0]).toMatchObject({ source: 'openalex', citedByCount: 11 });
    // Earlier days stay, one point each, oldest first.
    await w.pool.query(
      `update biblio_citation_snapshot set taken_at = taken_at - interval '7 days' where doi = $1 and cited_by_count = 10`,
      [doi],
    );
    const later = await w.biblio.citations.history(w.people.plain, w.svc.id, row.id);
    expect(later.points.map((point) => point.citedByCount)).toEqual([10, 11]);
  });

  it('refuses data that is not its own shape', async () => {
    const w = await world(await h.start());
    await expect(runJob(w, { trigger: 'manual', serviceIds: ['nope'] })).rejects.toThrow();
  });
});

describe('the history', () => {
  it('is 404 for a publication of another service, and keeps at most 520 points [ASVS-8.2.2]', async () => {
    const w = await world(await h.start());
    const theirs = await makePublication(w.pool, { serviceId: w.elsewhereSvc.id });
    await expect(
      w.biblio.citations.history(w.people.plain, w.svc.id, theirs.id),
    ).rejects.toMatchObject({
      status: 404,
    });
    await expect(w.biblio.citations.history(anonymous, w.svc.id, theirs.id)).rejects.toBeInstanceOf(
      Unauthorized,
    );
    const mine = await makePublication(w.pool, { serviceId: w.svc.id });
    // 600 weekly runs' worth of days, one run each (a run holds one snapshot per DOI).
    await w.pool.query(
      `with runs as (
         insert into biblio_citation_run (id, trigger, source)
         select gen_random_uuid(), 'schedule', 'openalex' from generate_series(1, 600)
         returning id
       ), numbered as (select id, row_number() over () as n from runs)
       insert into biblio_citation_snapshot (run_id, doi, source, cited_by_count, taken_at)
       select id, $1, 'openalex', n, now() - make_interval(days => (600 - n)::int) from numbered`,
      [mine.doi],
    );
    const history = await w.biblio.citations.history(w.people.plain, w.svc.id, mine.id);
    expect(history.points).toHaveLength(HISTORY_MAX_POINTS);
    expect(history.points.at(-1)!.citedByCount).toBe(600);
    expect(history.points[0]!.citedByCount).toBe(600 - HISTORY_MAX_POINTS + 1);
  });
});

describe('the OpenAlex key', () => {
  it('goes to OpenAlex in the header and never into a log line or the run', async () => {
    const key = `oa-test-key-${crypto.randomUUID()}`;
    const doi = uniqueDoi('key');
    const sent: { url: string; auth: string | undefined }[] = [];
    const fake = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      sent.push({
        url: input instanceof Request ? input.url : input.toString(),
        auth: (init?.headers as Record<string, string>).authorization,
      });
      return Promise.resolve(new Response('{"error":"down"}', { status: 401 }));
    });
    const logLines: string[] = [];
    const w = await world(
      await h.start({
        secrets: { [OPENALEX_KEY_SECRET]: key },
        openAlex: (apiKey) => createOpenAlex({ apiKey, fetch: fake }),
        logLines,
      }),
    );
    await makePublication(w.pool, { serviceId: w.svc.id, doi, metadata: {} });
    const report = await w.biblio.citations.refresh('schedule');
    expect(report.failed).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.auth).toBe(`Bearer ${key}`);
    expect(sent[0]!.url).not.toContain(key);
    expect(
      logLines.some((line) => line.includes('some citation counts could not be fetched')),
    ).toBe(true);
    expect(logLines.join('\n')).not.toContain(key);
    const { rows } = await w.pool.query<{ error: string }>('select error from biblio_citation_run');
    expect(rows).toEqual([{ error: 'key-refused: 1 DOI' }]);
  });
});

describe('the factories', () => {
  it('store metadata next to a publication', async () => {
    const w = await world(await h.start());
    const doi = uniqueDoi('factory');
    await makeDoiMetadata(w.pool, { doi, status: 'failed' });
    expect(
      await countRows(w.pool, 'biblio_doi_metadata', 'doi = $1 and status = $2', [doi, 'failed']),
    ).toBe(1);
  });
});
