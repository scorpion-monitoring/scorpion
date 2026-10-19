// The RIMO-shaped RDF of the indicators (ADR-0040, M9 sprint 4): Turtle and JSON-LD written by hand, no dependency.
// Pure. Both formats are rendered from ONE graph (`graphOf`), so they carry the same triples by construction; a test
// loads each with a real parser (a dev dependency of the tests only) and compares them.
//
// Safety rules, each tested:
// - no free text ever becomes an IRI: every IRI is built by `iriFor` (a fixed alphabet) or comes from code and the
//   RIMO seed, and `assertIri` refuses anything but a plain `http(s)` IRI before it is written;
// - one escaping function for Turtle string literals (`turtleString`); JSON-LD strings go through `JSON.stringify`;
// - a lone surrogate becomes U+FFFD before either renderer sees it, so both formats read back the same string.

/** The prefixes of the output. The namespace `scorpion` is minted from the IRI base (`<base>/kpi/ns#`). */
const FIXED_PREFIXES = {
  rimo: 'http://w3id.org/RIMO#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  dct: 'http://purl.org/dc/terms/',
  uo: 'http://purl.obolibrary.org/obo/UO_',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
} as const;

/** How the necessity of an indicator in a set is written: RIMO has two sub-properties and the base property. */
export type RimoRelation = 'mandatoryFor' | 'recommendedFor' | 'appliedTo';

/** `mandatory` and `recommended` are RIMO's; every other term of the vocabulary `necessity` is `appliedTo`. */
export function relationOf(necessity: string): RimoRelation {
  if (necessity === 'mandatory') return 'mandatoryFor';
  if (necessity === 'recommended') return 'recommendedFor';
  return 'appliedTo';
}

const STRENGTH: Record<RimoRelation, number> = { mandatoryFor: 2, recommendedFor: 1, appliedTo: 0 };

/** The stronger of two relations: when two sets map to the same RIMO category, the indicator keeps one triple. */
export function strongerRelation(a: RimoRelation, b: RimoRelation): RimoRelation {
  return STRENGTH[b] > STRENGTH[a] ? b : a;
}

export interface RdfUnit {
  /** The key of the `kpi.unit` term. */
  key: string;
  /** The IRI this instance minted for it. */
  iri: string;
  /** The Units Ontology IRI, when the unit is a seeded one. */
  uoIri: string | null;
  symbol: string | null;
}

export interface RdfTerm {
  key: string;
  iri: string;
}

export interface RdfCategory {
  iri: string;
  /** A category of RIMO itself (a set that maps to it): RIMO defines its words, this export does not repeat them. */
  rimo: boolean;
  /** The name and description of a set this instance minted (`rimo` is false); both `null` for a RIMO category. */
  name: string | null;
  description: string | null;
}

export interface RdfIndicator {
  iri: string;
  name: string;
  description: string | null;
  example: string | null;
  qualitative: boolean;
  valueType: string;
  thematic: string;
  /** Decimal strings (`"0"`, `"12.5"`), or `null`. */
  min: string | null;
  max: string | null;
  /** The key of a unit in `RdfModel.units`. */
  unit: string | null;
  /** Keys of terms in `means` and `tools`. */
  measuredBy: string[];
  automatedBy: string[];
  /** One entry per category: the strongest relation any of the sets that map to it gives (merged by the builder). */
  applied: { category: string; relation: RimoRelation }[];
}

/** Everything the export says. It has no field for a service, a person or a measurement, so it cannot leak one. */
export interface RdfModel {
  /** The IRI base, without a trailing slash. */
  base: string;
  /** The IRI of the catalogue node, which says which RIMO version the data follows. */
  catalogue: string;
  ontology: { iri: string; version: string };
  units: RdfUnit[];
  means: RdfTerm[];
  tools: RdfTerm[];
  categories: RdfCategory[];
  indicators: RdfIndicator[];
}

// ---------------------------------------------------------------------------------------------------------------
// Escaping

