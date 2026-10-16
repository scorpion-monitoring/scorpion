// The indicator service over real Postgres: every method, with the denied case of a plain user and the
// rollback case of every write that touches more than one row.
import { Forbidden, Invalid, NotFound } from '@scorpion/contracts';
import { makeIndicator, makeKpiSet } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useKpi } from '../test/harness.ts';
import { breakOutbox, count, paths, payloads, rejection, uniq, world } from '../test/world.ts';

const h = useKpi();
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';
const base = (name = uniq('Indicator')) => ({ name, valueType: 'integer', thematic: 'Usage' });

describe('indicators.create', () => {
  it('stores the RIMO fields and the links, makes the slug from the name and an IRI from the base', async () => {
    const w = await world(await h.start());
    await w.configure({ iriBase: 'https://kpi.example.org' });
    await w.settings.vocabularies.createTerm(w.admin, 'kpi.measured-by', {
      key: 'log-analysis',
      labels: { en: 'Log analysis' },
    });
    const name = `Page views ${uniq('x')}`;
    const view = await w.kpi.indicators.create(w.admin, {
      ...base(name),
      description: '  Views of a page. ',
      example: 'e.g. 120',
      unit: 'count',
      min: 0,
      max: 1000,
      measuredBy: ['log-analysis', 'log-analysis'],
    });
    expect(view.slug).toMatch(/^page-views-x-\d+-[a-z0-9]+$/);
    expect(view).toMatchObject({
      name,
      description: 'Views of a page.',
      example: 'e.g. 120',
      unit: 'count',
      min: 0,
      max: 1000,
      qualitative: false,
      measuredBy: ['log-analysis'],
      canBeAutomatedBy: [],
      setCount: 0,
      iri: `https://kpi.example.org/kpi/indicator/${view.slug}`,
    });
    expect(await w.kpi.indicators.get(w.plain, view.id)).toEqual(view);
  });

  it('makes a free slug when the generated one is taken, and answers 409 for a slug given twice', async () => {
    const w = await world(await h.start());
    const name = uniq('Same words');
    const a = await w.kpi.indicators.create(w.admin, base(name));
    const b = await w.kpi.indicators.create(w.admin, base(`${name}!`));
    expect(b.slug).not.toBe(a.slug);
    const slug = uniq('mine');
    await w.kpi.indicators.create(w.admin, { ...base(), slug });
    const dup = await rejection(
      w.kpi.indicators.create(w.admin, { ...base(), slug: slug.toUpperCase() }),
    );
    expect(dup.status).toBe(409);
    expect(paths(dup)).toEqual(['slug']);
  });

  it('answers 409 naming the name when it is taken without regard to case', async () => {
    const w = await world(await h.start());
    const name = uniq('Taken');
    await w.kpi.indicators.create(w.admin, base(name));
    const dup = await rejection(w.kpi.indicators.create(w.admin, base(name.toLowerCase())));
    expect(dup.status).toBe(409);
    expect(paths(dup)).toEqual(['name']);
  });

  it('answers one 422 that names every bad path: terms, value type, bounds, qualitative rule', async () => {
    const w = await world(await h.start());
    const bad = await rejection(
      w.kpi.indicators.create(w.admin, {
        ...base(),
        thematic: 'Nope',
        unit: 'parsec',
        measuredBy: ['ghost'],
        canBeAutomatedBy: ['ghost'],
      }),
    );
    expect(bad).toBeInstanceOf(Invalid);
    expect(paths(bad)).toEqual(['canBeAutomatedBy[0]', 'measuredBy[0]', 'thematic', 'unit']);
    const shape = await rejection(
      w.kpi.indicators.create(w.admin, { ...base(), valueType: 'nope' }),
    );
    expect(paths(shape)).toEqual(['valueType']);
    const text = await rejection(
      w.kpi.indicators.create(w.admin, { ...base(), valueType: 'text', min: 1 }),
    );
    expect(paths(text)).toEqual(['min']);
    const pct = await rejection(
      w.kpi.indicators.create(w.admin, { ...base(), valueType: 'percentage', max: 101 }),
    );
    expect(paths(pct)).toEqual(['max']);
    const order = await rejection(w.kpi.indicators.create(w.admin, { ...base(), min: 5, max: 1 }));
    expect(order.status).toBe(422);
    const qual = await rejection(
      w.kpi.indicators.create(w.admin, { ...base(), qualitative: true }),
    );
    expect(paths(qual)).toEqual(['qualitative']);
    const ok = await w.kpi.indicators.create(w.admin, {
      ...base(),
      valueType: 'text',
      qualitative: true,
    });
    expect(ok.qualitative).toBe(true);
  });

  it('refuses unknown keys, long text and a deactivated term', async () => {
    const w = await world(await h.start());
    expect(
      (await rejection(w.kpi.indicators.create(w.admin, { ...base(), colour: 'red' } as never)))
        .status,
    ).toBe(422);
    expect(
      (
        await rejection(
          w.kpi.indicators.create(w.admin, { ...base(), description: 'x'.repeat(4001) }),
        )
      ).status,
    ).toBe(422);
    expect((await rejection(w.kpi.indicators.create(w.admin, base('   ')))).status).toBe(422);
    await w.settings.vocabularies.updateTerm(w.admin, 'kpi.unit', 'byte', { active: false });
    const bad = await rejection(w.kpi.indicators.create(w.admin, { ...base(), unit: 'byte' }));
    expect(paths(bad)).toEqual(['unit']);
  });

  it('is denied to a plain user and writes nothing', async () => {
    const w = await world(await h.start());
    await expect(w.kpi.indicators.create(w.plain, base())).rejects.toBeInstanceOf(Forbidden);
    expect(await count(w.pool, 'kpif_indicator')).toBe(0);
  });

  it('rolls the row and the links back when the event cannot be stored', async () => {
    const w = await world(await h.start());
    await w.settings.vocabularies.createTerm(w.admin, 'kpi.measured-by', {
      key: 'm1',
      labels: { en: 'M1' },
    });
    const restore = await breakOutbox(w.pool);
    await expect(
      w.kpi.indicators.create(w.admin, { ...base(), measuredBy: ['m1'] }),
    ).rejects.toThrow();
    await restore();
    for (const table of ['kpif_indicator', 'kpif_indicator_means']) {
      expect(await count(w.pool, table)).toBe(0);
    }
  });

  it('emits kpi.indicator.changed with ids only', async () => {
    const w = await world(await h.start());
    const view = await w.kpi.indicators.create(w.admin, base());
    const events = await payloads(w.pool, 'kpi.indicator.changed@1');
    expect(events).toEqual([
      { indicatorId: view.id, change: 'created', fields: [], actorId: w.admin.userId },
    ]);
  });
});

