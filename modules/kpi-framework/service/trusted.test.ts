// `effectiveIndicatorsAsSystem` on real Postgres (M10 sprint 2): the effective rows of a service with the bounds of each indicator,
// read without a permission check. It is the same set `serviceKpis.get` answers with, so a test compares the two.
import { makeIndicator, makeKpiSet, makeServiceKpis } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useKpi } from '../test/harness.ts';
import { serviceWorld, uniq } from '../test/world.ts';

const h = useKpi();

describe('effectiveIndicatorsAsSystem', () => {
  it('is empty for a service without KPIs and for an id that is no service', async () => {
    const w = await serviceWorld(await h.start());
    expect(await w.kpi.effectiveIndicatorsAsSystem(w.svc.id)).toEqual([]);
    expect(await w.kpi.effectiveIndicatorsAsSystem('0198f3a8-5b21-7d40-9c1e-2a7f6b3d9e10')).toEqual(
      [],
    );
  });

  it('gives the rows of the set and the extras with value type, unit, necessity, source and bounds, as serviceKpis.get orders them', async () => {
    const w = await serviceWorld(await h.start());
    const bounded = await makeIndicator(w.pool, {
      name: uniq('Bounded'),
      valueType: 'integer',
      min: 0,
      max: 500,
      unit: 'count',
    });
    const free = await makeIndicator(w.pool, {
      name: uniq('Free'),
      valueType: 'float',
      thematic: 'Technical',
    });
    const extra = await makeIndicator(w.pool, { name: uniq('Extra'), valueType: 'duration' });
    const set = await makeKpiSet(w.pool, {
      name: uniq('set'),
      indicators: [
        { indicatorId: bounded.id, necessity: 'mandatory' },
        { indicatorId: free.id, necessity: 'recommended' },
      ],
    });
    await makeServiceKpis(w.pool, { serviceId: w.svc.id, setId: set.id, extras: [extra.id] });

    const rows = await w.kpi.effectiveIndicatorsAsSystem(w.svc.id);
    const view = await w.kpi.serviceKpis.get(w.people.manager, w.svc.id);
    expect(rows.map((row) => row.indicatorId)).toEqual(view.rows.map((row) => row.indicatorId));
    const byId = new Map(rows.map((row) => [row.indicatorId, row]));
    expect(byId.get(bounded.id)).toMatchObject({
      name: bounded.name,
      valueType: 'integer',
      unit: 'count',
      thematic: 'Usage',
      necessity: 'mandatory',
      source: 'set',
      min: 0,
      max: 500,
    });
    expect(byId.get(free.id)).toMatchObject({
      necessity: 'recommended',
      thematic: 'Technical',
      min: null,
      max: null,
    });
    expect(byId.get(extra.id)).toMatchObject({
      valueType: 'duration',
      necessity: 'optional',
      source: 'extra',
    });
    // nothing of a measurement and nothing the effective set does not carry
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        'indicatorId',
        'max',
        'min',
        'name',
        'necessity',
        'source',
        'thematic',
        'unit',
        'valueType',
      ].sort(),
    );
  });

  it('never leaks the KPIs of another service', async () => {
    const w = await serviceWorld(await h.start());
    const mine = await makeIndicator(w.pool, { name: uniq('Mine') });
    const theirs = await makeIndicator(w.pool, { name: uniq('Theirs') });
    const other = await serviceWorld(w);
    await makeServiceKpis(w.pool, { serviceId: w.svc.id, extras: [mine.id] });
    await makeServiceKpis(w.pool, { serviceId: other.svc.id, extras: [theirs.id] });
    expect((await w.kpi.effectiveIndicatorsAsSystem(w.svc.id)).map((row) => row.name)).toEqual([
      mine.name,
    ]);
  });
});

