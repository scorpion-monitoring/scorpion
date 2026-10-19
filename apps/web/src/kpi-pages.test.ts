// The pages of kpi.framework, rendered on the server with a stand-in for the shell (`ShellHarness.svelte`): the
// forms with their RIMO fields, the selects and checkbox groups drawn from the vocabularies and the registry,
// the qualitative rule, the necessity badges and the evaluation choices, in both languages. Clicks, the picker's
// results and the dialogs are the Playwright journey. The pages belong to the module and the module boundary rule
// allows no import of a module's internals from the web app, so they are loaded by path, as in
// membership-pages.test.ts.
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ShellHarness from './test/ShellHarness.svelte';

const ui = (file: string) =>
  import(
    /* @vite-ignore */ new URL(`../../../modules/kpi-framework/ui/${file}`, import.meta.url)
      .pathname
  );
const { messages } = (await ui('messages.ts')) as {
  messages: Record<string, Record<string, string>>;
};
const component = async (file: string) => ((await ui(file)) as { default: Component }).default;
const Indicators = await component('Indicators.svelte');
const IndicatorEdit = await component('IndicatorEdit.svelte');
const Sets = await component('Sets.svelte');
const SetEdit = await component('SetEdit.svelte');

const draw = (page: Component, data: unknown, locale = 'en') =>
  render(ShellHarness, { props: { page, data, userId: 'u-1', messages, locale } }).body;

const term = (key: string, en: string, de?: string, active = true) => ({
  key,
  labels: de ? { en, de } : { en },
  label: en,
  sortOrder: 10,
  active,
  seeded: true,
});
const thematic = [term('Usage', 'Usage', 'Nutzung'), term('Technical', 'Technical', 'Technisch')];
const units = [term('count', 'Count', 'Anzahl'), term('byte', 'Byte', 'Byte', false)];
const means = [term('log', 'Log analysis', 'Logauswertung')];
const tools = [term('script', 'Script', 'Skript')];
const types = [
  {
    id: 'integer',
    labels: { en: 'Whole number', de: 'Ganze Zahl' },
    numeric: true,
    aggregates: ['sum', 'avg'],
  },
  {
    id: 'percentage',
    labels: { en: 'Percentage', de: 'Prozentwert' },
    numeric: true,
    aggregates: ['avg'],
  },
  { id: 'text', labels: { en: 'Text', de: 'Text' }, numeric: false, aggregates: [] },
];
const necessity = [
  term('mandatory', 'Mandatory', 'Verpflichtend'),
  term('recommended', 'Recommended', 'Empfohlen'),
  term('optional', 'Optional', 'Optional'),
];
const aggregates = [
  term('sum', 'Sum', 'Summe'),
  term('avg', 'Average', 'Mittelwert'),
  term('min', 'Minimum', 'Minimum', false),
];
const categories = [
  term('Web_application', 'Web application'),
  term('SPARQL_endpoint', 'SPARQL endpoint'),
];

const NOW = '2026-10-10T10:00:00.000Z';
const indicator = (over: Record<string, unknown> = {}) => ({
  id: 'i-1',
  slug: 'page-views',
  iri: 'https://kpi.example.org/kpi/indicator/page-views',
  name: 'Page views',
  description: 'Views of a page.',
  example: '120',
  qualitative: false,
  valueType: 'integer',
  unit: 'count',
  min: 0,
  max: 1000,
  thematic: 'Usage',
  measuredBy: ['log'],
  canBeAutomatedBy: [],
  setCount: 2,
  createdAt: NOW,
  updatedAt: NOW,
  createdBy: null,
  updatedBy: null,
  ...over,
});
const listData = (over: Record<string, unknown> = {}) => ({
  query: {
    q: undefined,
    thematic: undefined,
    unit: undefined,
    qualitative: undefined,
    page: 0,
    pageSize: 20,
  },
  indicators: [
    indicator(),
    indicator({ id: 'i-2', name: 'Citations', thematic: 'Technical', unit: null }),
  ],
  total: 2,
  thematic,
  units,
  types,
  ...over,
});
const editData = (stored: unknown) => ({ indicator: stored, thematic, units, means, tools, types });

