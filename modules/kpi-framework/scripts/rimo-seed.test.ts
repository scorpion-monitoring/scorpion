// The extractor reads one regular shape of Turtle and fails loudly on every other (ADR-0040). One fixture per
// construct it supports, one per construct it refuses, and the drift test: the committed seed is what the
// committed RIMO.ttl produces.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  extractSeed,
  generateSeedText,
  parseTurtle,
  SEED_PATH,
  ShapeError,
  TTL_PATH,
  type Term,
} from './rimo-seed.ts';

const PREFIXES = '@prefix ex: <http://e/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n';
const lit = (value: string, extra: { language?: string; datatype?: string } = {}): Term => ({
  kind: 'literal',
  value,
  ...extra,
});
const iri = (value: string): Term => ({ kind: 'iri', value });
const objects = (text: string) => parseTurtle(PREFIXES + text).map((t) => t.object);

describe('parseTurtle: the constructs it supports', () => {
  it.each<[string, string, Term[]]>([
    ['a prefixed name', 'ex:a ex:p ex:b .', [iri('http://e/b')]],
    [
      'an IRI as subject, predicate and object',
      '<http://s> <http://p> <http://o> .',
      [iri('http://o')],
    ],
    ['the keyword a', 'ex:a a ex:C .', [iri('http://e/C')]],
    ['a name with an empty local part', 'ex:a ex:p ex: .', [iri('http://e/')]],
    [
      'a name with a dot, a dash and a digit inside',
      'ex:a ex:p ex:b-1.x .',
      [iri('http://e/b-1.x')],
    ],
    ['no space before the final dot', 'ex:a ex:p ex:b.', [iri('http://e/b')]],
    ['a plain string', 'ex:a ex:p "hello" .', [lit('hello')]],
    ['a string with a language tag', 'ex:a ex:p "hello"@EN .', [lit('hello', { language: 'en' })]],
    ['a language tag with a region', 'ex:a ex:p "x"@de-AT .', [lit('x', { language: 'de-at' })]],
    [
      'a string with a prefixed datatype',
      'ex:a ex:p "2025-11-05"^^xsd:date .',
      [lit('2025-11-05', { datatype: 'http://www.w3.org/2001/XMLSchema#date' })],
    ],
    [
      'a string with an IRI datatype',
      'ex:a ex:p "1"^^<http://d> .',
      [lit('1', { datatype: 'http://d' })],
    ],
    ['the short escapes', 'ex:a ex:p "a\\tb\\n\\"q\\"\\\\" .', [lit('a\tb\n"q"\\')]],
    ['a \\u escape', 'ex:a ex:p "caf\\u00e9" .', [lit('café')]],
    ['a \\U escape', 'ex:a ex:p "\\U0001F600" .', [lit('😀')]],
    ['a hash inside a string', 'ex:a ex:p "# not a comment" .', [lit('# not a comment')]],
    [
      'a triple-quoted string over two lines, with a quote inside',
      'ex:a ex:p """one\ntwo "q" end"""@en .',
      [lit('one\ntwo "q" end', { language: 'en' })],
    ],
    ['a comment after a statement', 'ex:a ex:p "x" . # trailing', [lit('x')]],
    ['a comment between statements', '# only a comment\nex:a ex:p "x" .', [lit('x')]],
  ])('%s', (_name, text, expected) => {
    expect(objects(text)).toEqual(expected);
  });

  it('reads a list of objects with a comma and a list of predicates with a semicolon', () => {
    const triples = parseTurtle(
      `${PREFIXES}ex:a a ex:C ;\n  ex:p "one" , "two" ;\n  ex:q ex:b ;\n  ex:r "three" .`,
    );
    expect(triples.map((t) => [t.predicate, t.object])).toEqual([
      ['http://www.w3.org/1999/02/22-rdf-syntax-ns#type', iri('http://e/C')],
      ['http://e/p', lit('one')],
      ['http://e/p', lit('two')],
      ['http://e/q', iri('http://e/b')],
      ['http://e/r', lit('three')],
    ]);
    expect(new Set(triples.map((t) => t.subject))).toEqual(new Set(['http://e/a']));
  });

  it('accepts a trailing semicolon before the dot', () => {
    expect(objects('ex:a ex:p "x" ; .')).toEqual([lit('x')]);
  });

  it('reads several statements and reports the line of a triple', () => {
    const triples = parseTurtle(`${PREFIXES}\nex:a ex:p "x" .\n\nex:b ex:p "y" .`);
    expect(triples.map((t) => [t.subject, t.line])).toEqual([
      ['http://e/a', 4],
      ['http://e/b', 6],
    ]);
  });
});

