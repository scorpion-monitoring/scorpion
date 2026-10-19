// The rule of the effective KPI set, pure: the rows of the set with their necessity, plus the extras that the set
// does not contain as `optional`; no duplicate, the set's rows never removed or changed by an extra, a stable order
// whatever the order of the input. Table-driven cases first, then properties over generated data (a seeded
// generator, so a failure reproduces).
import { describe, expect, it } from 'vitest';
import { compareIndicators, EXTRA_NECESSITY, mergeEffective } from './merge.ts';

const row = (indicatorId: string, necessity = 'mandatory', name = `Name ${indicatorId}`) => ({
  indicatorId,
  necessity,
  name,
});
const extra = (indicatorId: string, name = `Name ${indicatorId}`) => ({ indicatorId, name });
const summary = (rows: ReturnType<typeof mergeEffective>) =>
  rows.map((entry) => `${entry.indicatorId}:${entry.necessity}:${entry.source}`);

describe('mergeEffective', () => {
  it.each([
    ['nothing', [], [], []],
    [
      'a set only',
      [row('a', 'mandatory'), row('b', 'optional')],
      [],
      ['a:mandatory:set', 'b:optional:set'],
    ],
    ['extras only', [], [extra('a'), extra('b')], ['a:optional:extra', 'b:optional:extra']],
    [
      'an extra the set contains is dropped, the row keeps its necessity',
      [row('a', 'mandatory')],
      [extra('a'), extra('b')],
      ['a:mandatory:set', 'b:optional:extra'],
    ],
    [
      'the set first, then the extras',
      [row('z', 'recommended')],
      [extra('a')],
      ['z:recommended:set', 'a:optional:extra'],
    ],
    ['an extra listed twice counts once', [], [extra('a'), extra('a')], ['a:optional:extra']],
    [
      'a row listed twice counts once',
      [row('a', 'optional'), row('a', 'optional')],
      [],
      ['a:optional:set'],
    ],
  ])('%s', (_what, setRows, extras, expected) => {
    expect(summary(mergeEffective(setRows, extras))).toEqual(expected);
  });

  it('gives an extra the necessity `optional`', () => {
    expect(EXTRA_NECESSITY).toBe('optional');
    expect(mergeEffective([], [extra('a')])[0]?.necessity).toBe('optional');
  });

  it('orders by name without case, then name, then id, in each group', () => {
    const rows = mergeEffective(
      [
        row('3', 'mandatory', 'beta'),
        row('2', 'mandatory', 'Alpha'),
        row('1', 'mandatory', 'alpha'),
      ],
      [extra('6', 'delta'), extra('5', 'Charlie')],
    );
    expect(rows.map((entry) => entry.indicatorId)).toEqual(['2', '1', '3', '5', '6']);
  });

  it('compares equal names by id', () => {
    expect(compareIndicators(extra('1', 'same'), extra('2', 'same'))).toBeLessThan(0);
    expect(compareIndicators(extra('2', 'same'), extra('2', 'same'))).toBe(0);
  });

  it('keeps the other fields of a row', () => {
    const [first] = mergeEffective([{ ...row('a'), unit: 'count' }], []);
    expect(first).toMatchObject({ unit: 'count', source: 'set' });
  });
});

// A small seeded generator (mulberry32): no dependency, and a failing run can be repeated by its seed.
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('mergeEffective, over generated data', () => {
  const NECESSITIES = ['mandatory', 'recommended', 'optional'];
  const names = ['alpha', 'Alpha', 'beta', 'Beta', 'gamma', 'delta'];

  function generate(seed: number) {
    const next = random(seed);
    const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
    const ids = Array.from({ length: 12 }, (_, index) => `id-${index}`);
    const nameOf = new Map(ids.map((id) => [id, pick(names)]));
    const setRows = ids
      .filter(() => next() < 0.4)
      .map((id) => ({ indicatorId: id, name: nameOf.get(id)!, necessity: pick(NECESSITIES) }));
    // Extras may repeat and may overlap the set.
    const extras = Array.from({ length: Math.floor(next() * 10) }, () => {
      const id = pick(ids);
      return { indicatorId: id, name: nameOf.get(id)! };
    });
    return { setRows, extras, next };
  }

  const seeds = Array.from({ length: 200 }, (_, index) => index + 1);

  it.each(seeds)(
    'seed %i: no duplicate, and every indicator of the input is there once',
    (seed) => {
      const { setRows, extras } = generate(seed);
      const merged = mergeEffective(setRows, extras);
      const ids = merged.map((entry) => entry.indicatorId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(ids)).toEqual(
        new Set([...setRows, ...extras].map((entry) => entry.indicatorId)),
      );
    },
  );

  it.each(seeds)(
    'seed %i: the rows of the set are never removed or changed by an extra',
    (seed) => {
      const { setRows, extras } = generate(seed);
      const merged = mergeEffective(setRows, extras);
      for (const original of setRows) {
        const found = merged.find((entry) => entry.indicatorId === original.indicatorId);
        expect(found).toMatchObject({ necessity: original.necessity, source: 'set' });
      }
      // An extra that is not in the set is `optional`, and an indicator in the set is never an extra.
      const inSet = new Set(setRows.map((entry) => entry.indicatorId));
      for (const entry of merged)
        expect(entry.source === 'extra').toBe(!inSet.has(entry.indicatorId));
      for (const entry of merged.filter((candidate) => candidate.source === 'extra'))
        expect(entry.necessity).toBe(EXTRA_NECESSITY);
    },
  );

  it.each(seeds)('seed %i: the order does not depend on the order of the input', (seed) => {
    const { setRows, extras, next } = generate(seed);
    const shuffle = <T>(list: readonly T[]) =>
      list
        .map((entry) => ({ entry, key: next() }))
        .sort((a, b) => a.key - b.key)
        .map(({ entry }) => entry);
    // Rows of one indicator repeat with the same data only, so every order gives the same result.
    expect(summary(mergeEffective(shuffle(setRows), shuffle(extras)))).toEqual(
      summary(mergeEffective(setRows, extras)),
    );
  });

  it('is stable: merging the merged rows again changes nothing', () => {
    const { setRows, extras } = generate(7);
    const once = mergeEffective(setRows, extras);
    const again = mergeEffective(
      once.filter((entry) => entry.source === 'set'),
      once.filter((entry) => entry.source === 'extra'),
    );
    expect(summary(again)).toEqual(summary(once));
  });
});