/** What an IRI must not hold in this system: controls, space, non-ASCII and any of `<>"{}|^`, backtick and backslash. */
const IRI_FORBIDDEN = /[^\x21-\x7e]|[<>"{}|^`\\]/;

/**
 * Refuses an IRI that is not a plain absolute `http(s)` IRI in printable ASCII (a space, `>`, a quote, a control
 * character, a backslash, another scheme, no host). Returns it unchanged, so it can be written between `<` and `>`.
 */
export function assertIri(iri: string): string {
  if (IRI_FORBIDDEN.test(iri))
    throw new RangeError(`the IRI ${JSON.stringify(iri.slice(0, 80))} has a forbidden character`);
  let url: URL;
  try {
    url = new URL(iri);
  } catch {
    throw new RangeError(`${JSON.stringify(iri.slice(0, 80))} is not an absolute IRI`);
  }
  // The WHATWG parser repairs `https:///a` to `https://a/`; the text is written as it is, so it is checked as it is.
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.hostname === '' ||
    !/^https?:\/\/[^/?#]/.test(iri)
  )
    throw new RangeError(`the IRI ${JSON.stringify(iri.slice(0, 80))} is not a plain http(s) IRI`);
  return iri;
}

const SHORT_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  '"': '\\"',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
};

/** `\uXXXX` for a code point of the BMP (every character this function escapes that way is one). */
const unicodeEscape = (code: number) => `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * A Turtle string literal, quotes included. Escapes `\`, `"`, the line breaks and the other C0 controls, DEL and the C1
 * controls (so NEL cannot break a line-based tool) and the line and paragraph separators; a lone surrogate becomes
 * U+FFFD; every other character, non-ASCII included, is written as it is (Turtle is UTF-8).
 */
export function turtleString(value: string): string {
  let out = '"';
  for (const char of value.toWellFormed()) {
    const short = SHORT_ESCAPES[char];
    if (short !== undefined) {
      out += short;
      continue;
    }
    const code = char.codePointAt(0)!;
    out +=
      code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029
        ? unicodeEscape(code)
        : char;
  }
  return `${out}"`;
}

const DECIMAL = /^-?[0-9]{1,30}(\.[0-9]{1,30})?$/;

/** A decimal as the database writes it. Anything else is refused: a typed literal is never made from free text. */
export function assertDecimal(value: string): string {
  if (!DECIMAL.test(value))
    throw new RangeError(`${JSON.stringify(value.slice(0, 40))} is not a decimal`);
  return value;
}

/** Strings in the JSON-LD are written with `<`, `>`, `&` and the line separators escaped, so a reader that embeds it is safe. */
const JSON_UNSAFE = /[<>&\u2028\u2029]/g;
const jsonEscape = (char: string) => unicodeEscape(char.charCodeAt(0));

/** `JSON.stringify` and nothing else turns the document into text. */
export function serializeJsonLd(document: unknown, space?: number): string {
  return JSON.stringify(document, null, space).replace(JSON_UNSAFE, jsonEscape);
}

// ---------------------------------------------------------------------------------------------------------------
// The graph both formats are rendered from

type Term = { iri: string } | { string: string } | { boolean: boolean } | { decimal: string };

