// The evaluation: the headline must be a row of the set, and its aggregate must fit the indicator's value type
// (registry data) and be an active term of the `aggregate` vocabulary.
import { Forbidden, NotFound } from '@scorpion/contracts';
import { makeIndicator, makeKpiSet } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useKpi } from '../test/harness.ts';
import { breakOutbox, paths, payloads, rejection, uniq, world } from '../test/world.ts';
import { fixtureContributor } from '../test/harness.ts';

const h = useKpi();
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';

async function setup(valueType = 'integer') {
  const w = await world(await h.start());
  const ind = await makeIndicator(w.pool, { valueType });
  const other = await makeIndicator(w.pool);
  const set = await makeKpiSet(w.pool, {
    indicators: [{ indicatorId: ind.id, necessity: 'mandatory' }],
  });
  return { w, ind, other, set };
}

describe('evaluation.get and set', () => {
  it('answers null without a headline, sets one, replaces it and emits one event naming `evaluation`', async () => {
    const { w, ind, set } = await setup();
    expect(await w.kpi.evaluation.get(w.plain, set.id)).toBeNull();
    const saved = await w.kpi.evaluation.set(w.admin, set.id, {
      indicatorId: ind.id,
      aggregate: 'sum',
    });
    expect(saved).toMatchObject({ setId: set.id, indicatorId: ind.id, aggregate: 'sum' });
    expect(await w.kpi.evaluation.get(w.plain, set.id)).toEqual(saved);
    const again = await w.kpi.evaluation.set(w.admin, set.id, {
      indicatorId: ind.id,
      aggregate: 'sum',
    });
    expect(again.updatedAt).toEqual(saved.updatedAt);
    const next = await w.kpi.evaluation.set(w.admin, set.id, {
      indicatorId: ind.id,
      aggregate: 'max',
    });
    expect(next.aggregate).toBe('max');
    const rows = await payloads(w.pool, 'kpi.set.changed@1');
    expect(rows.map((r) => r.fields)).toEqual([['evaluation'], ['evaluation']]);
  });

  it('refuses an indicator outside the set, an aggregate the value type does not allow and an unknown one (422)', async () => {
    const { w, ind, other, set } = await setup();
    expect(
      paths(
        await rejection(
          w.kpi.evaluation.set(w.admin, set.id, { indicatorId: other.id, aggregate: 'sum' }),
        ),
      ),
    ).toEqual(['indicatorId']);
    expect(
      paths(
        await rejection(
          w.kpi.evaluation.set(w.admin, set.id, { indicatorId: ABSENT, aggregate: 'sum' }),
        ),
      ),
    ).toEqual(['indicatorId']);
    expect(
      paths(
        await rejection(
          w.kpi.evaluation.set(w.admin, set.id, { indicatorId: ind.id, aggregate: 'median' }),
        ),
      ),
    ).toEqual(['aggregate']);
    expect(
      (
        await rejection(
          w.kpi.evaluation.set(w.admin, set.id, { indicatorId: ind.id, aggregate: '' }),
        )
      ).status,
    ).toBe(422);
    expect(await w.kpi.evaluation.get(w.admin, set.id)).toBeNull();
  });

  it('follows the registry: percentages have no sum, text has no aggregate at all', async () => {
    const pct = await setup('percentage');
    expect(
      paths(
        await rejection(
          pct.w.kpi.evaluation.set(pct.w.admin, pct.set.id, {
            indicatorId: pct.ind.id,
            aggregate: 'sum',
          }),
        ),
      ),
    ).toEqual(['aggregate']);
    expect(
      (
        await pct.w.kpi.evaluation.set(pct.w.admin, pct.set.id, {
          indicatorId: pct.ind.id,
          aggregate: 'avg',
        })
      ).aggregate,
    ).toBe('avg');
    const text = await setup('text');
    expect(
      (
        await rejection(
          text.w.kpi.evaluation.set(text.w.admin, text.set.id, {
            indicatorId: text.ind.id,
            aggregate: 'max',
          }),
        )
      ).status,
    ).toBe(422);
  });

  it('refuses a deactivated aggregate for a new headline and keeps one the headline has', async () => {
    const { w, ind, set } = await setup();
    await w.kpi.evaluation.set(w.admin, set.id, { indicatorId: ind.id, aggregate: 'sum' });
    await w.settings.vocabularies.updateTerm(w.admin, 'aggregate', 'sum', { active: false });
    await w.settings.vocabularies.updateTerm(w.admin, 'aggregate', 'min', { active: false });
    expect(
      (await w.kpi.evaluation.set(w.admin, set.id, { indicatorId: ind.id, aggregate: 'sum' }))
        .aggregate,
    ).toBe('sum');
    expect(
      paths(
        await rejection(
          w.kpi.evaluation.set(w.admin, set.id, { indicatorId: ind.id, aggregate: 'min' }),
        ),
      ),
    ).toEqual(['aggregate']);
  });

  it('answers 404 for an unknown set, 422 for a malformed id, and denies a plain user the write', async () => {
    const { w, ind, set } = await setup();
    expect(await rejection(w.kpi.evaluation.get(w.admin, ABSENT))).toBeInstanceOf(NotFound);
    expect(
      await rejection(
        w.kpi.evaluation.set(w.admin, ABSENT, { indicatorId: ind.id, aggregate: 'sum' }),
      ),
    ).toBeInstanceOf(NotFound);
    expect((await rejection(w.kpi.evaluation.get(w.admin, 'x'))).status).toBe(422);
    await expect(
      w.kpi.evaluation.set(w.plain, set.id, { indicatorId: ind.id, aggregate: 'sum' }),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(await w.kpi.evaluation.get(w.admin, set.id)).toBeNull();
  });

  it('writes nothing when the event cannot be stored', async () => {
    const { w, ind, set } = await setup();
    const restore = await breakOutbox(w.pool);
    await expect(
      w.kpi.evaluation.set(w.admin, set.id, { indicatorId: ind.id, aggregate: 'sum' }),
    ).rejects.toThrow();
    await restore();
    expect(await w.kpi.evaluation.get(w.admin, set.id)).toBeNull();
  });

  it('uses the aggregates a contributed value type declares, without a change here', async () => {
    const extra = fixtureContributor({
      contributes: {
        'kpi.valueType': [
          {
            id: 'rating',
            labels: { en: 'Rating' },
            numeric: true,
            aggregates: ['avg'],
            parse: (v: unknown) => ({ ok: true, value: v }),
            format: String,
            schema: () => ({}),
          },
        ],
      },
    });
    const s = await h.start({ extra: [extra] });
    const w = await world(s);
    const ind = await makeIndicator(w.pool, { valueType: 'rating' });
    const set = await makeKpiSet(w.pool, {
      indicators: [{ indicatorId: ind.id, necessity: 'optional' }],
    });
    expect(
      paths(
        await rejection(
          w.kpi.evaluation.set(w.admin, set.id, { indicatorId: ind.id, aggregate: 'sum' }),
        ),
      ),
    ).toEqual(['aggregate']);
    expect(
      (await w.kpi.evaluation.set(w.admin, set.id, { indicatorId: ind.id, aggregate: 'avg' }))
        .aggregate,
    ).toBe('avg');
    void uniq;
  });
});