describe('indicators.get and list', () => {
  it('answers 404 for an unknown id, 422 for a malformed one, and lets a plain user read', async () => {
    const w = await world(await h.start());
    expect(await rejection(w.kpi.indicators.get(w.plain, ABSENT))).toBeInstanceOf(NotFound);
    expect((await rejection(w.kpi.indicators.get(w.plain, 'not-an-id'))).status).toBe(422);
    const ind = await makeIndicator(w.pool);
    expect((await w.kpi.indicators.get(w.plain, ind.id)).id).toBe(ind.id);
  });

  it('filters, searches with the wildcards escaped, sorts by key then id and pages from 0', async () => {
    const w = await world(await h.start());
    const tag = uniq('lst');
    const a = await makeIndicator(w.pool, { name: `${tag} B`, thematic: 'Usage', unit: 'count' });
    const b = await makeIndicator(w.pool, { name: `${tag} A`, thematic: 'Technical' });
    const c = await makeIndicator(w.pool, {
      name: `${tag} C 100%`,
      qualitative: true,
      thematic: 'Usage',
    });
    const list = (filter: object, page = 0, pageSize = 20) =>
      w.kpi.indicators.list(w.plain, { q: tag, ...filter }, { page, pageSize });
    expect((await list({})).indicators.map((i) => i.id)).toEqual([b.id, a.id, c.id]);
    expect((await list({ thematic: 'Technical' })).indicators.map((i) => i.id)).toEqual([b.id]);
    expect((await list({ qualitative: true })).indicators.map((i) => i.id)).toEqual([c.id]);
    expect((await list({ unit: 'count' })).indicators.map((i) => i.id)).toEqual([a.id]);
    expect((await list({ q: `${tag} C 100%` })).total).toBe(1);
    expect((await list({ q: `${tag} _` })).total).toBe(0);
    expect((await list({ sort: 'thematic' })).indicators.map((i) => i.id)).toEqual([
      b.id,
      a.id,
      c.id,
    ]);
    const page1 = await list({}, 1, 2);
    expect(page1.total).toBe(3);
    expect(page1.indicators.map((i) => i.id)).toEqual([c.id]);
    expect((await list({}, 5)).indicators).toEqual([]);
  });
});