interface GraphNode {
  id: string;
  types: string[];
  /** Predicate (a prefixed name) and its objects, in the order they are written. */
  properties: [string, Term[]][];
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const iri = (value: string): Term => ({ iri: value });
const text = (value: string): Term => ({ string: value.toWellFormed() });
const sorted = <T>(items: readonly T[], key: (item: T) => string): T[] =>
  [...items].sort((a, b) => byCode(key(a), key(b)));

/**
 * The model as nodes, in a fixed order: the catalogue, the categories, the units, the means, the tools, then each
 * indicator followed by its value node. The input order does not matter.
 */
export function graphOf(model: RdfModel): GraphNode[] {
  const unitByKey = new Map(model.units.map((unit) => [unit.key, unit]));
  const meansByKey = new Map(model.means.map((term) => [term.key, term]));
  const toolsByKey = new Map(model.tools.map((term) => [term.key, term]));
  const pick = <T>(map: ReadonlyMap<string, T>, key: string, what: string): T => {
    const found = map.get(key);
    if (!found) throw new RangeError(`the ${what} ${JSON.stringify(key)} is not in the model`);
    return found;
  };
  const nodes: GraphNode[] = [
    {
      id: model.catalogue,
      types: [],
      properties: [
        ['dct:conformsTo', [iri(model.ontology.iri)]],
        ['dct:hasVersion', [text(model.ontology.version)]],
      ],
    },
  ];

  for (const category of sorted(model.categories, (c) => c.iri)) {
    const properties: GraphNode['properties'] = [];
    if (!category.rimo) {
      if (category.name !== null) properties.push(['skos:prefLabel', [text(category.name)]]);
      if (category.description !== null)
        properties.push(['dct:description', [text(category.description)]]);
    }
    nodes.push({ id: category.iri, types: ['rimo:ServiceCategory'], properties });
  }
  for (const unit of sorted(model.units, (u) => u.key)) {
    const properties: GraphNode['properties'] = [['skos:notation', [text(unit.key)]]];
    if (unit.symbol !== null) properties.push(['scorpion:symbol', [text(unit.symbol)]]);
    if (unit.uoIri !== null) properties.push(['skos:closeMatch', [iri(unit.uoIri)]]);
    nodes.push({ id: unit.iri, types: ['scorpion:Unit'], properties });
  }
  for (const term of sorted(model.means, (t) => t.key))
    nodes.push({
      id: term.iri,
      types: ['rimo:MeasurementMeans'],
      properties: [['skos:notation', [text(term.key)]]],
    });
  for (const term of sorted(model.tools, (t) => t.key))
    nodes.push({
      id: term.iri,
      types: ['rimo:AutomationTool'],
      properties: [['skos:notation', [text(term.key)]]],
    });

  for (const indicator of sorted(model.indicators, (i) => i.iri)) {
    const valueId = `${indicator.iri}#value`;
    const properties: GraphNode['properties'] = [['rimo:KPIName', [text(indicator.name)]]];
    if (indicator.description !== null)
      properties.push(['rimo:KPIDescription', [text(indicator.description)]]);
    if (indicator.example !== null) properties.push(['rimo:KPIExample', [text(indicator.example)]]);
    properties.push(['rimo:isQualitativeIndicator', [{ boolean: indicator.qualitative }]]);
    properties.push(['scorpion:thematicCategory', [text(indicator.thematic)]]);
    properties.push(['rimo:hasValue', [iri(valueId)]]);
    if (indicator.measuredBy.length > 0)
      properties.push([
        'rimo:measuredBy',
        sorted(
          indicator.measuredBy.map((key) => pick(meansByKey, key, 'means').iri),
          (value) => value,
        ).map(iri),
      ]);
    if (indicator.automatedBy.length > 0)
      properties.push([
        'rimo:canBeAutomatedBy',
        sorted(
          indicator.automatedBy.map((key) => pick(toolsByKey, key, 'tool').iri),
          (value) => value,
        ).map(iri),
      ]);
    for (const relation of ['mandatoryFor', 'recommendedFor', 'appliedTo'] as const) {
      const targets = indicator.applied
        .filter((entry) => entry.relation === relation)
        .map((entry) => entry.category);
      if (targets.length > 0)
        properties.push([`rimo:${relation}`, sorted([...new Set(targets)], (v) => v).map(iri)]);
    }
    nodes.push({ id: indicator.iri, types: ['rimo:KPI'], properties });

    const unit = indicator.unit === null ? null : pick(unitByKey, indicator.unit, 'unit');
    const valueProperties: GraphNode['properties'] = [];
    // The Units Ontology term where there is one (several seeded units share `count unit`), else the minted unit.
    if (unit) {
      valueProperties.push(['rimo:hasUnit', [iri(unit.uoIri ?? unit.iri)]]);
      valueProperties.push(['scorpion:unit', [iri(unit.iri)]]);
    }
    valueProperties.push(['scorpion:valueType', [text(indicator.valueType)]]);
    if (indicator.min !== null)
      valueProperties.push(['scorpion:minValue', [{ decimal: assertDecimal(indicator.min) }]]);
    if (indicator.max !== null)
      valueProperties.push(['scorpion:maxValue', [{ decimal: assertDecimal(indicator.max) }]]);
    nodes.push({ id: valueId, types: ['rimo:KPIValue'], properties: valueProperties });
  }
  return nodes;
}

function prefixesOf(model: RdfModel): Record<string, string> {
  return { ...FIXED_PREFIXES, scorpion: `${model.base}/kpi/ns#` };
}

// ---------------------------------------------------------------------------------------------------------------
// Turtle

/** A prefixed local name that needs no escaping in Turtle: letters, digits and `_`. */
const SAFE_LOCAL = /^[A-Za-z0-9_]{1,100}$/;

function compactIri(value: string, prefixes: Record<string, string>): string {
  assertIri(value);
  for (const [prefix, namespace] of Object.entries(prefixes)) {
    if (value.startsWith(namespace) && SAFE_LOCAL.test(value.slice(namespace.length)))
      return `${prefix}:${value.slice(namespace.length)}`;
  }
  return `<${value}>`;
}

function turtleTerm(term: Term, prefixes: Record<string, string>): string {
  if ('iri' in term) return compactIri(term.iri, prefixes);
  if ('string' in term) return turtleString(term.string);
  if ('boolean' in term) return term.boolean ? 'true' : 'false';
  return `"${assertDecimal(term.decimal)}"^^xsd:decimal`;
}

/** The model as Turtle. The same model gives the same bytes. */
export function toTurtle(model: RdfModel): string {
  const prefixes = prefixesOf(model);
  const lines: string[] = [];
  for (const [prefix, namespace] of Object.entries(prefixes))
    lines.push(`@prefix ${prefix}: <${assertIri(namespace)}> .`);
  for (const node of graphOf(model)) {
    const predicates: string[] = [];
    if (node.types.length > 0) predicates.push(`a ${node.types.join(', ')}`);
    for (const [predicate, objects] of node.properties)
      predicates.push(`${predicate} ${objects.map((o) => turtleTerm(o, prefixes)).join(', ')}`);
    lines.push('', `${compactIri(node.id, prefixes)} ${predicates.join(' ;\n    ')} .`);
  }
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------
// JSON-LD

function jsonLdValue(term: Term): unknown {
  if ('iri' in term) return { '@id': assertIri(term.iri) };
  if ('string' in term) return term.string;
  if ('boolean' in term) return term.boolean;
  return { '@value': assertDecimal(term.decimal), '@type': 'xsd:decimal' };
}

/** The model as a JSON-LD document (a flat `@graph` with a `@context` of the prefixes). */
export function toJsonLdDocument(model: RdfModel): Record<string, unknown> {
  const graph = graphOf(model).map((node) => {
    const entry: Record<string, unknown> = { '@id': assertIri(node.id) };
    if (node.types.length > 0)
      entry['@type'] = node.types.length === 1 ? node.types[0] : node.types;
    for (const [predicate, objects] of node.properties) {
      const values = objects.map(jsonLdValue);
      entry[predicate] = values.length === 1 ? values[0] : values;
    }
    return entry;
  });
  // `uo` stays out of the context: its namespace ends in `_`, which JSON-LD 1.1 does not take as a prefix, and the
  // Units Ontology IRIs are written in full here anyway.
  const context: Record<string, string> = prefixesOf(model);
  delete context.uo;
  return { '@context': context, '@graph': graph };
}

/** The model as JSON-LD text (`application/ld+json`). The same model gives the same bytes. */
export function toJsonLd(model: RdfModel): string {
  return `${serializeJsonLd(toJsonLdDocument(model), 2)}\n`;
}