describe('parseTurtle: the shapes it refuses', () => {
  it.each<[string, string, RegExp]>([
    ['a blank node', 'ex:a ex:p [ ex:q "x" ] .', /blank node or a collection/],
    ['a collection', 'ex:a ex:p ( ex:b ex:c ) .', /blank node or a collection/],
    ['a blank node label', 'ex:a ex:p _:b .', /blank node label/],
    ['@base', '@base <http://e/> .\nex:a ex:p "x" .', /@prefix/],
    ['another directive', '@version "1.1" .', /@prefix/],
    ['SPARQL-style PREFIX', 'PREFIX ex: <http://e/>\nex:a ex:p "x" .', /PREFIX/],
    ['a number', 'ex:a ex:p 42 .', /number/],
    ['a boolean', 'ex:a ex:p true .', /not supported/],
    ['a single-quoted string', "ex:a ex:p 'x' .", /single-quoted/],
    ['an undeclared prefix', 'nope:a ex:p "x" .', /prefix "nope:"/],
    ['a string that is not closed', 'ex:a ex:p "x .', /not closed|line end/],
    ['a short string over a line end', 'ex:a ex:p "x\ny" .', /line end/],
    ['a triple-quoted string that is not closed', 'ex:a ex:p """x .', /not closed/],
    ['an unknown escape', 'ex:a ex:p "\\q" .', /escape/],
    ['a bad \\u escape', 'ex:a ex:p "\\u12" .', /\\u escape/],
    ['a surrogate \\u escape', 'ex:a ex:p "\\ud800" .', /not a character/],
    ['an IRI with a space', 'ex:a ex:p <http://a b> .', /not allowed/],
    ['an IRI that is not closed', 'ex:a ex:p <http://a', /not closed/],
    ['a statement without a final dot', 'ex:a ex:p "x"', /ends in the middle/],
    ['two objects without a comma', 'ex:a ex:p "x" "y" .', /"," ";" or "\."/],
    ['a name with a percent escape', 'ex:a ex:p ex:b%20c .', /escape in a name/],
    ['a stray character', 'ex:a ex:p "x" ! .', /unexpected character/],
    ['a punctuation mark as object', 'ex:a ex:p ; .', /where an object was expected/],
    ['a bad language tag', 'ex:a ex:p "x"@ .', /language tag/],
    ['a bad datatype', 'ex:a ex:p "x"^^ .', /datatype/],
  ])('%s', (_name, text, message) => {
    const failure = () => parseTurtle(PREFIXES + text);
    expect(failure).toThrow(ShapeError);
    expect(failure).toThrow(message);
  });

  it('names the line of the failure', () => {
    try {
      parseTurtle(`${PREFIXES}\n\nex:a ex:p 42 .`);
      expect.unreachable();
    } catch (error) {
      expect((error as ShapeError).line).toBe(5);
      expect((error as ShapeError).message).toContain('line 5');
    }
  });
});

const HEADER = `@prefix rimo: <http://w3id.org/RIMO#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<http://w3id.org/RIMO> a owl:Ontology ;
  dct:title "Title"@en ; dct:issued "2025-11-05"^^xsd:date ; dct:modified "2025-11-06"^^xsd:date ;
  dct:license <http://creativecommons.org/licenses/by/4.0/> ; owl:versionInfo "0.2.0" .
`;
const CATEGORY = `rimo:Web_API a rimo:ServiceCategory ; rdfs:label "Web API"@en ; rdfs:comment "An API."@en .\n`;