describe('indicators.update', () => {
  it('replaces the editable fields, keeps the slug on a rename and names changed fields only in the event', async () => {
    const w = await world(await h.start());
    await w.settings.vocabularies.createTerm(w.admin, 'kpi.automation-tool', {
      key: 'script',
      labels: { en: 'Script' },
    });
    const created = await w.kpi.indicators.create(w.admin, {
      ...base(),
      description: 'old',
      unit: 'count',
    });
    const name = uniq('Renamed');
    const updated = await w.kpi.indicators.update(w.admin, created.id, {
      ...base(name),
      description: 'new',
      canBeAutomatedBy: ['script'],
    });
    expect(updated).toMatchObject({
      name,
      description: 'new',
      unit: null,
      canBeAutomatedBy: ['script'],
    });
    expect(updated.slug).toBe(created.slug);
    const events = await payloads(w.pool, 'kpi.indicator.changed@1');
    expect(events.at(-1)).toEqual({
      indicatorId: created.id,
      change: 'updated',
      fields: ['name', 'description', 'unit', 'canBeAutomatedBy'],
      actorId: w.admin.userId,
    });
    expect(JSON.stringify(events)).not.toContain('Renamed');
  });

  it('writes and emits nothing when nothing changed', async () => {
    const w = await world(await h.start());
    const created = await w.kpi.indicators.create(w.admin, base());
    const before = await count(w.pool, 'kernel_outbox');
    await w.kpi.indicators.update(w.admin, created.id, base(created.name));
    expect(await count(w.pool, 'kernel_outbox')).toBe(before);
  });

  it('lets a row keep a deactivated term it has and refuses it for a new value', async () => {
    const w = await world(await h.start());
    const created = await w.kpi.indicators.create(w.admin, { ...base(), unit: 'byte' });
    await w.settings.vocabularies.updateTerm(w.admin, 'kpi.unit', 'byte', { active: false });
    const ok = await w.kpi.indicators.update(w.admin, created.id, {
      ...base(created.name),
      unit: 'byte',
      description: 'kept',
    });
    expect(ok.unit).toBe('byte');
    const other = await w.kpi.indicators.create(w.admin, base());
    const bad = await rejection(
      w.kpi.indicators.update(w.admin, other.id, { ...base(other.name), unit: 'byte' }),
    );
    expect(paths(bad)).toEqual(['unit']);
  });

  it('answers 404, 409 for a taken name, 422 for bad input, and is denied to a plain user', async () => {
    const w = await world(await h.start());
    const a = await w.kpi.indicators.create(w.admin, base());
    const b = await w.kpi.indicators.create(w.admin, base());
    expect(await rejection(w.kpi.indicators.update(w.admin, ABSENT, base()))).toBeInstanceOf(
      NotFound,
    );
    const dup = await rejection(w.kpi.indicators.update(w.admin, b.id, base(a.name)));
    expect(dup.status).toBe(409);
    expect(paths(dup)).toEqual(['name']);
    expect(
      (
        await rejection(
          w.kpi.indicators.update(w.admin, b.id, { ...base(b.name), thematic: 'Nope' }),
        )
      ).status,
    ).toBe(422);
    await expect(w.kpi.indicators.update(w.plain, b.id, base(b.name))).rejects.toBeInstanceOf(
      Forbidden,
    );
  });

  it('rolls the row and the links back when the event cannot be stored', async () => {
    const w = await world(await h.start());
    await w.settings.vocabularies.createTerm(w.admin, 'kpi.measured-by', {
      key: 'm2',
      labels: { en: 'M2' },
    });
    const created = await w.kpi.indicators.create(w.admin, base());
    const restore = await breakOutbox(w.pool);
    await expect(
      w.kpi.indicators.update(w.admin, created.id, { ...base(uniq('new')), measuredBy: ['m2'] }),
    ).rejects.toThrow();
    await restore();
    expect(await w.kpi.indicators.get(w.admin, created.id)).toEqual(created);
  });

  it('refuses a change of value type that strands the headline aggregate (409)', async () => {
    const w = await world(await h.start());
    const ind = await w.kpi.indicators.create(w.admin, base());
    const set = await w.kpi.sets.create(w.admin, { name: uniq('Set') });
    await w.kpi.sets.setIndicators(w.admin, set.id, {
      indicators: [{ indicatorId: ind.id, necessity: 'mandatory' }],
    });
    await w.kpi.evaluation.set(w.admin, set.id, { indicatorId: ind.id, aggregate: 'sum' });
    const stranded = await rejection(
      w.kpi.indicators.update(w.admin, ind.id, { ...base(ind.name), valueType: 'percentage' }),
    );
    expect(stranded.status).toBe(409);
    await w.kpi.evaluation.set(w.admin, set.id, { indicatorId: ind.id, aggregate: 'avg' });
    expect(
      (
        await w.kpi.indicators.update(w.admin, ind.id, {
          ...base(ind.name),
          valueType: 'percentage',
        })
      ).valueType,
    ).toBe('percentage');
  });
});

