import { describe, expect, it } from 'vitest';
import { serializeFacets, type FacetDefinition, type FacetState } from '../facets.ts';
import {
  bestOffer,
  chipText,
  facetSearchParams,
  fold,
  LIST_CAP,
  matchingOffers,
  parseShortcut,
  rangeProblem,
  rangeText,
  visibleOptions,
} from './model.ts';

const provider: FacetDefinition = {
  id: 'provider',
  label: 'Provider',
  type: 'checkbox',
  options: [
    { value: 'ipk', label: 'IPK Gatersleben', count: 12 },
    { value: 'ipk-hub', label: 'IPK Data Hub', count: 2 },
    { value: 'fzj', label: 'Forschungszentrum Jülich', count: 7 },
  ],
};
const consortium: FacetDefinition = {
  id: 'consortium',
  label: 'Consortium',
  type: 'checkbox',
  options: [
    { value: 'bionet', label: 'BioNet', count: 20 },
    { value: 'plantdata', label: 'PlantData', count: 4 },
    { value: ':none', label: 'No consortium', count: 1 },
  ],
};
const kpiSet: FacetDefinition = {
  id: 'kpi-set',
  label: 'KPI set',
  type: 'checkbox',
  options: [{ value: 'core', label: 'Core', count: 3 }],
};
const year: FacetDefinition = { id: 'year', label: 'Year', type: 'range', min: 2000, max: 2030 };
const definitions = [provider, consortium, kpiSet, year];
/** The same facets as a German page gets them: the labels come from the API in the page's language. */
const german: FacetDefinition[] = [
  { ...provider, label: 'Anbieter' },
  { ...consortium, label: 'Konsortium' },
  { ...kpiSet, label: 'KPI-Satz' },
  { ...year, label: 'Jahr' },
];

describe('fold', () => {
  it.each([
    ['Jülich', 'julich'],
    ['  IPK ', 'ipk'],
    ['Ångström', 'angstrom'],
    ['ÉCOLE', 'ecole'],
  ])('%s → %s', (text, folded) => expect(fold(text)).toBe(folded));
});

describe('parseShortcut', () => {
  it.each<[string, readonly FacetDefinition[], string | undefined, string | undefined]>([
    // [typed, definitions, facet id found, value text]
    ['provider:ipk', definitions, 'provider', 'ipk'],
    ['Provider:IPK', definitions, 'provider', 'IPK'],
    ['provider: ipk', definitions, 'provider', 'ipk'],
    ['provider:', definitions, 'provider', ''],
    ['provider:"IPK Gatersleben"', definitions, 'provider', 'IPK Gatersleben'],
    ['provider:"IPK Gat', definitions, 'provider', 'IPK Gat'],
    ['provider:IPK Gatersleben', definitions, 'provider', 'IPK Gatersleben'],
    ['consortium:BioNet', definitions, 'consortium', 'BioNet'],
    ['"KPI set":core', definitions, 'kpi-set', 'core'],
    ['kpi-set:core', definitions, 'kpi-set', 'core'],
    // The label in the page's language, and the id in any language.
    ['Anbieter:ipk', german, 'provider', 'ipk'],
    ['anbieter:ipk', german, 'provider', 'ipk'],
    ['provider:ipk', german, 'provider', 'ipk'],
    ['"KPI-Satz":core', german, 'kpi-set', 'core'],
    ['Konsortium:plant', german, 'consortium', 'plant'],
    // An unknown facet, or no colon, is plain search text.
    ['Anbieter:ipk', definitions, undefined, undefined],
    ['owner:ipk', definitions, undefined, undefined],
    ['ipk', definitions, undefined, undefined],
    ['IPK Gatersleben', definitions, undefined, undefined],
    ['http://example.org', definitions, undefined, undefined],
    ['', definitions, undefined, undefined],
    [':ipk', definitions, undefined, undefined],
  ])('%s (%#)', (text, facets, facet, value) => {
    const found = parseShortcut(text, facets);
    expect(found?.facet.id).toBe(facet);
    expect(found?.value).toBe(value);
  });
});

describe('facetSearchParams', () => {
  it.each<[string, string, FacetState, string]>([
    // [text, base, state, expected]
    ['ipk', '', {}, 'q=ipk'],
    ['  ipk  ', '', {}, 'q=ipk'],
    ['', 'q=old', {}, ''],
    [
      'new',
      'q=old&sort=stage&dir=desc&page=4&pageSize=50',
      {},
      'q=new&sort=stage&dir=desc&pageSize=50',
    ],
    ['', 'page=2', { consortium: ['bionet'] }, 'f.consortium=bionet'],
    [
      'x',
      'f.provider=old&page=1',
      { consortium: ['bionet', ':none'], year: { min: 2018 } },
      'q=x&f.consortium=bionet&f.consortium=%3Anone&f.year.min=2018',
    ],
    ['a'.repeat(120), '', {}, `q=${'a'.repeat(100)}`],
  ])('%j over %j', (text, base, state, expected) => {
    expect(facetSearchParams(text, state, definitions, new URLSearchParams(base)).toString()).toBe(
      expected,
    );
  });

  it.each<[string, FacetState]>([
    ['sort=name&q=abc', { provider: ['ipk', 'fzj'] }],
    ['q=abc&page=3', { consortium: [':none'], year: { max: 2020 } }],
    ['pageSize=10', {}],
  ])(
    'gives the address serializeFacets gave before the redesign for the same selection (%s)',
    (base, state) => {
      const q = new URLSearchParams(base).get('q') ?? '';
      expect(facetSearchParams(q, state, definitions, new URLSearchParams(base)).toString()).toBe(
        serializeFacets(state, definitions, new URLSearchParams(base)).toString(),
      );
    },
  );
});

