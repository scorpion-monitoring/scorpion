// `pnpm --filter @scorpion/kpi-framework rimo:seed [--check]`: reads config/rimo/RIMO.ttl and writes
// config/rimo-seed.json (the ontology's IRI and version, and its service categories). `--check` compares and
// fails on a difference instead of writing (the drift test does the same).
//
// This is not a Turtle parser. It reads the one regular shape that RIMO.ttl uses (ADR-0040): `@prefix` lines,
// `#` comments, statements of `subject predicate object` with `;` and `,` lists, IRIs, prefixed names, the
// keyword `a`, and strings with a language tag or a datatype (short or triple-quoted). It **fails loudly**,
// with the line, on anything else: blank nodes, collections, numbers, booleans, `@base`, SPARQL-style
// `PREFIX`, single-quoted strings. A new RIMO file that changes a shape therefore cannot pass quietly.
import { readFileSync, writeFileSync } from 'node:fs';

/** The file's own namespace and the terms this script reads. */
const RIMO_NS = 'http://w3id.org/RIMO#';
const ONTOLOGY_IRI = 'http://w3id.org/RIMO';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const RDFS_COMMENT = 'http://www.w3.org/2000/01/rdf-schema#comment';
const OWL_VERSION = 'http://www.w3.org/2002/07/owl#versionInfo';
const DCT = 'http://purl.org/dc/terms/';
const CLASS_SERVICE_CATEGORY = `${RIMO_NS}ServiceCategory`;
/** What a category's local name must look like: it becomes the key of a vocabulary term. */
const CATEGORY_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export class ShapeError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`RIMO.ttl line ${line}: ${message}`);
    this.name = 'ShapeError';
    this.line = line;
  }
}

export type Term =
  | { kind: 'iri'; value: string }
  | { kind: 'literal'; value: string; language?: string; datatype?: string };
export interface Triple {
  subject: string;
  predicate: string;
  object: Term;
  line: number;
}

type Token =
  | { type: 'iri' | 'pname' | 'punct'; value: string; line: number }
  | {
      type: 'string';
      value: string;
      language?: string;
      /** Written as an IRI. */
      datatype?: string;
      /** Written as a prefixed name, resolved when the prefixes are known. */
      datatypeName?: string;
      line: number;
    };

