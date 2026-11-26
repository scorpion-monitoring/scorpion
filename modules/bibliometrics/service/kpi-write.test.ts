// The Bibliographic KPI (M16 sprint 3, ADR-0056 decisions 5 and 7, ADR-0057) over real Postgres with the real kpi.framework and
// kpi.ingestion: the refresh writes a service's citation total as the current month's value only when every publication was found
// in this refresh and the indicator is in its effective KPI set; a second run in the month replaces the value (defect 6); the
// setting refuses an indicator that is not numeric or not Bibliographic with a 422; and only the refresh calls the trusted write.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DomainError, type UserActor } from '@scorpion/contracts';
import type { SettingsInternalsBundle } from '@scorpion/core-settings/module';
import { createStubOpenAlex, type DoiResolver } from '@scorpion/integrations';
import { makeIndicator, makeKpiSet, makePublication, makeServiceKpis } from '@scorpion/testing';
import { describe, expect, it, vi } from 'vitest';
import { uniqueDoi, useBibliometrics, world, type BiblioStarted } from '../test/harness.ts';
import { KPI_SOURCE } from './kpi-write.ts';

const h = useBibliometrics();
const NOW = new Date('2026-06-15T12:00:00Z');
const okResolver: DoiResolver = {
  resolve: () =>
    Promise.resolve({
      status: 'ok',
      metadata: {
        title: 'A paper',
        authors: [],
        issued: null,
        container: null,
        type: 'journal-article',
      },
    } as never),
};

let n = 0;
const uniq = (label: string) => `${label} ${++n} ${Math.random().toString(36).slice(2, 7)}`;

/**
 * A started module whose OpenAlex answers from `counts` (changed between runs), a service whose KPI set holds a numeric
 * Bibliographic indicator, a service with no KPIs, and the indicators the setting may name.
 */
async function kpiWorld(options: { clock?: () => Date } = {}) {
  const counts: Record<string, number> = {};
  const s = await h.start({
    openAlex: () => createStubOpenAlex({ ...counts }),
    resolver: okResolver,
    clock: options.clock ?? (() => NOW),
  });
  const w = await world(s);
  const citations = await makeIndicator(w.pool, {
    name: uniq('Citations'),
    valueType: 'integer',
    thematic: 'Bibliographic',
  });
  const usage = await makeIndicator(w.pool, {
    name: uniq('Visits'),
    valueType: 'integer',
    thematic: 'Usage',
  });
  const note = await makeIndicator(w.pool, {
    name: uniq('Remark'),
    valueType: 'text',
    qualitative: true,
    thematic: 'Bibliographic',
  });
  const set = await makeKpiSet(w.pool, {
    name: uniq('Set'),
    indicators: [{ indicatorId: citations.id, necessity: 'optional' }],
  });
  await makeServiceKpis(w.pool, { serviceId: w.svc.id, setId: set.id, extras: [] });
  const settings = (w.kernel.services.get('core.settings') as SettingsInternalsBundle).settings;
  const save = async (indicatorId: string | undefined, who: UserActor = w.people.admin) => {
    const current = await settings.get(w.people.admin, 'bibliometrics');
    return settings.update(who, 'bibliometrics', {
      version: current.version,
      values: indicatorId ? { kpi: { indicatorId } } : {},
    });
  };
  const add = async (serviceId: string, count: number | undefined) => {
    const doi = uniqueDoi('kpi');
    await makePublication(w.pool, { serviceId, doi });
    if (count !== undefined) counts[doi] = count;
    return doi;
  };
  const stored = async (serviceId: string) =>
    (
      await w.pool.query<{ period: string; value: string; source: string; updated_by: string }>(
        `select to_char(period, 'YYYY-MM-DD') as period, value_numeric::text as value, source, updated_by
           from kpii_measurement where service_id = $1 order by period`,
        [serviceId],
      )
    ).rows;
  const refresh = (serviceIds?: string[]) =>
    w.biblio.citations.refresh(serviceIds ? 'manual' : 'schedule', { serviceIds });
  return { ...w, counts, ind: { citations, usage, note }, save, add, stored, refresh };
}

