// The rules for KPIs, KPI sets and the services' sets (plan §3, decisions 6 and 9) as tables. Pure.
import { describe, expect, it } from 'vitest';
import { transformKpis, type KpiFacts } from './kpi-transform.ts';
import { emptyMapping, type Mapping } from './mapping.ts';

const FACTS: KpiFacts = {
  valueTypes: ['integer', 'float'],
  thematic: ['Usage', 'Bibliographic'],
  units: ['count'],
  necessities: ['mandatory', 'optional'],
  rimoCategories: [],
};
/** `selected` is what the legacy API says: true when the category defines the KPI (it has a necessity there). */
const kpi = (
  name: string,
  categories: { name: string; necessity: string | null }[] = [],
  description: string | null = null,
  selected: boolean = categories.some((c) => c.necessity !== null),
) => ({
  name,
  description,
  categories,
  selected,
});
const service = (abbreviation: string, category = 'Tools') => ({
  abbreviation,
  name: abbreviation,
  category,
  provider: 'BioNet',
  license: null,
  consortia: [],
  stage: 'PROD',
});
const registry = (...legacy: string[]) => ({
  services: legacy.map((l) => ({
    legacy: l,
    slug: l,
    name: l,
    stage: 'PROD',
    license: null,
    provider: 'BioNet',
    consortia: [],
  })),
});
const mapping = (extra: Partial<Mapping> = {}): Mapping => ({
  ...emptyMapping(),
  indicators: {
    Users: { thematic: 'Usage' },
    Papers: { thematic: 'Bibliographic' },
    Extra: { thematic: 'Usage' },
  },
  ...extra,
});
const run = (
  options: {
    categories?: string[];
    byCategory?: Record<string, ReturnType<typeof kpi>[]>;
    byService?: Record<string, ReturnType<typeof kpi>[]>;
    services?: ReturnType<typeof service>[];
    measured?: Record<string, Record<string, number>>;
    mapping?: Mapping;
  } = {},
) =>
  transformKpis(
    {
      categories: (options.categories ?? ['Tools']).map((name) => ({ name })),
      services: options.services ?? [service('GeneFlow')],
      indicatorsByCategory: options.byCategory ?? {},
      indicatorsByService: options.byService ?? {},
    },
    new Map(
      Object.entries(options.measured ?? {}).map(([s, k]) => [s, new Map(Object.entries(k))]),
    ),
    options.mapping ?? mapping(),
    FACTS,
    registry(...(options.services ?? [service('GeneFlow')]).map((s) => s.abbreviation)),
  );
const rules = (p: ReturnType<typeof run>) =>
  p.findings.map((f) => `${f.kind}:${f.legacy}:${f.rule}`).sort();