const PNAME_PREFIX = /^[A-Za-z][A-Za-z0-9_-]*$/;
const PNAME_LOCAL_CHAR = /[A-Za-z0-9_:.-]/;
const IRI_FORBIDDEN = /[^\x21-\x7e]|[<>"{}|^`\\]/;
const ESCAPES: Record<string, string> = {
  t: '\t',
  b: '\b',
  n: '\n',
  r: '\r',
  f: '\f',
  '"': '"',
  "'": "'",
  '\\': '\\',
};

/** Splits the text into tokens; anything outside the supported shape is a `ShapeError`. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const fail = (message: string): never => {
    throw new ShapeError(message, line);
  };
  const isPnameStart = (c: string | undefined) => c !== undefined && /[A-Za-z]/.test(c);

  while (i < text.length) {
    const c = text[i]!;
    if (c === '\n') {
      line++;
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r') {
      i++;
    } else if (c === '#') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '<') {
      const end = text.indexOf('>', i);
      if (end < 0) fail('an IRI is not closed');
      const value = text.slice(i + 1, end);
      if (IRI_FORBIDDEN.test(value))
        fail(`an IRI holds a character that is not allowed: <${value}>`);
      tokens.push({ type: 'iri', value, line });
      i = end + 1;
    } else if (c === '"') {
      const start = line;
      const long = text.startsWith('"""', i);
      let value = '';
      i += long ? 3 : 1;
      let closed = false;
      while (i < text.length) {
        const d = text[i]!;
        if (d === '\\') {
          const e = text[i + 1];
          if (e === 'u' || e === 'U') {
            const length = e === 'u' ? 4 : 8;
            const hex = text.slice(i + 2, i + 2 + length);
            if (hex.length !== length || !/^[0-9A-Fa-f]+$/.test(hex))
              fail('a \\u escape is not valid');
            const code = Number.parseInt(hex, 16);
            if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
              fail('a \\u escape is not a character');
            value += String.fromCodePoint(code);
            i += 2 + length;
          } else if (e !== undefined && e in ESCAPES) {
            value += ESCAPES[e];
            i += 2;
          } else {
            fail(`an escape in a string is not supported: \\${e ?? ''}`);
          }
        } else if (long ? text.startsWith('"""', i) : d === '"') {
          i += long ? 3 : 1;
          closed = true;
          break;
        } else if (d === '\n') {
          if (!long) fail('a short string runs over a line end');
          line++;
          value += d;
          i++;
        } else {
          value += d;
          i++;
        }
      }
      if (!closed) throw new ShapeError('a string is not closed', start);
      const token: Token = { type: 'string', value, line: start };
      if (text[i] === '@') {
        const match = /^@([A-Za-z]+(?:-[A-Za-z0-9]+)*)/.exec(text.slice(i, i + 40));
        if (!match) fail('a language tag is not valid');
        token.language = match![1]!.toLowerCase();
        i += match![0].length;
      } else if (text.startsWith('^^', i)) {
        i += 2;
        if (text[i] === '<') {
          const end = text.indexOf('>', i);
          if (end < 0) fail('a datatype IRI is not closed');
          token.datatype = text.slice(i + 1, end);
          i = end + 1;
        } else {
          let j = i;
          while (j < text.length && /[A-Za-z0-9_:.-]/.test(text[j]!)) j++;
          let name = text.slice(i, j);
          while (name.endsWith('.')) {
            name = name.slice(0, -1);
            j--;
          }
          if (!/^[A-Za-z][A-Za-z0-9_-]*:[A-Za-z0-9_-]+$/.test(name))
            fail('a datatype is not valid');
          token.datatypeName = name;
          i = j;
        }
      }
      tokens.push(token);
    } else if (c === '.' || c === ';' || c === ',') {
      tokens.push({ type: 'punct', value: c, line });
      i++;
    } else if (c === '@') {
      // Only `@prefix` exists in this file. `@base` and any other directive is a new shape.
      if (text.startsWith('@prefix', i) && /\s/.test(text[i + 7] ?? '')) {
        tokens.push({ type: 'punct', value: '@prefix', line });
        i += 7;
      } else {
        fail('a directive other than @prefix is not supported');
      }
    } else if (isPnameStart(c)) {
      let j = i;
      while (j < text.length && PNAME_LOCAL_CHAR.test(text[j]!)) j++;
      let word = text.slice(i, j);
      // A name does not end in a dot: that dot ends the statement.
      while (word.endsWith('.')) {
        word = word.slice(0, -1);
        j--;
      }
      const next = text[j];
      if (next === '%' || next === '\\') fail(`an escape in a name is not supported: ${word}`);
      if (word === 'a') tokens.push({ type: 'punct', value: 'a', line });
      else if (word.includes(':')) tokens.push({ type: 'pname', value: word, line });
      else
        fail(
          `"${word}" is not supported (SPARQL-style PREFIX, booleans and bare words are other shapes)`,
        );
      i = j;
    } else if (c === '[' || c === ']' || c === '(' || c === ')') {
      fail(`"${c}" (a blank node or a collection) is not supported`);
    } else if (c === "'") {
      fail('a single-quoted string is not supported');
    } else if (/[0-9+-]/.test(c)) {
      fail('a number is not supported');
    } else if (c === '_') {
      fail('a blank node label is not supported');
    } else {
      fail(`unexpected character ${JSON.stringify(c)}`);
    }
  }
  return tokens;
}

/** Reads every triple of the text. Throws `ShapeError` on a shape outside the supported subset. */
export function parseTurtle(text: string): Triple[] {
  const tokens = tokenize(text);
  const prefixes = new Map<string, string>();
  const triples: Triple[] = [];
  let p = 0;

  const resolve = (name: string, line: number): string => {
    const colon = name.indexOf(':');
    const prefix = name.slice(0, colon);
    const local = name.slice(colon + 1);
    const base = prefixes.get(prefix);
    if (base === undefined) throw new ShapeError(`the prefix "${prefix}:" is not declared`, line);
    return base + local;
  };
  const peek = () => tokens[p];
  const lastLine = () => tokens[Math.min(p, tokens.length - 1)]?.line ?? 1;
  const next = (): Token => {
    const token = tokens[p++];
    if (!token) throw new ShapeError('the file ends in the middle of a statement', lastLine());
    return token;
  };
  const isPunct = (token: Token | undefined, value: string) =>
    token?.type === 'punct' && token.value === value;
  const node = (token: Token): string => {
    if (token.type === 'iri') return token.value;
    if (token.type === 'pname') return resolve(token.value, token.line);
    throw new ShapeError('a name or an IRI was expected', token.line);
  };

  while (p < tokens.length) {
    const first = next();
    if (isPunct(first, '@prefix')) {
      const name = next();
      const iri = next();
      const dot = next();
      if (
        name.type !== 'pname' ||
        !name.value.endsWith(':') ||
        !PNAME_PREFIX.test(name.value.slice(0, -1))
      )
        throw new ShapeError('@prefix needs a name that ends in a colon', first.line);
      if (iri.type !== 'iri') throw new ShapeError('@prefix needs an IRI', first.line);
      if (!isPunct(dot, '.')) throw new ShapeError('@prefix must end with a dot', first.line);
      prefixes.set(name.value.slice(0, -1), iri.value);
      continue;
    }
    const subject = node(first);
    // predicate-object list: p o (, o)* (; p o (, o)*)* ;? .
    let ended = false;
    while (!ended) {
      const predicateToken = next();
      const predicate = isPunct(predicateToken, 'a') ? RDF_TYPE : node(predicateToken);
      for (;;) {
        const object = next();
        let term: Term;
        if (object.type === 'string') {
          term = {
            kind: 'literal',
            value: object.value,
            ...(object.language && { language: object.language }),
            ...(object.datatype && { datatype: object.datatype }),
            ...(object.datatypeName && { datatype: resolve(object.datatypeName, object.line) }),
          };
        } else if (object.type === 'punct') {
          throw new ShapeError(`"${object.value}" where an object was expected`, object.line);
        } else {
          term = { kind: 'iri', value: node(object) };
        }
        triples.push({ subject, predicate, object: term, line: predicateToken.line });
        const after = next();
        if (isPunct(after, ',')) continue;
        if (isPunct(after, ';')) {
          // A trailing `;` before the dot is allowed.
          if (isPunct(peek(), '.')) {
            p++;
            ended = true;
          }
          break;
        }
        if (isPunct(after, '.')) {
          ended = true;
          break;
        }
        throw new ShapeError('a "," ";" or "." was expected after an object', after.line);
      }
    }
  }
  return triples;
}

export interface RimoCategory {
  /** The local name of the IRI: the key of the vocabulary term. */
  key: string;
  iri: string;
  label: string;
  comment: string;
}
export interface RimoSeed {
  ontology: {
    iri: string;
    title: string;
    version: string;
    issued: string;
    modified: string;
    license: string;
  };
  namespace: string;
  categories: RimoCategory[];
}

/** Takes exactly one English-less-or-`en` literal of `predicate` for `subject`; anything else is a shape error. */
function one(
  triples: Triple[],
  subject: string,
  predicate: string,
  what: string,
  language?: string,
): { value: string; line: number } {
  const found = triples.filter(
    (t) =>
      t.subject === subject &&
      t.predicate === predicate &&
      t.object.kind === 'literal' &&
      (language === undefined || t.object.language === language),
  );
  if (found.length !== 1)
    throw new ShapeError(
      `${found.length === 0 ? 'no' : `${found.length}`} ${what} for <${subject}> (exactly one${language ? ` @${language}` : ''} is expected)`,
      found[0]?.line ?? 1,
    );
  const t = found[0]!;
  return { value: (t.object as { value: string }).value, line: t.line };
}

/** The ontology header and the service categories. Fails on a file that does not have the known shape. */
export function extractSeed(text: string): RimoSeed {
  const triples = parseTurtle(text);

  const header = (predicate: string, what: string) =>
    one(triples, ONTOLOGY_IRI, predicate, what).value;
  const license = triples.filter(
    (t) => t.subject === ONTOLOGY_IRI && t.predicate === `${DCT}license` && t.object.kind === 'iri',
  );
  if (license.length !== 1)
    throw new ShapeError('the ontology needs exactly one dct:license IRI', 1);
  const title = one(triples, ONTOLOGY_IRI, `${DCT}title`, 'dct:title', 'en').value;
  const version = header(OWL_VERSION, 'owl:versionInfo');
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new ShapeError(`the version "${version}" is not of the form x.y.z`, 1);

  const subjects = [
    ...new Set(
      triples
        .filter(
          (t) =>
            t.predicate === RDF_TYPE &&
            t.object.kind === 'iri' &&
            t.object.value === CLASS_SERVICE_CATEGORY,
        )
        .map((t) => t.subject),
    ),
  ];
  const categories = subjects.map((iri): RimoCategory => {
    if (!iri.startsWith(RIMO_NS))
      throw new ShapeError(`the category <${iri}> is not in the namespace ${RIMO_NS}`, 1);
    const key = iri.slice(RIMO_NS.length);
    if (!CATEGORY_NAME.test(key))
      throw new ShapeError(`the name of the category <${iri}> cannot be a term key`, 1);
    return {
      key,
      iri,
      label: one(triples, iri, RDFS_LABEL, `rdfs:label of ${key}`, 'en').value,
      comment: one(triples, iri, RDFS_COMMENT, `rdfs:comment of ${key}`, 'en').value,
    };
  });
  if (categories.length === 0) throw new ShapeError('the file has no rimo:ServiceCategory', 1);
  const keys = new Set(categories.map((c) => c.key.toLowerCase()));
  if (keys.size !== categories.length)
    throw new ShapeError('two categories have names that differ only in case', 1);

  return {
    ontology: {
      iri: ONTOLOGY_IRI,
      title,
      version,
      issued: header(`${DCT}issued`, 'dct:issued'),
      modified: header(`${DCT}modified`, 'dct:modified'),
      license: (license[0]!.object as { value: string }).value,
    },
    namespace: RIMO_NS,
    categories,
  };
}

/** The seed as it is written to disk (the drift test compares this text). */
export function renderSeed(seed: RimoSeed): string {
  return `${JSON.stringify(seed, null, 2)}\n`;
}

const root = new URL('../config/', import.meta.url);
export const TTL_PATH = new URL('rimo/RIMO.ttl', root);
export const SEED_PATH = new URL('rimo-seed.json', root);

/** Regenerates the seed text from the committed `RIMO.ttl`. */
export function generateSeedText(): string {
  return renderSeed(extractSeed(readFileSync(TTL_PATH, 'utf8')));
}

if (import.meta.main) {
  try {
    const text = generateSeedText();
    if (process.argv.includes('--check')) {
      if (readFileSync(SEED_PATH, 'utf8') !== text) {
        console.error(
          'config/rimo-seed.json differs from RIMO.ttl. Run: pnpm --filter @scorpion/kpi-framework rimo:seed',
        );
        process.exit(1);
      }
    } else {
      writeFileSync(SEED_PATH, text);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