describe('indicatorsByIdAsSystem', () => {
  it('gives name, IRI, value type and unit of the indicators asked for, a dropped one too, and leaves out what is no indicator', async () => {
    const w = await serviceWorld(await h.start());
    const a = await makeIndicator(w.pool, {
      name: uniq('A'),
      valueType: 'percentage',
      unit: 'percent',
      thematic: 'Satisfaction',
    });
    const b = await makeIndicator(w.pool, {
      name: uniq('B'),
      valueType: 'text',
      qualitative: true,
    });
    const rows = await w.kpi.indicatorsByIdAsSystem([
      a.id,
      b.id,
      a.id,
      'not-an-id',
      '0198f3a8-5b21-7d40-9c1e-2a7f6b3d9e10',
    ]);
    expect(rows.map((row) => row.id).sort()).toEqual([a.id, b.id].sort());
    const first = rows.find((row) => row.id === a.id)!;
    expect(first).toMatchObject({
      name: a.name,
      valueType: 'percentage',
      unit: 'percent',
      thematic: 'Satisfaction',
    });
    expect(first.iri).toMatch(/\/kpi\/indicator\//);
    expect(Object.keys(first).sort()).toEqual([
      'id',
      'iri',
      'name',
      'thematic',
      'unit',
      'valueType',
    ]);
    expect(await w.kpi.indicatorsByIdAsSystem([])).toEqual([]);
  });
});

describe('evaluationOfServiceAsSystem', () => {
  it('is null for a service with no set and for an id that is no service', async () => {
    const w = await serviceWorld(await h.start());
    expect(await w.kpi.evaluationOfServiceAsSystem(w.svc.id)).toBeNull();
    expect(
      await w.kpi.evaluationOfServiceAsSystem('0198f3a8-5b21-7d40-9c1e-2a7f6b3d9e10'),
    ).toBeNull();
    expect(await w.kpi.evaluationOfServiceAsSystem('not-an-id')).toBeNull();
  });

  it('gives the set and no headline for a set with no evaluation', async () => {
    const w = await serviceWorld(await h.start());
    const one = await makeIndicator(w.pool, { name: uniq('One') });
    const set = await makeKpiSet(w.pool, {
      name: uniq('set'),
      indicators: [{ indicatorId: one.id, necessity: 'mandatory' }],
    });
    await makeServiceKpis(w.pool, { serviceId: w.svc.id, setId: set.id });
    expect(await w.kpi.evaluationOfServiceAsSystem(w.svc.id)).toEqual({
      setId: set.id,
      headline: null,
    });
  });

  it('gives the headline with its name, value type, unit and aggregate, and nothing else', async () => {
    const w = await serviceWorld(await h.start());
    const head = await makeIndicator(w.pool, {
      name: uniq('Head'),
      valueType: 'integer',
      unit: 'count',
    });
    const set = await makeKpiSet(w.pool, {
      name: uniq('set'),
      indicators: [{ indicatorId: head.id, necessity: 'mandatory' }],
      evaluation: { indicatorId: head.id, aggregate: 'sum' },
    });
    await makeServiceKpis(w.pool, { serviceId: w.svc.id, setId: set.id });
    const found = await w.kpi.evaluationOfServiceAsSystem(w.svc.id);
    expect(found).toEqual({
      setId: set.id,
      headline: {
        indicatorId: head.id,
        name: head.name,
        valueType: 'integer',
        unit: 'count',
        aggregate: 'sum',
      },
    });
    expect(Object.keys(found!.headline!).sort()).toEqual([
      'aggregate',
      'indicatorId',
      'name',
      'unit',
      'valueType',
    ]);
  });

  it('reads as no headline when the headline indicator left the set, as the set service removes the evaluation with it', async () => {
    const w = await serviceWorld(await h.start());
    const head = await makeIndicator(w.pool, { name: uniq('Head'), valueType: 'integer' });
    const keep = await makeIndicator(w.pool, { name: uniq('Keep'), valueType: 'integer' });
    const set = await makeKpiSet(w.pool, {
      name: uniq('set'),
      indicators: [
        { indicatorId: head.id, necessity: 'mandatory' },
        { indicatorId: keep.id, necessity: 'mandatory' },
      ],
      evaluation: { indicatorId: head.id, aggregate: 'sum' },
    });
    await makeServiceKpis(w.pool, { serviceId: w.svc.id, setId: set.id });
    await w.kpi.sets.setIndicators(w.people.admin, set.id, {
      indicators: [{ indicatorId: keep.id, necessity: 'mandatory' }],
    });
    expect(await w.kpi.evaluationOfServiceAsSystem(w.svc.id)).toEqual({
      setId: set.id,
      headline: null,
    });
  });
});

describe('servicesOfSetAsSystem', () => {
  it('lists the services of a set by id, and nothing for a set no service has, an unknown set or a bad id', async () => {
    const w = await serviceWorld(await h.start());
    const other = await serviceWorld(w);
    const lonely = await makeKpiSet(w.pool, { name: uniq('lonely') });
    const set = await makeKpiSet(w.pool, { name: uniq('set') });
    const elsewhere = await makeKpiSet(w.pool, { name: uniq('elsewhere') });
    await makeServiceKpis(w.pool, { serviceId: w.svc.id, setId: set.id });
    await makeServiceKpis(w.pool, { serviceId: other.svc.id, setId: set.id });
    const third = await serviceWorld(w);
    await makeServiceKpis(w.pool, { serviceId: third.svc.id, setId: elsewhere.id });
    expect(await w.kpi.servicesOfSetAsSystem(set.id)).toEqual([w.svc.id, other.svc.id].sort());
    expect(await w.kpi.servicesOfSetAsSystem(lonely.id)).toEqual([]);
    expect(await w.kpi.servicesOfSetAsSystem('0198f3a8-5b21-7d40-9c1e-2a7f6b3d9e10')).toEqual([]);
    expect(await w.kpi.servicesOfSetAsSystem('x')).toEqual([]);
  });
});