describe('indicators', () => {
  it('migrates a KPI with the mapping thematic category, the default value type integer and the description', () => {
    const p = run({
      byCategory: { Tools: [kpi('Users', [{ name: 'Tools', necessity: 'mandatory' }], 'People')] },
    });
    expect(p.indicators).toEqual([
      {
        legacy: 'Users',
        name: 'Users',
        description: 'People',
        valueType: 'integer',
        thematic: 'Usage',
        unit: null,
      },
    ]);
    expect(p.findings).toEqual([]);
  });

  it.each([
    [
      'no thematic term (the run must stop)',
      mapping({ indicators: { Users: {} } }),
      'indicator.thematic-open',
    ],
    [
      'a thematic null',
      mapping({ indicators: { Users: { thematic: null } } }),
      'indicator.thematic-open',
    ],
    [
      'an unknown thematic key',
      mapping({ indicators: { Users: { thematic: 'Nope' } } }),
      'indicator.thematic-unknown',
    ],
    [
      'an unknown value type',
      mapping({ indicators: { Users: { thematic: 'Usage', valueType: 'text' } } }),
      'indicator.value-type-unknown',
    ],
    [
      'an unknown unit',
      mapping({ indicators: { Users: { thematic: 'Usage', unit: 'furlong' } } }),
      'indicator.unit-unknown',
    ],
  ])('%s is a blocking finding and the KPI is not migrated', (_name, m, rule) => {
    const p = run({
      byCategory: { Tools: [kpi('Users', [{ name: 'Tools', necessity: 'mandatory' }])] },
      mapping: m,
    });
    expect(p.indicators).toEqual([]);
    expect(p.findings).toMatchObject([
      {
        rule,
        effect: 'dropped',
        blocking: true,
      },
    ]);
    expect(p.findings[0]!.gap).toContain('indicators["Users"]');
    expect(p.unavailable.has('Users')).toBe(true);
  });

  it('is dropped by the mapping without blocking, and its values are unavailable', () => {
    const p = run({
      byCategory: { Tools: [kpi('Users', [{ name: 'Tools', necessity: 'mandatory' }])] },
      mapping: mapping({ indicators: { Users: { drop: true } } }),
    });
    expect(p.findings).toMatchObject([{ rule: 'indicator.dropped-by-mapping' }]);
    expect(p.findings[0]!.blocking).toBeUndefined();
  });

  it('refuses a name that another KPI has without case, and notes a KPI known only from measurements', () => {
    const p = run({
      byCategory: {
        Tools: [kpi('Users', [{ name: 'Tools', necessity: 'mandatory' }]), kpi('USERS')],
      },
      mapping: mapping({
        indicators: {
          Users: { thematic: 'Usage' },
          USERS: { thematic: 'Usage' },
          Extra: { thematic: 'Usage' },
        },
      }),
      measured: { GeneFlow: { Extra: 3 } },
    });
    // "USERS" sorts before "Users" in code-unit order, so it keeps the name and "Users" is the duplicate.
    expect(rules(p)).toEqual([
      'indicator:Extra:indicator.from-measurements',
      'indicator:Users:indicator.name-duplicate',
      'service-kpis:GeneFlow:service-kpis.kpi-added-optional',
    ]);
  });
});

