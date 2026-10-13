// The conditions of the catalogue as plain functions (no database): the search with its escape, a facet's
// choice (OR within, "none" apart from the values), AND across facets, and the set a facet counts over,
// which leaves its own choice out. The rows they select are checked against Postgres in `catalogue.test.ts`.
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { catalogueCondition, searchCondition, selectionOf } from './catalogue.ts';
import { FACET_EMPTY, type FacetEntry, type FacetSelection } from './registries.ts';

const dialect = new PgDialect();
const render = (condition: SQL | undefined) => {
  if (!condition) return { sql: '', params: [] as unknown[] };
  const { sql: text, params } = dialect.sqlToQuery(condition);
  return { sql: text, params };
};

/** A facet whose condition shows what it was asked: its id, the keys and whether "none" was chosen. */
const fake = (id: string): FacetEntry => ({
  id,
  labels: { en: id },
  order: 1,
  where: (selection: FacetSelection) =>
    sql`${sql.raw(id)}(${sql.join(
      selection.keys.map((key) => sql`${key}`),
      sql`, `,
    )}${sql.raw(selection.empty ? ' +none' : '')})`,
  values: () => Promise.resolve([]),
});
const facets = [fake('a'), fake('b'), fake('c')];

describe('selectionOf', () => {
  it.each<[string[], FacetSelection]>([
    [[], { keys: [], empty: false }],
    [['x'], { keys: ['x'], empty: false }],
    [['x', 'x', 'y'], { keys: ['x', 'y'], empty: false }],
    [[FACET_EMPTY], { keys: [], empty: true }],
    [['x', FACET_EMPTY], { keys: ['x'], empty: true }],
  ])('%j', (values, expected) => {
    expect(selectionOf(values)).toEqual(expected);
  });
});

describe('searchCondition', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['   ', ''],
  ])('is nothing for %j', (q, expected) => {
    expect(render(searchCondition(q)).sql).toBe(expected);
  });

  it.each([
    ['galaxy', '%galaxy%'],
    ['  galaxy ', '%galaxy%'],
    ['100%', '%100\\%%'],
    ['a_b', '%a\\_b%'],
    ['back\\slash', '%back\\\\slash%'],
    ["o'brien; drop table", "%o'brien; drop table%"],
  ])(
    'takes %j as text, as the pattern %j, once for the slug and once for the name',
    (q, pattern) => {
      const { sql: text, params } = render(searchCondition(q));
      expect(text).toContain("ilike $1 escape '\\'");
      expect(text).toContain("ilike $2 escape '\\'");
      expect(params).toEqual([pattern, pattern]);
    },
  );
});

describe('catalogueCondition', () => {
  const run = (filters: Record<string, string[]>, options: { q?: string; except?: string } = {}) =>
    render(catalogueCondition(facets, { q: options.q, filters }, options.except));

  it('has no condition without a search or a choice', () => {
    expect(run({}).sql).toBe('');
    expect(run({ a: [] }).sql).toBe('');
  });

  it('gives a facet all its chosen keys at once, which is OR within the facet', () => {
    expect(run({ a: ['x', 'y', 'z'] })).toEqual({ sql: 'a($1, $2, $3)', params: ['x', 'y', 'z'] });
  });

  it('keeps "none" apart from the keys, so a facet can ask for either', () => {
    expect(run({ a: [FACET_EMPTY] })).toEqual({ sql: 'a( +none)', params: [] });
    expect(run({ a: ['x', FACET_EMPTY] })).toEqual({ sql: 'a($1 +none)', params: ['x'] });
  });

  it('joins facets with AND, in the order of the registry', () => {
    expect(run({ c: ['3'], a: ['1'], b: ['2'] })).toEqual({
      sql: '(a($1) and b($2) and c($3))',
      params: ['1', '2', '3'],
    });
  });

  it('puts the search before the facets and ANDs it', () => {
    const { sql: text, params } = run({ a: ['x'] }, { q: 'gal' });
    expect(text).toMatch(/^\(\(.*ilike \$1.*ilike \$2.*\) and a\(\$3\)\)$/);
    expect(params).toEqual(['%gal%', '%gal%', 'x']);
  });

  it('leaves the facet it counts for out, and keeps the search and every other facet', () => {
    expect(run({ a: ['1'], b: ['2'], c: ['3'] }, { except: 'b' })).toEqual({
      sql: '(a($1) and c($2))',
      params: ['1', '3'],
    });
    expect(run({ b: ['2'] }, { except: 'b' }).sql).toBe('');
    expect(run({ b: ['2'] }, { except: 'b', q: 'x' }).params).toEqual(['%x%', '%x%']);
  });

  it('ignores a choice for a facet nobody registered (the service refuses it before it gets here)', () => {
    expect(run({ nope: ['x'] }).sql).toBe('');
  });
});