describe('Indicators', () => {
  it('lists the rows with their category, value type and unit in the words of the vocabularies', () => {
    const html = draw(Indicators, listData());
    expect(html).toContain('Page views');
    expect(html).toContain('>Usage<');
    expect(html).toContain('Whole number');
    expect(html).toContain('Count');
    expect(html).toContain('/kpi/indicators/i-1');
    expect(html).toContain('New indicator');
  });

  it('draws the filters from the vocabularies and says so when nothing matches', () => {
    const html = draw(Indicators, listData({ indicators: [], total: 0 }));
    expect(html).toContain('No indicator matches.');
    for (const label of ['Thematic category', 'Unit', 'Kind', 'Qualitative', 'Quantitative'])
      expect(html).toContain(label);
    expect(html).toContain('<option value="Technical">Technical</option>');
  });

  it('speaks German', () => {
    const html = draw(Indicators, listData(), 'de');
    expect(html).toContain('Indikatoren');
    expect(html).toContain('Nutzung');
    expect(html).toContain('Ganze Zahl');
    expect(html).toContain('Neuer Indikator');
    expect(html).not.toContain('No indicator');
  });
});

describe('IndicatorEdit', () => {
  it('draws every RIMO field of a new indicator, with the registry types and the vocabulary terms', () => {
    const html = draw(IndicatorEdit, editData(undefined));
    for (const label of [
      'Name',
      'Description',
      'Example',
      'Thematic category',
      'Qualitative indicator',
      'Value type',
      'Unit',
      'Means of measurement',
      'Tools that can automate it',
    ])
      expect(html).toContain(label);
    expect(html).toContain('Create the indicator');
    for (const option of ['Whole number', 'Percentage', 'Text'])
      expect(html).toContain(`>${option}<`);
    expect(html).toContain('Log analysis');
    expect(html).toContain('>Script<');
    expect(html).toContain('Smallest value');
    expect(html).not.toContain('Delete…');
  });

  it('offers a deactivated unit only to the row that has it', () => {
    expect(draw(IndicatorEdit, editData(undefined))).not.toContain('>Byte<');
    expect(draw(IndicatorEdit, editData(indicator({ unit: 'byte' })))).toContain('>Byte<');
  });

  it('shows the stored values, the identifier, the IRI, where it is used and the delete section', () => {
    const html = draw(IndicatorEdit, editData(indicator()));
    expect(html).toContain('value="Page views"');
    expect(html).toContain('page-views');
    expect(html).toContain('https://kpi.example.org/kpi/indicator/page-views');
    expect(html).toContain('Used in 2 KPI sets.');
    expect(html).toContain('Save changes');
    expect(html).toContain('Delete…');
  });

  it('draws no bounds for a qualitative indicator or a type without an order, and disables the type', () => {
    const qualitative = draw(
      IndicatorEdit,
      editData(indicator({ qualitative: true, valueType: 'text', min: null, max: null })),
    );
    expect(qualitative).not.toContain('Smallest value');
    expect(qualitative).toMatch(/<select[^>]*disabled[^>]*>/);
    const text = draw(
      IndicatorEdit,
      editData(indicator({ valueType: 'text', min: null, max: null })),
    );
    expect(text).not.toContain('Smallest value');
  });

  it('speaks German and names no instance or role', () => {
    const html = draw(IndicatorEdit, editData(indicator()), 'de');
    for (const word of [
      'Beschreibung',
      'Beispiel',
      'Werttyp',
      'Einheit',
      'Messmittel',
      'Änderungen speichern',
      'In 2 KPI-Sets verwendet.',
      'Logauswertung',
    ])
      expect(html).toContain(word);
    expect(html).not.toContain('Save changes');
  });
});