describe('KPI sets (decision 6)', () => {
  it('takes the necessity of the category, with the legacy spelling kept', () => {
    const p = run({
      byCategory: {
        Tools: [
          kpi('Users', [{ name: 'Tools', necessity: 'mandatory' }]),
          kpi('Papers', [
            { name: 'Tools', necessity: 'optional' },
            { name: 'Other', necessity: 'mandatory' },
          ]),
        ],
      },
    });
    expect(p.sets).toEqual([
      {
        legacy: 'Tools',
        name: 'Tools',
        rimoCategory: null,
        rows: [
          { indicator: 'Papers', necessity: 'optional' },
          { indicator: 'Users', necessity: 'mandatory' },
        ],
      },
    ]);
  });

  it.each([
    [
      'none (HAS_KPIS without DEFINES) → the default, reported',
      null,
      'mandatory',
      'kpi-set.necessity-missing-mapped',
    ],
    ['a spelling in another case → the key', 'Optional', 'optional', 'kpi-set.necessity-respelled'],
    ['a spelling the mapping knows', 'required', 'mandatory', 'kpi-set.necessity-mapped'],
  ])('necessity %s', (_name, spelling, key, rule) => {
    const p = run({
      byCategory: { Tools: [kpi('Users', [{ name: 'Tools', necessity: spelling }], null, true)] },
      mapping: mapping({ necessities: { required: 'mandatory' } }),
    });
    expect(p.sets[0]!.rows).toEqual([{ indicator: 'Users', necessity: key }]);
    expect(rules(p)).toEqual([`kpi-set:Tools:${rule}`]);
  });

  it('lists every KPI for every category in the legacy answer, and only the ones the category defines are rows', () => {
    // As the real route answers: all KPIs under each category; `selected` and a necessity mark the ones it defines.
    const all = (category: string, defined: Record<string, string>) =>
      ['Users', 'Papers', 'Records'].map((name) =>
        kpi(name, [{ name: category, necessity: defined[name] ?? null }]),
      );
    const p = run({
      categories: ['Tools', 'Data', 'Consortia'],
      byCategory: {
        Tools: all('Tools', { Users: 'mandatory', Papers: 'optional' }),
        Data: all('Data', { Records: 'mandatory' }),
        Consortia: all('Consortia', {}),
      },
      mapping: mapping({
        indicators: {
          Users: { thematic: 'Usage' },
          Papers: { thematic: 'Usage' },
          Records: { thematic: 'Usage' },
        },
      }),
    });
    expect(
      Object.fromEntries(
        p.sets.map((s) => [s.legacy, s.rows.map((r) => `${r.indicator}:${r.necessity}`)]),
      ),
    ).toEqual({
      Tools: ['Papers:optional', 'Users:mandatory'],
      Data: ['Records:mandatory'],
      Consortia: [],
    });
    expect(p.findings.filter((f) => f.rule.includes('necessity'))).toEqual([]);
  });

  it('keeps a KPI the API marks selected but gives no necessity (decision 6: the default, reported)', () => {
    const p = run({
      byCategory: { Tools: [kpi('Users', [{ name: 'Tools', necessity: null }], null, true)] },
    });
    expect(p.sets[0]!.rows).toEqual([{ indicator: 'Users', necessity: 'mandatory' }]);
    expect(rules(p)).toEqual(['kpi-set:Tools:kpi-set.necessity-missing-mapped']);
  });

  it('leaves a row out for a necessity it cannot resolve, and the KPI becomes an extra where it has values', () => {
    const p = run({
      byCategory: { Tools: [kpi('Users', [{ name: 'Tools', necessity: 'vital' }])] },
      measured: { GeneFlow: { Users: 4 } },
    });
    expect(p.sets[0]!.rows).toEqual([]);
    expect(p.serviceKpis).toEqual([
      { legacy: 'GeneFlow', slug: 'GeneFlow', set: 'Tools', extras: ['Users'] },
    ]);
  });

  it('migrates a category without KPIs, and not one the mapping drops', () => {
    const p = run({
      categories: ['Tools', 'Consortia'],
      mapping: mapping({ kpiSets: { Consortia: { drop: true } } }),
    });
    expect(p.sets.map((s) => s.legacy)).toEqual(['Tools']);
    expect(rules(p)).toEqual(['kpi-set:Consortia:kpi-set.dropped-by-mapping']);
  });
});

describe("a service's set and extras (decision 9)", () => {
  const byCategory = { Tools: [kpi('Users', [{ name: 'Tools', necessity: 'mandatory' }])] };
  it('is the set of its category, its additional KPIs, and every KPI with values that the set lacks', () => {
    const p = run({
      byCategory,
      byService: { GeneFlow: [kpi('Papers'), kpi('Users')] },
      measured: { GeneFlow: { Users: 2, Papers: 5, Extra: 9 } },
    });
    expect(p.serviceKpis).toEqual([
      { legacy: 'GeneFlow', slug: 'GeneFlow', set: 'Tools', extras: ['Extra', 'Papers'] },
    ]);
    // Papers is a declared additional KPI: not reported. Extra has values only: reported with its count.
    expect(p.findings.filter((f) => f.kind === 'service-kpis').map((f) => f.detail)).toEqual([
      expect.stringContaining('"Extra" has 9 value(s)'),
    ]);
  });
  it('starts without a set when the category is not migrated', () => {
    const p = run({ byCategory, mapping: mapping({ kpiSets: { Tools: { drop: true } } }) });
    expect(p.serviceKpis[0]).toMatchObject({ set: null });
    expect(rules(p)).toContain('service-kpis:GeneFlow:service-kpis.set-not-migrated');
  });
});
