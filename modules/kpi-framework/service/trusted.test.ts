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
    const free = await makeIndicator(w.pool, { name: uniq('Free'), valueType: 'float' });
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
      necessity: 'mandatory',
      source: 'set',
      min: 0,
      max: 500,
    });
    expect(byId.get(free.id)).toMatchObject({ necessity: 'recommended', min: null, max: null });
    expect(byId.get(extra.id)).toMatchObject({
      valueType: 'duration',
      necessity: 'optional',
      source: 'extra',
    });
    // nothing of a measurement and nothing the effective set does not carry
    expect(Object.keys(rows[0]!).sort()).toEqual(
      ['indicatorId', 'max', 'min', 'name', 'necessity', 'source', 'unit', 'valueType'].sort(),
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
    expect(first).toMatchObject({ name: a.name, valueType: 'percentage', unit: 'percent' });
    expect(first.iri).toMatch(/\/kpi\/indicator\//);
    expect(Object.keys(first).sort()).toEqual(['id', 'iri', 'name', 'unit', 'valueType']);
    expect(await w.kpi.indicatorsByIdAsSystem([])).toEqual([]);
  });
});