describe('indicators.delete', () => {
  it('deletes by id with its links and emits the event', async () => {
    const w = await world(await h.start());
    const ind = await makeIndicator(w.pool, { measuredBy: [] });
    await w.kpi.indicators.delete(w.admin, ind.id);
    expect(await rejection(w.kpi.indicators.get(w.admin, ind.id))).toBeInstanceOf(NotFound);
    const events = await payloads(w.pool, 'kpi.indicator.changed@1');
    expect(events.at(-1)).toMatchObject({ indicatorId: ind.id, change: 'deleted' });
  });

  it('answers 409 naming the module and the count while a set row or an evaluation uses it, and keeps everything', async () => {
    const w = await world(await h.start());
    const ind = await makeIndicator(w.pool);
    await makeKpiSet(w.pool, {
      indicators: [{ indicatorId: ind.id, necessity: 'mandatory' }],
      evaluation: { indicatorId: ind.id, aggregate: 'sum' },
    });
    await makeKpiSet(w.pool, { indicators: [{ indicatorId: ind.id, necessity: 'optional' }] });
    const blocked = await rejection(w.kpi.indicators.delete(w.admin, ind.id));
    expect(blocked.status).toBe(409);
    expect(blocked.type).toBe('kpi-in-use');
    expect(blocked.message).toContain('kpi.framework (2 sets)');
    expect(blocked.errors).toEqual([
      { in: 'usage', path: 'kpi.framework.sets', message: '2' },
      { in: 'usage', path: 'kpi.framework.evaluations', message: '1' },
    ]);
    expect((await w.kpi.indicators.get(w.admin, ind.id)).setCount).toBe(2);
  });

  it('answers 404, 422 and is denied to a plain user', async () => {
    const w = await world(await h.start());
    const ind = await makeIndicator(w.pool);
    expect(await rejection(w.kpi.indicators.delete(w.admin, ABSENT))).toBeInstanceOf(NotFound);
    expect((await rejection(w.kpi.indicators.delete(w.admin, 'x'))).status).toBe(422);
    await expect(w.kpi.indicators.delete(w.plain, ind.id)).rejects.toBeInstanceOf(Forbidden);
    expect((await w.kpi.indicators.get(w.admin, ind.id)).id).toBe(ind.id);
  });
});

describe('indicators.valueTypes', () => {
  it('lists the registered types for a reader and is denied to an anonymous caller', async () => {
    const w = await world(await h.start());
    const types = await w.kpi.indicators.valueTypes(w.plain);
    expect(types.map((t) => t.id).sort()).toEqual([
      'duration',
      'float',
      'integer',
      'percentage',
      'text',
    ]);
    expect(types.find((t) => t.id === 'percentage')).toMatchObject({
      numeric: true,
      range: { min: 0, max: 100 },
    });
    await expect(w.kpi.indicators.valueTypes({ kind: 'anonymous' } as never)).rejects.toThrow();
  });
});