async function rejection(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('the KPI write of the refresh', () => {
  it('writes the total as the current month for a service with the indicator in its set and every publication found', async () => {
    const w = await kpiWorld();
    await w.save(w.ind.citations.id);
    await w.add(w.svc.id, 300);
    await w.add(w.svc.id, 12);
    const report = await w.refresh([w.svc.id]);
    expect(report).toMatchObject({
      kpi: 'on',
      kpiWritten: 1,
      kpiSkippedNotInSet: 0,
      kpiSkippedIncomplete: 0,
      kpiFailed: 0,
    });
    expect(await w.stored(w.svc.id)).toEqual([
      { period: '2026-06-30', value: '312', source: KPI_SOURCE, updated_by: null },
    ]);
  });

  it('replaces the value on a second run in the same month: one row, the second total', async () => {
    const w = await kpiWorld();
    await w.save(w.ind.citations.id);
    const doi = await w.add(w.svc.id, 10);
    await w.refresh([w.svc.id]);
    w.counts[doi] = 11;
    await w.refresh([w.svc.id]);
    expect(await w.stored(w.svc.id)).toEqual([
      { period: '2026-06-30', value: '11', source: KPI_SOURCE, updated_by: null },
    ]);
  });

  it('skips and counts a service with one publication the source does not know, and never writes a partial total', async () => {
    const w = await kpiWorld();
    await w.save(w.ind.citations.id);
    await w.add(w.svc.id, 300);
    await w.add(w.svc.id, undefined);
    const report = await w.refresh([w.svc.id]);
    expect(report).toMatchObject({ kpi: 'on', kpiWritten: 0, kpiSkippedIncomplete: 1 });
    expect(await w.stored(w.svc.id)).toEqual([]);
  });

  it('counts only this refresh: an old count of a DOI not found now does not complete the total', async () => {
    let now = new Date('2026-06-01T12:00:00Z');
    const w = await kpiWorld({ clock: () => now });
    await w.save(w.ind.citations.id);
    const doi = await w.add(w.svc.id, 5);
    await w.add(w.svc.id, 7);
    await w.refresh([w.svc.id]);
    expect((await w.stored(w.svc.id)).map((row) => row.value)).toEqual(['12']);
    // A week later OpenAlex no longer knows one of them: the value of June stays as it was, it does not drop to 7.
    delete w.counts[doi];
    now = new Date('2026-06-08T12:00:00Z');
    const report = await w.refresh([w.svc.id]);
    expect(report).toMatchObject({ kpiWritten: 0, kpiSkippedIncomplete: 1 });
    expect((await w.stored(w.svc.id)).map((row) => row.value)).toEqual(['12']);
  });

  it('skips and counts a service whose KPI set does not hold the indicator', async () => {
    const w = await kpiWorld();
    await w.save(w.ind.citations.id);
    await w.add(w.elsewhereSvc.id, 4);
    await w.add(w.svc.id, 6);
    const report = await w.refresh();
    expect(report).toMatchObject({ kpi: 'on', kpiWritten: 1, kpiSkippedNotInSet: 1 });
    expect(await w.stored(w.elsewhereSvc.id)).toEqual([]);
    expect((await w.stored(w.svc.id)).map((row) => row.value)).toEqual(['6']);
  });

  it('writes nothing with the setting empty, and says so in the report', async () => {
    const w = await kpiWorld();
    await w.add(w.svc.id, 9);
    const report = await w.refresh([w.svc.id]);
    expect(report).toMatchObject({
      kpi: 'off',
      kpiWritten: 0,
      kpiSkippedNotInSet: 0,
      kpiSkippedIncomplete: 0,
    });
    expect(await w.stored(w.svc.id)).toEqual([]);
  });

  it('writes nothing when the indicator was moved out of Bibliographic after it was chosen', async () => {
    const w = await kpiWorld();
    await w.save(w.ind.citations.id);
    await w.pool.query(`update kpif_indicator set thematic = 'Usage' where id = $1`, [
      w.ind.citations.id,
    ]);
    await w.add(w.svc.id, 9);
    const report = await w.refresh([w.svc.id]);
    expect(report).toMatchObject({ kpi: 'unusable', kpiWritten: 0 });
    expect(await w.stored(w.svc.id)).toEqual([]);
  });

  it('puts the counts into the report of the job', async () => {
    const w = await kpiWorld();
    await w.save(w.ind.citations.id);
    await w.add(w.svc.id, 1);
    const def = w.manifest.jobs!.find((job) => job.name === 'bibliometrics.citations.refresh')!;
    const report = await def.handler(
      {
        id: crypto.randomUUID(),
        name: def.name,
        data: { trigger: 'manual', serviceIds: [w.svc.id] },
        attempt: 1,
        signal: new AbortController().signal,
      },
      { jobs: { enqueue: () => Promise.resolve('job') } } as never,
    );
    expect(report).toMatchObject({
      kpi: 'on',
      kpiWritten: 1,
      kpiSkippedNotInSet: 0,
      kpiSkippedIncomplete: 0,
      kpiFailed: 0,
    });
  });
});

describe('the setting kpi.indicatorId', () => {
  it('takes a numeric indicator in the category Bibliographic', async () => {
    const w = await kpiWorld();
    const saved = await w.save(w.ind.citations.id);
    expect(saved.values).toMatchObject({ kpi: { indicatorId: w.ind.citations.id } });
  });

  it('is a 422 on the field for an indicator outside Bibliographic, a text indicator and an unknown id; nothing is stored', async () => {
    const w = await kpiWorld();
    const cases: [string, string][] = [
      [w.ind.usage.id, 'must be an indicator in the thematic category Bibliographic'],
      [w.ind.note.id, 'must be an indicator with a numeric value type'],
      [crypto.randomUUID(), 'is not an indicator'],
    ];
    for (const [id, message] of cases) {
      const error = await rejection(w.save(id));
      expect(error.status).toBe(422);
      expect(error.errors).toEqual([{ in: 'body', path: 'values.kpi.indicatorId', message }]);
    }
    const settings = (w.kernel.services.get('core.settings') as SettingsInternalsBundle).settings;
    expect((await settings.get(w.people.admin, 'bibliometrics')).version).toBe(0);
  });

  it('still lets an administrator save another setting after the chosen indicator changed category', async () => {
    const w = await kpiWorld();
    await w.save(w.ind.citations.id);
    await w.pool.query(`update kpif_indicator set thematic = 'Usage' where id = $1`, [
      w.ind.citations.id,
    ]);
    const settings = (w.kernel.services.get('core.settings') as SettingsInternalsBundle).settings;
    const current = await settings.get(w.people.admin, 'bibliometrics');
    const saved = await settings.update(w.people.admin, 'bibliometrics', {
      version: current.version,
      values: { enabled: false, kpi: { indicatorId: w.ind.citations.id } },
    });
    expect(saved.values).toMatchObject({ enabled: false });
  });

  it('is saved by an administrator only', async () => {
    const w = await kpiWorld();
    expect((await rejection(w.save(w.ind.citations.id, w.people.member))).status).toBe(403);
  });
});

describe('the trusted write', () => {
  it('is called by the refresh only: add, list, remove, check now and the history never write a KPI', async () => {
    const w = await kpiWorld();
    await w.save(w.ind.citations.id);
    const ingestion = w.kernel.services.get('kpi.ingestion') as {
      measurements: { upsertBatchAsSystem: (...args: unknown[]) => Promise<unknown> };
    };
    const spy = vi.spyOn(ingestion.measurements, 'upsertBatchAsSystem');
    try {
      const added = await w.biblio.publications.add(w.people.member, w.svc.id, uniqueDoi('only'));
      await w.biblio.publications.list(w.people.member, w.svc.id, { page: 0, pageSize: 5 });
      await w.biblio.citations.history(w.people.member, w.svc.id, added.id);
      await w.biblio.citations.requestRefresh(w.people.member, w.svc.id);
      await w.biblio.publications.remove(w.people.member, w.svc.id, added.id);
      expect(spy).not.toHaveBeenCalled();
      await w.add(w.svc.id, 3);
      await w.refresh([w.svc.id]);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![2]).toEqual({ source: KPI_SOURCE });
    } finally {
      spy.mockRestore();
    }
  });

  it('is named in the source by the kpi write and the wiring of the module only, in the whole repository outside kpi.ingestion', () => {
    const repo = new URL('../../../', import.meta.url).pathname;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|svelte|js)$/.test(name) && !/\.test\.ts$|\.d\.ts$/.test(name))
          files.push(path);
      }
    };
    for (const top of ['apps', 'modules', 'packages', 'tools'])
      walk(join(repo, top));
    const callers = files
      .filter((file) => readFileSync(file, 'utf8').includes('upsertBatchAsSystem'))
      .map((file) => relative(repo, file))
      .filter((file) => !file.startsWith('modules/kpi-ingestion/'))
      .sort();
    expect(callers).toEqual([
      'modules/bibliometrics/service/kpi-write.ts',
    ]);
    // In the module, `writeKpi` is called from `refresh` only.
    const citations = readFileSync(join(repo, 'modules/bibliometrics/service/citations.ts'), 'utf8');
    expect(citations.match(/writeKpi\(/g)).toHaveLength(1);
    const refreshBody = citations.slice(
      citations.indexOf('async refresh(trigger'),
      citations.indexOf('async requestRefresh('),
    );
    expect(refreshBody).toContain('writeKpi(');
  });
});
