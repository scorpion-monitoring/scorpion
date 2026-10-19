// The RDF writer (M9 sprint 4, item 1): the escaping functions table-driven, and both formats loaded with a real parser
// (`n3` for Turtle, `jsonld` for JSON-LD, dev dependencies of the tests only) and compared triple by triple, with hostile names.
// The writer has no dependency and no database; the query that fills the model is rdf-model.test.ts.
import { Parser, type Quad, type Term } from 'n3';
import jsonld from 'jsonld';
import { describe, expect, it } from 'vitest';
import {
  assertDecimal,
  assertIri,
  graphOf,
  relationOf,
  strongerRelation,
  toJsonLd,
  toTurtle,
  turtleString,
  type RdfIndicator,
  type RdfModel,
  type RimoRelation,
} from './rdf.ts';

const BASE = 'https://kpi.example.org';
const RIMO = 'http://w3id.org/RIMO#';
const UO = 'http://purl.obolibrary.org/obo/UO_';

/** Strings that are hard for a hand-written writer. */
const HOSTILE: [string, string][] = [
  ['a double quote', 'say "hi" and "bye"'],
  ['line breaks', 'one\ntwo\r\nthree\rfour'],
  ['backslashes', 'C:\\path\\n \\u0041 \\" \\\\'],
  ['angle brackets and an IRI', '<script>alert(1)</script> <http://evil.example/> >'],
  ['non-ASCII', 'Größe – 日本語 – العربية – 🙂 – \u00e9\u0301'],
  ['tab and C0 controls', 'tab\there\u0001\u0007\u001b\u001f'],
  ['NUL', 'before\u0000after'],
  ['DEL, C1 controls and separators', 'del\u007f nel\u0085 c1\u009f ls\u2028 ps\u2029'],
  ['a lone surrogate', 'lone \ud800 high and \udc00 low'],
  ['triple quotes', '""" \'\'\' """'],
  [
    'Turtle syntax',
    '} . <http://evil.example/s> <http://evil.example/p> <http://evil.example/o> . # not a comment',
  ],
  [
    'an injected statement',
    '" ; <http://w3id.org/RIMO#isQualitativeIndicator> true . <http://evil.example/x> a <http://w3id.org/RIMO#KPI> . "',
  ],
  ['a very long text', 'long text with "quotes" and \\ backslashes\n'.repeat(3000)],
  ['only an emoji', '🙂'],
];

function indicator(overrides: Partial<RdfIndicator> & { slug: string }): RdfIndicator {
  const { slug, ...rest } = overrides;
  return {
    iri: `${BASE}/kpi/indicator/${slug}`,
    name: slug,
    description: null,
    example: null,
    qualitative: false,
    valueType: 'integer',
    thematic: 'Usage',
    min: null,
    max: null,
    unit: null,
    measuredBy: [],
    automatedBy: [],
    applied: [],
    ...rest,
  };
}

