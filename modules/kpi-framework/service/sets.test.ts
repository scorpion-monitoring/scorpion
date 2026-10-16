// The KPI set service over real Postgres: every method with a denied case, a rollback case for each multi-row
// write, and the replacement of the rows (add, change necessity, remove) in one transaction.
import { Forbidden, NotFound } from '@scorpion/contracts';
import { makeIndicator, makeKpiSet } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useKpi } from '../test/harness.ts';
import { breakOutbox, paths, payloads, rejection, uniq, world } from '../test/world.ts';

const h = useKpi();
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';
type W = Awaited<ReturnType<typeof world>>;
const events = (w: W) => payloads(w.pool, 'kpi.set.changed@1');
const rowsOf = async (w: W, setId: string) =>
  (
    await w.pool.query<{ indicator_id: string; necessity: string }>(
      'select indicator_id, necessity from kpif_kpi_set_indicator where set_id = $1 order by indicator_id',
      [setId],
    )
  ).rows;

describe('sets.create, get, update, delete', () => {
  it('creates a set with a slug from the name, an IRI and an optional RIMO category', async () => {
    const w = await world(await h.start());
    await w.configure({ iriBase: 'https://kpi.example.org/base/' });
    const name = `Web ${uniq('apps')}`;
    const set = await w.kpi.sets.create(w.admin, {
      name,
      rimoCategory: 'Web_application',
      description: ' About ',
    });
    expect(set).toMatchObject({
      name,
      description: 'About',
      rimoCategory: 'Web_application',
      indicators: [],
      evaluation: null,
      indicatorCount: 0,
    });
    expect(set.iri).toBe(`https://kpi.example.org/base/kpi/set/${set.slug}`);
    expect(await w.kpi.sets.get(w.plain, set.id)).toEqual(set);
    expect(await events(w)).toEqual([
      { setId: set.id, change: 'created', fields: [], actorId: w.admin.userId },
    ]);
  });

  it('answers 409 for a taken name or slug, 422 for an unknown category, 404 and 422 for ids, and denies a plain user', async () => {
    const w = await world(await h.start());
    const a = await w.kpi.sets.create(w.admin, { name: uniq('Dup') });
    const name = await rejection(w.kpi.sets.create(w.admin, { name: a.name.toLowerCase() }));
    expect([name.status, paths(name)]).toEqual([409, ['name']]);
    const slug = await rejection(w.kpi.sets.create(w.admin, { name: uniq('Other'), slug: a.slug }));
    expect([slug.status, paths(slug)]).toEqual([409, ['slug']]);
    const bad = await rejection(
      w.kpi.sets.create(w.admin, { name: uniq('Cat'), rimoCategory: 'Nope' }),
    );
    expect([bad.status, paths(bad)]).toEqual([422, ['rimoCategory']]);
    expect(await rejection(w.kpi.sets.get(w.admin, ABSENT))).toBeInstanceOf(NotFound);
    expect((await rejection(w.kpi.sets.get(w.admin, '%20'))).status).toBe(422);
    await expect(w.kpi.sets.create(w.plain, { name: uniq('x') })).rejects.toBeInstanceOf(Forbidden);
    await expect(w.kpi.sets.update(w.plain, a.id, { name: 'x' })).rejects.toBeInstanceOf(Forbidden);
    await expect(w.kpi.sets.delete(w.plain, a.id)).rejects.toBeInstanceOf(Forbidden);
    await expect(
      w.kpi.sets.setIndicators(w.plain, a.id, { indicators: [] }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it('updates by replacement, keeps the slug and a deactivated category it has', async () => {
    const w = await world(await h.start());
    const set = await w.kpi.sets.create(w.admin, {
      name: uniq('Upd'),
      rimoCategory: 'SPARQL_endpoint',
    });
    await w.settings.vocabularies.updateTerm(w.admin, 'kpi.service-category', 'SPARQL_endpoint', {
      active: false,
    });
    const name = uniq('Renamed');
    const next = await w.kpi.sets.update(w.admin, set.id, {
      name,
      rimoCategory: 'SPARQL_endpoint',
      description: 'd',
    });
    expect(next).toMatchObject({
      name,
      slug: set.slug,
      rimoCategory: 'SPARQL_endpoint',
      description: 'd',
    });
    const bad = await rejection(
      w.kpi.sets
        .update(w.admin, set.id, { name, rimoCategory: 'Web_application' })
        .then(() => w.kpi.sets.update(w.admin, set.id, { name, rimoCategory: 'SPARQL_endpoint' }))
        .then(() =>
          w.kpi.sets.create(w.admin, { name: uniq('n'), rimoCategory: 'SPARQL_endpoint' }),
        ),
    );
    expect(paths(bad)).toEqual(['rimoCategory']);
    const last = (await events(w)).at(-1);
    expect(last).toMatchObject({ change: 'updated' });
  });

  it('deletes by id with its rows and its evaluation, and rolls back when the event cannot be stored', async () => {
    const w = await world(await h.start());
    const ind = await makeIndicator(w.pool);
    const set = await makeKpiSet(w.pool, {
      indicators: [{ indicatorId: ind.id, necessity: 'mandatory' }],
      evaluation: { indicatorId: ind.id, aggregate: 'sum' },
    });
    const restore = await breakOutbox(w.pool);
    await expect(w.kpi.sets.delete(w.admin, set.id)).rejects.toThrow();
    await restore();
    expect(await rowsOf(w, set.id)).toHaveLength(1);
    expect(
      (await w.pool.query('select 1 from kpif_evaluation where set_id = $1', [set.id])).rowCount,
    ).toBe(1);
    await w.kpi.sets.delete(w.admin, set.id);
    expect(await rowsOf(w, set.id)).toEqual([]);
    expect(
      (await w.pool.query('select 1 from kpif_evaluation where set_id = $1', [set.id])).rowCount,
    ).toBe(0);
    expect((await w.kpi.indicators.get(w.admin, ind.id)).setCount).toBe(0);
    expect(await rejection(w.kpi.sets.delete(w.admin, set.id))).toBeInstanceOf(NotFound);
  });
});

describe('sets.list', () => {
  it('counts rows per necessity, filters, sorts by name then id and pages from 0', async () => {
    const w = await world(await h.start());
    const tag = uniq('lst');
    const i1 = await makeIndicator(w.pool);
    const i2 = await makeIndicator(w.pool);
    const b = await makeKpiSet(w.pool, {
      name: `${tag} B`,
      rimoCategory: 'Web_application',
      indicators: [
        { indicatorId: i1.id, necessity: 'mandatory' },
        { indicatorId: i2.id, necessity: 'optional' },
      ],
      evaluation: { indicatorId: i1.id, aggregate: 'sum' },
    });
    const a = await makeKpiSet(w.pool, { name: `${tag} A` });
    const list = (filter: object, page = 0, pageSize = 20) =>
      w.kpi.sets.list(w.plain, { q: tag, ...filter }, { page, pageSize });
    const all = await list({});
    expect(all.sets.map((s) => s.id)).toEqual([a.id, b.id]);
    expect(all.sets[1]).toMatchObject({
      indicatorCount: 2,
      necessityCounts: { mandatory: 1, optional: 1 },
      hasEvaluation: true,
    });
    expect(all.sets[0]).toMatchObject({
      indicatorCount: 0,
      necessityCounts: {},
      hasEvaluation: false,
    });
    expect((await list({ rimoCategory: 'Web_application' })).sets.map((s) => s.id)).toEqual([b.id]);
    expect((await list({ sort: 'rimoCategory' })).sets.map((s) => s.id)).toEqual([b.id, a.id]);
    expect((await list({}, 1, 1)).sets.map((s) => s.id)).toEqual([b.id]);
    expect((await list({ q: `${tag} %` })).total).toBe(0);
  });
});

describe('sets.setIndicators', () => {
  it('adds, changes a necessity and removes in one write, and emits one event naming `indicators`', async () => {
    const w = await world(await h.start());
    const [i1, i2, i3] = await Promise.all([
      makeIndicator(w.pool),
      makeIndicator(w.pool),
      makeIndicator(w.pool),
    ]);
    const set = await w.kpi.sets.create(w.admin, { name: uniq('Rows') });
    const first = await w.kpi.sets.setIndicators(w.admin, set.id, {
      indicators: [
        { indicatorId: i1.id, necessity: 'mandatory' },
        { indicatorId: i2.id, necessity: 'optional' },
      ],
    });
    expect(first.indicators.map((r) => [r.indicatorId, r.necessity]).sort()).toEqual(
      [
        [i1.id, 'mandatory'],
        [i2.id, 'optional'],
      ].sort(),
    );
    const second = await w.kpi.sets.setIndicators(w.admin, set.id, {
      indicators: [
        { indicatorId: i2.id, necessity: 'recommended' },
        { indicatorId: i3.id, necessity: 'optional' },
      ],
    });
    expect(new Map(second.indicators.map((r) => [r.indicatorId, r.necessity]))).toEqual(
      new Map([
        [i2.id, 'recommended'],
        [i3.id, 'optional'],
      ]),
    );
    expect((await events(w)).at(-1)).toEqual({
      setId: set.id,
      change: 'updated',
      fields: ['indicators'],
      actorId: w.admin.userId,
    });
    const before = (await events(w)).length;
    await w.kpi.sets.setIndicators(w.admin, set.id, {
      indicators: [
        { indicatorId: i2.id, necessity: 'recommended' },
        { indicatorId: i3.id, necessity: 'optional' },
      ],
    });
    expect((await events(w)).length).toBe(before);
    const empty = await w.kpi.sets.setIndicators(w.admin, set.id, { indicators: [] });
    expect(empty.indicators).toEqual([]);
  });

  it('clears the evaluation in the same write when its headline is removed', async () => {
    const w = await world(await h.start());
    const [i1, i2] = await Promise.all([makeIndicator(w.pool), makeIndicator(w.pool)]);
    const set = await makeKpiSet(w.pool, {
      indicators: [
        { indicatorId: i1.id, necessity: 'mandatory' },
        { indicatorId: i2.id, necessity: 'optional' },
      ],
      evaluation: { indicatorId: i1.id, aggregate: 'sum' },
    });
    const kept = await w.kpi.sets.setIndicators(w.admin, set.id, {
      indicators: [{ indicatorId: i1.id, necessity: 'recommended' }],
    });
    expect(kept.evaluation).toMatchObject({ indicatorId: i1.id });
    const gone = await w.kpi.sets.setIndicators(w.admin, set.id, {
      indicators: [{ indicatorId: i2.id, necessity: 'optional' }],
    });
    expect(gone.evaluation).toBeNull();
    expect((await events(w)).at(-1)).toMatchObject({ fields: ['indicators', 'evaluation'] });
  });

  it('answers 422 naming each bad path for an empty necessity, an unknown term, an unknown indicator and a repeat', async () => {
    const w = await world(await h.start());
    const [i1, i2] = await Promise.all([makeIndicator(w.pool), makeIndicator(w.pool)]);
    const set = await w.kpi.sets.create(w.admin, { name: uniq('Bad') });
    const bad = await rejection(
      w.kpi.sets.setIndicators(w.admin, set.id, {
        indicators: [
          { indicatorId: i1.id, necessity: '' },
          { indicatorId: i2.id, necessity: 'sometimes' },
          { indicatorId: ABSENT, necessity: 'optional' },
          { indicatorId: i1.id, necessity: 'optional' },
        ],
      }),
    );
    expect(bad.status).toBe(422);
    expect(paths(bad)).toEqual([
      'indicators[0].necessity',
      'indicators[1].necessity',
      'indicators[2].indicatorId',
      'indicators[3].indicatorId',
    ]);
    expect(await rowsOf(w, set.id)).toEqual([]);
    expect(
      (
        await rejection(
          w.kpi.sets.setIndicators(w.admin, set.id, {
            indicators: [{ indicatorId: 'nope', necessity: 'optional' }],
          }),
        )
      ).status,
    ).toBe(422);
    expect(
      await rejection(w.kpi.sets.setIndicators(w.admin, ABSENT, { indicators: [] })),
    ).toBeInstanceOf(NotFound);
  });

  it('lets a row keep a deactivated necessity it has and refuses it for a new row', async () => {
    const w = await world(await h.start());
    const [i1, i2] = await Promise.all([makeIndicator(w.pool), makeIndicator(w.pool)]);
    const set = await makeKpiSet(w.pool, {
      indicators: [{ indicatorId: i1.id, necessity: 'optional' }],
    });
    await w.settings.vocabularies.updateTerm(w.admin, 'necessity', 'optional', { active: false });
    const ok = await w.kpi.sets.setIndicators(w.admin, set.id, {
      indicators: [{ indicatorId: i1.id, necessity: 'optional' }],
    });
    expect(ok.indicators).toHaveLength(1);
    const bad = await rejection(
      w.kpi.sets.setIndicators(w.admin, set.id, {
        indicators: [
          { indicatorId: i1.id, necessity: 'optional' },
          { indicatorId: i2.id, necessity: 'optional' },
        ],
      }),
    );
    expect(paths(bad)).toEqual(['indicators[1].necessity']);
  });

  it('rolls every row back when the event cannot be stored: no first row, no removal, evaluation kept', async () => {
    const w = await world(await h.start());
    const [i1, i2, i3] = await Promise.all([
      makeIndicator(w.pool),
      makeIndicator(w.pool),
      makeIndicator(w.pool),
    ]);
    const set = await makeKpiSet(w.pool, {
      indicators: [
        { indicatorId: i1.id, necessity: 'mandatory' },
        { indicatorId: i2.id, necessity: 'optional' },
      ],
      evaluation: { indicatorId: i1.id, aggregate: 'sum' },
    });
    const before = await rowsOf(w, set.id);
    const restore = await breakOutbox(w.pool);
    await expect(
      w.kpi.sets.setIndicators(w.admin, set.id, {
        indicators: [
          { indicatorId: i2.id, necessity: 'mandatory' },
          { indicatorId: i3.id, necessity: 'optional' },
        ],
      }),
    ).rejects.toThrow();
    await restore();
    expect(await rowsOf(w, set.id)).toEqual(before);
    expect((await w.kpi.sets.get(w.admin, set.id)).evaluation).toMatchObject({
      indicatorId: i1.id,
    });
  });
});