describe('visibleOptions', () => {
  const many = Array.from({ length: 300 }, (_, index) => ({
    value: `v${index}`,
    label: `Value ${String(index).padStart(3, '0')}`,
    count: 1,
  }));

  it.each<[string, number, number]>([
    ['', LIST_CAP, 300 - LIST_CAP],
    ['Value 0', LIST_CAP, 100 - LIST_CAP],
    ['value 29', 10, 0],
    ['VALUE 299', 1, 0],
    ['nothing', 0, 0],
  ])('%j shows %i and %i more', (filter, shown, more) => {
    const found = visibleOptions(many, filter);
    expect(found.shown).toHaveLength(shown);
    expect(found.more).toBe(more);
  });

  it('matches the label without accents and case', () => {
    expect(visibleOptions(provider.options, 'julich').shown.map((o) => o.value)).toEqual(['fzj']);
  });
});

describe('matchingOffers', () => {
  it('offers values whose label contains the text, more services first', () => {
    expect(
      matchingOffers(definitions, 'ipk', {}).map(
        ({ facet, option }) => `${facet.id}=${option.value}`,
      ),
    ).toEqual(['provider=ipk', 'provider=ipk-hub']);
  });

  it('leaves out chosen values and range facets, and offers nothing for no text', () => {
    expect(matchingOffers(definitions, 'ipk', { provider: ['ipk'] })).toHaveLength(1);
    expect(matchingOffers(definitions, 'year', {})).toEqual([]);
    expect(matchingOffers(definitions, '  ', {})).toEqual([]);
  });

  it('finds "No consortium" as a real value', () => {
    expect(bestOffer(definitions, 'no cons', {})?.option.value).toBe(':none');
  });

  it('keeps to the limit', () => {
    expect(matchingOffers(definitions, 'e', {}, 2)).toHaveLength(2);
  });
});

describe('chipText', () => {
  it.each<[FacetDefinition, FacetState, { full: string; short: string; name: string } | undefined]>(
    [
      [consortium, {}, undefined],
      [
        consortium,
        { consortium: ['bionet'] },
        { full: 'Consortium: BioNet', short: 'Consortium: BioNet', name: 'Consortium: BioNet' },
      ],
      [
        consortium,
        { consortium: ['bionet', 'plantdata'] },
        {
          full: 'Consortium: BioNet, PlantData',
          short: 'Consortium: BioNet, PlantData',
          name: 'Consortium: BioNet, PlantData',
        },
      ],
      [
        provider,
        { provider: ['ipk', 'fzj', 'ipk-hub'] },
        {
          full: 'Provider: IPK Gatersleben, Forschungszentrum Jülich, IPK Data Hub',
          short: 'Provider: IPK Gatersleben +2',
          name: 'Provider: IPK Gatersleben +2 (Forschungszentrum Jülich, IPK Data Hub)',
        },
      ],
      // A value the facets no longer list (0 matches) keeps its key, and stays removable.
      [
        provider,
        { provider: ['gone'] },
        { full: 'Provider: gone', short: 'Provider: gone', name: 'Provider: gone' },
      ],
      [
        year,
        { year: { min: 2018, max: 2022 } },
        { full: 'Year: 2018–2022', short: 'Year: 2018–2022', name: 'Year: 2018–2022' },
      ],
      [
        year,
        { year: { min: 2018 } },
        { full: 'Year: ≥ 2018', short: 'Year: ≥ 2018', name: 'Year: ≥ 2018' },
      ],
      [
        year,
        { year: { max: 2022 } },
        { full: 'Year: ≤ 2022', short: 'Year: ≤ 2022', name: 'Year: ≤ 2022' },
      ],
    ],
  )('%#', (definition, state, expected) => {
    expect(chipText(definition, state)).toEqual(expected);
  });
});

describe('ranges', () => {
  it.each<[{ min?: number; max?: number }, string]>([
    [{ min: 2018, max: 2022 }, '2018–2022'],
    [{ min: 2020, max: 2020 }, '2020'],
    [{ min: 2018 }, '≥ 2018'],
    [{ max: 2022 }, '≤ 2022'],
    [{}, ''],
  ])('rangeText(%j) = %j', (range, text) => expect(rangeText(range)).toBe(text));

  it.each<[{ min?: number; max?: number }, 'order' | 'bounds' | undefined]>([
    [{ min: 2018, max: 2022 }, undefined],
    [{ min: 2018 }, undefined],
    [{}, undefined],
    [{ min: 2022, max: 2018 }, 'order'],
    [{ min: 1990 }, 'bounds'],
    [{ max: 2031 }, 'bounds'],
  ])('rangeProblem(%j) = %j', (range, problem) => {
    expect(rangeProblem(year, range)).toBe(problem);
  });
});