function model(extra: RdfIndicator[] = []): RdfModel {
  const webApplication = `${RIMO}Web_application`;
  const minted = `${BASE}/kpi/set/own-set`;
  return {
    base: BASE,
    catalogue: `${BASE}/kpi/catalogue/rimo`,
    ontology: { iri: 'http://w3id.org/RIMO', version: '0.2.0' },
    units: [
      { key: 'count', iri: `${BASE}/kpi/unit/count`, uoIri: `${UO}0000189`, symbol: null },
      { key: 'percent', iri: `${BASE}/kpi/unit/percent`, uoIri: `${UO}0000187`, symbol: '%' },
      { key: 'my-own-unit', iri: `${BASE}/kpi/unit/my-own-unit`, uoIri: null, symbol: null },
    ],
    means: [{ key: 'web-analytics', iri: `${BASE}/kpi/means/web-analytics` }],
    tools: [{ key: 'matomo', iri: `${BASE}/kpi/tool/matomo` }],
    categories: [
      { iri: webApplication, rimo: true, name: null, description: null },
      { iri: minted, rimo: false, name: 'Our own "set"', description: 'For\nthe own services.' },
    ],
    indicators: [
      indicator({
        slug: 'page-views',
        name: 'Page views',
        description: 'How often pages were opened.',
        example: '12 450 page views in March',
        unit: 'count',
        min: '0',
        measuredBy: ['web-analytics'],
        automatedBy: ['matomo'],
        applied: [
          { category: webApplication, relation: 'mandatoryFor' },
          { category: minted, relation: 'appliedTo' },
        ],
      }),
      indicator({
        slug: 'uptime',
        name: 'Uptime',
        valueType: 'percentage',
        unit: 'percent',
        min: '0',
        max: '100',
        thematic: 'Technical',
        applied: [{ category: webApplication, relation: 'recommendedFor' }],
      }),
      indicator({
        slug: 'satisfaction',
        name: 'Satisfaction',
        valueType: 'text',
        qualitative: true,
        thematic: 'Satisfaction',
      }),
      indicator({ slug: 'custom', name: 'Custom', unit: 'my-own-unit', max: '12.5' }),
      ...extra,
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Parsers (tests only)

const termText = (term: Term): string => {
  if (term.termType === 'NamedNode') return `<${term.value}>`;
  if (term.termType === 'Literal')
    return `${JSON.stringify(term.value)}^^${term.datatype.value}${term.language ? `@${term.language}` : ''}`;
  throw new Error(`unexpected ${term.termType}`);
};
const triplesOf = (quads: Quad[]) =>
  quads.map((q) => `${termText(q.subject)} ${termText(q.predicate)} ${termText(q.object)}`).sort();

const parseTurtle = (turtle: string) =>
  triplesOf(new Parser({ format: 'text/turtle' }).parse(turtle));

async function parseJsonLd(text: string) {
  const document: unknown = JSON.parse(text);
  const nquads = (await jsonld.toRDF(document as jsonld.JsonLdDocument, {
    format: 'application/n-quads',
    // No network: the context is inline, and any remote document is a failure.
    documentLoader: () => Promise.reject(new Error('the JSON-LD tried to load a remote document')),
  })) as unknown as string;
  return triplesOf(new Parser({ format: 'N-Quads' }).parse(nquads));
}

// ---------------------------------------------------------------------------------------------------------------

describe('turtleString', () => {
  it.each<[string, string, string]>([
    ['plain text', 'hello', '"hello"'],
    ['the empty string', '', '""'],
    ['a quote', 'a"b', '"a\\"b"'],
    ['a backslash', 'a\\b', '"a\\\\b"'],
    ['a newline, a return and a tab', 'a\nb\rc\td', '"a\\nb\\rc\\td"'],
    ['backspace and form feed', '\b\f', '"\\b\\f"'],
    ['NUL and other C0 controls', '\u0000\u0001\u001f', '"\\u0000\\u0001\\u001F"'],
    ['DEL and C1 controls', '\u007f\u0085\u009f', '"\\u007F\\u0085\\u009F"'],
    ['the line and paragraph separators', '\u2028\u2029', '"\\u2028\\u2029"'],
    ['a lone surrogate', 'a\ud800b', '"a\ufffdb"'],
    ['an escape-looking text', '\\u0041', '"\\\\u0041"'],
    ['non-ASCII, as it is', 'Größe 日本 🙂', '"Größe 日本 🙂"'],
    ['angle brackets and a hash, as they are', '<a> # b', '"<a> # b"'],
  ])('%s', (_name, input, expected) => {
    expect(turtleString(input)).toBe(expected);
  });

  it('never leaves a raw line break, quote or backslash inside the literal', () => {
    for (const [, text] of HOSTILE) {
      const written = turtleString(text);
      const inner = written.slice(1, -1);
      expect(/[\n\r]/.test(inner)).toBe(false);
      expect(written.startsWith('"') && written.endsWith('"')).toBe(true);
      // Every `"` and `\` of the inner text is part of an escape: removing the escapes leaves none.
      const bare = inner.replaceAll('\\\\', '').replace(/\\["nrtbfu]/g, '');
      expect(bare.includes('"')).toBe(false);
      expect(bare.includes('\\')).toBe(false);
    }
  });
});

describe('assertIri', () => {
  it.each([
    'https://kpi.example.org/kpi/indicator/page-views',
    'http://w3id.org/RIMO#Web_application',
    'http://purl.obolibrary.org/obo/UO_0000189',
    'https://kpi.example.org:8443/x/kpi/set/a.b_c-d#value',
  ])('accepts %s', (iri) => {
    expect(assertIri(iri)).toBe(iri);
  });

  it.each<[string, string]>([
    ['a space', 'https://kpi.example.org/a b'],
    ['a closing angle bracket', 'https://kpi.example.org/a>b'],
    ['an opening angle bracket', 'https://kpi.example.org/a<b'],
    ['a quote', 'https://kpi.example.org/a"b'],
    ['a brace', 'https://kpi.example.org/a{b}'],
    ['a pipe', 'https://kpi.example.org/a|b'],
    ['a caret', 'https://kpi.example.org/a^b'],
    ['a backtick', 'https://kpi.example.org/a`b'],
    ['a backslash', 'https://kpi.example.org/a\\b'],
    ['a newline', 'https://kpi.example.org/a\nb'],
    ['a NUL', 'https://kpi.example.org/a\u0000b'],
    ['a non-ASCII letter', 'https://kpi.example.org/ä'],
    ['another scheme', 'javascript:alert(1)'],
    ['the file scheme', 'file:///etc/passwd'],
    ['no scheme', '/kpi/indicator/a'],
    ['no host', 'https:///a'],
    ['an empty string', ''],
  ])('refuses %s', (_name, iri) => {
    expect(() => assertIri(iri)).toThrow(RangeError);
  });
});

describe('assertDecimal', () => {
  it.each(['0', '12', '-7', '0.5', '12.25', '-0.001'])('accepts %s', (value) => {
    expect(assertDecimal(value)).toBe(value);
  });
  it.each(['', '1e3', '.5', '5.', '1,5', 'NaN', 'Infinity', '1 ', '"1"^^x', '1'.repeat(40)])(
    'refuses %j',
    (value) => {
      expect(() => assertDecimal(value)).toThrow(RangeError);
    },
  );
});

describe('relations', () => {
  it.each<[string, RimoRelation]>([
    ['mandatory', 'mandatoryFor'],
    ['recommended', 'recommendedFor'],
    ['optional', 'appliedTo'],
    ['an administrator’s own term', 'appliedTo'],
    ['', 'appliedTo'],
  ])('%s is %s', (necessity, relation) => {
    expect(relationOf(necessity)).toBe(relation);
  });

  it.each<[RimoRelation, RimoRelation, RimoRelation]>([
    ['appliedTo', 'mandatoryFor', 'mandatoryFor'],
    ['mandatoryFor', 'appliedTo', 'mandatoryFor'],
    ['recommendedFor', 'appliedTo', 'recommendedFor'],
    ['appliedTo', 'recommendedFor', 'recommendedFor'],
    ['recommendedFor', 'mandatoryFor', 'mandatoryFor'],
    ['mandatoryFor', 'mandatoryFor', 'mandatoryFor'],
    ['appliedTo', 'appliedTo', 'appliedTo'],
  ])('the stronger of %s and %s is %s', (a, b, expected) => {
    expect(strongerRelation(a, b)).toBe(expected);
  });
});

describe('the Turtle and the JSON-LD of a model', () => {
  it('say the same triples, and the triples are the ones of the model', async () => {
    const m = model();
    const turtle = parseTurtle(toTurtle(m));
    const fromJsonLd = await parseJsonLd(toJsonLd(m));
    expect(fromJsonLd).toEqual(turtle);
    const has = (needle: string) => expect(turtle).toContain(needle);
    const page = `<${BASE}/kpi/indicator/page-views>`;
    const value = `<${BASE}/kpi/indicator/page-views#value>`;
    const type = '<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>';
    const xsdString = 'http://www.w3.org/2001/XMLSchema#string';
    has(`${page} ${type} <${RIMO}KPI>`);
    has(`${page} <${RIMO}KPIName> "Page views"^^${xsdString}`);
    has(`${page} <${RIMO}KPIDescription> "How often pages were opened."^^${xsdString}`);
    has(`${page} <${RIMO}KPIExample> "12 450 page views in March"^^${xsdString}`);
    has(
      `${page} <${RIMO}isQualitativeIndicator> "false"^^http://www.w3.org/2001/XMLSchema#boolean`,
    );
    has(`${page} <${RIMO}hasValue> ${value}`);
    has(`${value} ${type} <${RIMO}KPIValue>`);
    has(`${value} <${RIMO}hasUnit> <${UO}0000189>`);
    has(`${value} <${BASE}/kpi/ns#unit> <${BASE}/kpi/unit/count>`);
    has(`${value} <${BASE}/kpi/ns#minValue> "0"^^http://www.w3.org/2001/XMLSchema#decimal`);
    has(`${page} <${RIMO}measuredBy> <${BASE}/kpi/means/web-analytics>`);
    has(`<${BASE}/kpi/means/web-analytics> ${type} <${RIMO}MeasurementMeans>`);
    has(`${page} <${RIMO}canBeAutomatedBy> <${BASE}/kpi/tool/matomo>`);
    has(`<${BASE}/kpi/tool/matomo> ${type} <${RIMO}AutomationTool>`);
    has(`${page} <${RIMO}mandatoryFor> <${RIMO}Web_application>`);
    has(`${page} <${RIMO}appliedTo> <${BASE}/kpi/set/own-set>`);
    has(`<${BASE}/kpi/indicator/uptime> <${RIMO}recommendedFor> <${RIMO}Web_application>`);
    has(`<${BASE}/kpi/set/own-set> ${type} <${RIMO}ServiceCategory>`);
    has(
      `<${BASE}/kpi/catalogue/rimo> <http://purl.org/dc/terms/conformsTo> <http://w3id.org/RIMO>`,
    );
    has(`<${BASE}/kpi/catalogue/rimo> <http://purl.org/dc/terms/hasVersion> "0.2.0"^^${xsdString}`);
    // A unit of the Units Ontology keeps its own node, linked to the term; an own unit has no `closeMatch`.
    has(`<${BASE}/kpi/unit/count> <http://www.w3.org/2004/02/skos/core#closeMatch> <${UO}0000189>`);
    expect(
      turtle.some((t) =>
        t.startsWith(
          `<${BASE}/kpi/unit/my-own-unit> <http://www.w3.org/2004/02/skos/core#closeMatch>`,
        ),
      ),
    ).toBe(false);
    // A set that maps to a RIMO category says nothing about that category's words: RIMO defines them.
    expect(turtle.filter((t) => t.startsWith(`<${RIMO}Web_application> `))).toEqual([
      `<${RIMO}Web_application> ${type} <${RIMO}ServiceCategory>`,
    ]);
    // A minted set carries its name and description.
    has(
      `<${BASE}/kpi/set/own-set> <http://www.w3.org/2004/02/skos/core#prefLabel> "Our own \\"set\\""^^${xsdString}`,
    );
  });

  /** The fixture with one indicator and one minted set whose every text is `text`. */
  const withText = (text: string): RdfModel => ({
    ...model([
      indicator({ slug: 'hostile', name: text, description: text, example: text, thematic: text }),
    ]),
    categories: [{ iri: `${BASE}/kpi/set/own-set`, rimo: false, name: text, description: text }],
  });

  it.each(HOSTILE)('round-trip a hostile text in every literal: %s', async (_name, text) => {
    const m = withText(text);
    const turtleText = toTurtle(m);
    const jsonText = toJsonLd(m);
    const fromTurtle = parseTurtle(turtleText);
    const fromJson = await parseJsonLd(jsonText);
    expect(fromJson).toEqual(fromTurtle);
    // No statement was injected: the only subjects are the ones of the model.
    const subjects = new Set(fromTurtle.map((t) => t.slice(0, t.indexOf('> ') + 1)));
    const expected = new Set(graphOf(m).map((node) => `<${node.id}>`));
    expect(subjects).toEqual(expected);
    // The name reads back exactly (a lone surrogate became U+FFFD in both).
    const wanted = JSON.stringify(text.toWellFormed());
    const name = fromTurtle.find((t) =>
      t.startsWith(`<${BASE}/kpi/indicator/hostile> <${RIMO}KPIName> `),
    );
    expect(name).toBe(
      `<${BASE}/kpi/indicator/hostile> <${RIMO}KPIName> ${wanted}^^http://www.w3.org/2001/XMLSchema#string`,
    );
    // The triple count does not depend on the text.
    const plain = parseTurtle(toTurtle(withText('x')));
    expect(fromTurtle).toHaveLength(plain.length);
  });

  it('keep the JSON-LD free of raw angle brackets, ampersands and line separators', () => {
    const text = '<b>&amp;</b>\u2028\u2029';
    const out = toJsonLd(model([indicator({ slug: 'markup', name: text })]));
    expect(/[<>&\u2028\u2029]/.test(out)).toBe(false);
    const parsed = JSON.parse(out) as { '@graph': Record<string, unknown>[] };
    expect(
      parsed['@graph'].find((n) => n['@id'] === `${BASE}/kpi/indicator/markup`)?.['rimo:KPIName'],
    ).toBe(text);
  });

  it('write a decimal bound as a typed literal and a boolean as a boolean', () => {
    const m = model();
    const turtle = toTurtle(m);
    expect(turtle).toContain('scorpion:maxValue "12.5"^^xsd:decimal');
    expect(turtle).toContain('rimo:isQualitativeIndicator true');
    const json = JSON.parse(toJsonLd(m)) as { '@graph': Record<string, unknown>[] };
    const custom = json['@graph'].find((n) => n['@id'] === `${BASE}/kpi/indicator/custom#value`);
    expect(custom?.['scorpion:maxValue']).toEqual({ '@value': '12.5', '@type': 'xsd:decimal' });
    expect(
      json['@graph'].find((n) => n['@id'] === `${BASE}/kpi/indicator/satisfaction`)?.[
        'rimo:isQualitativeIndicator'
      ],
    ).toBe(true);
  });

  it('give the same bytes for the same model, whatever the order of its lists', () => {
    const m = model();
    const shuffled: RdfModel = {
      ...m,
      units: [...m.units].reverse(),
      means: [...m.means].reverse(),
      categories: [...m.categories].reverse(),
      indicators: [...m.indicators].reverse().map((i) => ({
        ...i,
        measuredBy: [...i.measuredBy].reverse(),
        applied: [...i.applied].reverse(),
      })),
    };
    expect(toTurtle(shuffled)).toBe(toTurtle(m));
    expect(toJsonLd(shuffled)).toBe(toJsonLd(m));
    expect(toTurtle(m)).toBe(toTurtle(model()));
    expect(toJsonLd(m)).toBe(toJsonLd(model()));
  });

  it('match the committed snapshots', async () => {
    await expect(toTurtle(model())).toMatchFileSnapshot('./__snapshots__/rimo-fixture.ttl');
    await expect(toJsonLd(model())).toMatchFileSnapshot('./__snapshots__/rimo-fixture.jsonld');
  });

  it('write an empty catalogue as a valid document', async () => {
    const empty: RdfModel = {
      ...model(),
      units: [],
      means: [],
      tools: [],
      categories: [],
      indicators: [],
    };
    const turtle = parseTurtle(toTurtle(empty));
    expect(turtle).toHaveLength(2);
    expect(await parseJsonLd(toJsonLd(empty))).toEqual(turtle);
  });
});

describe('what the writer refuses', () => {
  const bad = (iri: string) => model([indicator({ slug: 'bad', iri })]);

  it.each<[string, string]>([
    ['a space', `${BASE}/kpi/indicator/a b`],
    [
      'a closing bracket that would end the IRI',
      `${BASE}/kpi/indicator/a> <http://evil.example/p> <http://evil.example/o`,
    ],
    ['a non-http scheme', 'javascript:alert(1)'],
  ])('an indicator IRI with %s, in both formats', (_name, iri) => {
    expect(() => toTurtle(bad(iri))).toThrow(RangeError);
    expect(() => toJsonLd(bad(iri))).toThrow(RangeError);
  });

  it('a base that is not an IRI namespace', () => {
    expect(() => toTurtle({ ...model(), base: 'https://x.org/> <http://evil.example/' })).toThrow(
      RangeError,
    );
  });

  it('a unit, means or tool the model does not list', () => {
    expect(() => toTurtle(model([indicator({ slug: 'u', unit: 'ghost' })]))).toThrow(RangeError);
    expect(() => toTurtle(model([indicator({ slug: 'm', measuredBy: ['ghost'] })]))).toThrow(
      RangeError,
    );
    expect(() => toTurtle(model([indicator({ slug: 't', automatedBy: ['ghost'] })]))).toThrow(
      RangeError,
    );
  });

  it('a bound that is not a decimal', () => {
    expect(() => toTurtle(model([indicator({ slug: 'b', min: '1e3' })]))).toThrow(RangeError);
    expect(() => toJsonLd(model([indicator({ slug: 'b', max: '"1"^^<x>' })]))).toThrow(RangeError);
  });
});