describe('extractSeed', () => {
  it('reads the header and one category', () => {
    expect(extractSeed(HEADER + CATEGORY)).toEqual({
      ontology: {
        iri: 'http://w3id.org/RIMO',
        title: 'Title',
        version: '0.2.0',
        issued: '2025-11-05',
        modified: '2025-11-06',
        license: 'http://creativecommons.org/licenses/by/4.0/',
      },
      namespace: 'http://w3id.org/RIMO#',
      categories: [
        {
          key: 'Web_API',
          iri: 'http://w3id.org/RIMO#Web_API',
          label: 'Web API',
          comment: 'An API.',
        },
      ],
    });
  });

  it('keeps the order of the file and ignores other classes and subjects', () => {
    const text = `${HEADER}rimo:KPI a owl:Class ; rdfs:label "KPI"@en .\n${CATEGORY}rimo:Library a rimo:ServiceCategory ; rdfs:label "Library"@en ; rdfs:comment "L."@en .\n`;
    expect(extractSeed(text).categories.map((c) => c.key)).toEqual(['Web_API', 'Library']);
  });

  it.each<[string, string, RegExp]>([
    ['a file without categories', HEADER, /no rimo:ServiceCategory/],
    [
      'a category without a label',
      HEADER + 'rimo:X a rimo:ServiceCategory ; rdfs:comment "c"@en .',
      /no rdfs:label/,
    ],
    [
      'a category without a comment',
      HEADER + 'rimo:X a rimo:ServiceCategory ; rdfs:label "x"@en .',
      /no rdfs:comment/,
    ],
    [
      'a category with two English labels',
      HEADER + CATEGORY + 'rimo:Web_API rdfs:label "Other"@en .',
      /2 rdfs:label/,
    ],
    [
      'a category with only a German label',
      HEADER + 'rimo:X a rimo:ServiceCategory ; rdfs:label "x"@de ; rdfs:comment "c"@en .',
      /no rdfs:label/,
    ],
    [
      'a category outside the namespace',
      HEADER +
        '<http://other/X> a rimo:ServiceCategory ; rdfs:label "x"@en ; rdfs:comment "c"@en .',
      /not in the namespace/,
    ],
    [
      'a category whose name cannot be a term key',
      HEADER + 'rimo:a.b a rimo:ServiceCategory ; rdfs:label "x"@en ; rdfs:comment "c"@en .',
      /cannot be a term key/,
    ],
    [
      'two categories that differ only in case',
      HEADER +
        'rimo:Ab a rimo:ServiceCategory ; rdfs:label "x"@en ; rdfs:comment "c"@en .\nrimo:aB a rimo:ServiceCategory ; rdfs:label "y"@en ; rdfs:comment "d"@en .',
      /differ only in case/,
    ],
    ['no version', HEADER.replace('; owl:versionInfo "0.2.0"', ''), /owl:versionInfo/],
    ['a version that is not x.y.z', HEADER.replace('"0.2.0"', '"v2"'), /not of the form/],
    ['no licence', HEADER.replace(/dct:license <[^>]*> ;/, ''), /dct:license/],
    ['no title', HEADER.replace('dct:title "Title"@en ;', ''), /dct:title/],
  ])('fails for %s', (_name, text, message) => {
    expect(() => extractSeed(text)).toThrow(ShapeError);
    expect(() => extractSeed(text)).toThrow(message);
  });
});

describe('the committed RIMO.ttl and seed', () => {
  it('has the 16 service categories of RIMO 0.2.0', () => {
    const seed = extractSeed(readFileSync(TTL_PATH, 'utf8'));
    expect(seed.ontology.version).toBe('0.2.0');
    expect(seed.ontology.license).toBe('http://creativecommons.org/licenses/by/4.0/');
    expect(seed.categories).toHaveLength(16);
    expect(seed.categories.map((c) => c.key)).toContain('Web_application');
    for (const category of seed.categories) {
      expect(category.iri).toBe(`http://w3id.org/RIMO#${category.key}`);
      expect(category.label.length).toBeGreaterThan(0);
      expect(category.comment.length).toBeGreaterThan(0);
    }
  });

  it('drift: regenerating the seed from RIMO.ttl gives the committed config/rimo-seed.json', () => {
    expect(readFileSync(SEED_PATH, 'utf8')).toBe(generateSeedText());
  });
});