const set = (over: Record<string, unknown> = {}) => ({
  id: 's-1',
  slug: 'web-apps',
  iri: 'https://kpi.example.org/kpi/set/web-apps',
  name: 'Web apps',
  description: null,
  rimoCategory: 'Web_application',
  indicatorCount: 3,
  necessityCounts: { optional: 1, mandatory: 2 },
  hasEvaluation: true,
  createdAt: NOW,
  updatedAt: NOW,
  createdBy: null,
  updatedBy: null,
  indicators: [
    {
      indicatorId: 'i-1',
      slug: 'page-views',
      name: 'Page views',
      necessity: 'mandatory',
      valueType: 'integer',
      unit: 'count',
      thematic: 'Usage',
      qualitative: false,
    },
    {
      indicatorId: 'i-2',
      slug: 'share',
      name: 'Share',
      necessity: 'optional',
      valueType: 'percentage',
      unit: null,
      thematic: 'Usage',
      qualitative: false,
    },
    {
      indicatorId: 'i-3',
      slug: 'comment',
      name: 'Comment',
      necessity: 'mandatory',
      valueType: 'text',
      unit: null,
      thematic: 'Usage',
      qualitative: true,
    },
  ],
  evaluation: { setId: 's-1', indicatorId: 'i-1', aggregate: 'sum', updatedAt: NOW },
  ...over,
});
const setsData = {
  query: { q: undefined, rimoCategory: undefined, page: 0, pageSize: 20 },
  sets: [
    set(),
    set({
      id: 's-2',
      name: 'Empty set',
      indicatorCount: 0,
      necessityCounts: {},
      rimoCategory: null,
      hasEvaluation: false,
    }),
  ],
  total: 2,
  categories,
  necessity,
};
const setEditData = (stored: unknown) => ({
  set: stored,
  categories,
  necessity,
  aggregates,
  types,
  thematic,
});

describe('Sets', () => {
  it('shows a badge per necessity in the order of the vocabulary, with the word of the term', () => {
    const html = draw(Sets, setsData);
    expect(html).toContain('2 Mandatory');
    expect(html).toContain('1 Optional');
    expect(html.indexOf('2 Mandatory')).toBeLessThan(html.indexOf('1 Optional'));
    expect(html).toContain('Web application');
    expect(html).toContain('No indicators yet');
    expect(html).toContain('/kpi/sets/s-1');
  });

  it('speaks German', () => {
    const html = draw(Sets, setsData, 'de');
    expect(html).toContain('KPI-Sets');
    expect(html).toContain('2 Verpflichtend');
    expect(html).toContain('Noch keine Indikatoren');
  });
});

describe('SetEdit', () => {
  it('draws only the details and a hint for a new set', () => {
    const html = draw(SetEdit, setEditData(undefined));
    expect(html).toContain('Create the KPI set');
    expect(html).toContain('You can add indicators and an evaluation once the KPI set exists.');
    expect(html).not.toContain('Indicators of the set');
    expect(html).not.toContain('Delete…');
  });

  it('draws the rows with a necessity select each, the picker, the evaluation and the delete for a stored set', () => {
    const html = draw(SetEdit, setEditData(set()));
    expect(html).toContain('Indicators of the set');
    for (const name of ['Necessity of Page views', 'Necessity of Share', 'Necessity of Comment'])
      expect(html).toContain(`aria-label="${name}"`);
    expect(html).toContain('aria-label="Remove Page views"');
    expect(html).toContain('Add indicators');
    expect(html).toContain('Search indicators');
    expect(html).toContain('Save the indicators');
    expect(html).toContain('Evaluation');
    expect(html).toContain('Headline indicator');
    expect(html).toContain('Save the evaluation');
    expect(html).toContain('Delete…');
    expect(html).toContain('https://kpi.example.org/kpi/set/web-apps');
  });

  it('offers the necessities of the vocabulary and the aggregates the headline type allows and the vocabulary has active', () => {
    const html = draw(SetEdit, setEditData(set()));
    for (const word of ['Mandatory', 'Recommended']) expect(html).toContain(`>${word}<`);
    // The headline is a whole number: sum and average; minimum is deactivated.
    expect(html).toContain('>Sum<');
    expect(html).toContain('>Average<');
    expect(html).not.toContain('>Minimum<');
  });

  it('says there is nothing to evaluate for a set without saved rows', () => {
    const html = draw(
      SetEdit,
      setEditData(
        set({ indicators: [], indicatorCount: 0, evaluation: null, necessityCounts: {} }),
      ),
    );
    expect(html).toContain('The set has no indicators.');
    expect(html).toContain('Save at least one indicator first.');
  });

  it('speaks German', () => {
    const html = draw(SetEdit, setEditData(set()), 'de');
    for (const word of [
      'Indikatoren des Sets',
      'Verbindlichkeit von Page views',
      'Indikatoren hinzufügen',
      'Bewertung',
      'Leitindikator',
      'Summe',
      'Löschen …',
    ])
      expect(html).toContain(word);
    expect(html).not.toContain('Save the evaluation');
  });
});
