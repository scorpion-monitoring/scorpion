import { describe, expect, it } from 'vitest';
import { contextTerms, findContextWord, PROJECT_WORDS, wordsOf } from './password-words.ts';

describe('wordsOf', () => {
  it.each([
    ['Scorpion', ['scorpion']],
    ['Scorpion2024!', ['scorpion', '2024']],
    ['de.NBI', ['de', 'nbi']],
    ['my-IPK_password', ['my', 'ipk', 'password']],
    ['  spaced   out  ', ['spaced', 'out']],
    ['ÄÖÜ-straße', ['äöü', 'straße']],
    ['', []],
    ['!!!', []],
  ])('splits %j into %j', (text, expected) => {
    expect(wordsOf(text)).toEqual(expected);
  });
});

const sources = {
  instanceName: 'Plant Registry',
  productName: 'Scorpion',
  host: 'registry.example.org',
  username: 'feser_m',
  email: 'manuel.feser@ipk-gatersleben.de',
};
const terms = contextTerms(sources);

describe('findContextWord', () => {
  it.each([
    // the whole password
    ['scorpion', true],
    ['SCORPION', true],
    ['NFDI', true],
    ['de.nbi', true],
    ['DE.NBI', true],
    ['IPK', true],
    // as a whole word inside it
    ['my scorpion password', true],
    ['Scorpion-2024-xyz', true],
    ['scorpion2024', true],
    ['correct-horse-nfdi-battery', true],
    ['x.de.NBI.y', true],
    ['denbi-2024', true],
    // the instance and its parts, the host, the username and the local part
    ['plant registry', true],
    ['registry-horse', true],
    ['horse-plant-battery', true],
    ['registry.example.org', true],
    ['example horse', true], // a label of the host
    ['feser_m', true],
    ['feser-is-here', true],
    ['manuel.feser', true],
    ['manuel is great', true],
    // not whole words
    ['scorpions', false],
    ['unscorpioned', false],
    ['ipkx', false],
    ['nfdiplus', false],
    ['correct horse battery staple', false],
    // a part shorter than 4 characters of a longer term is not a term of its own
    ['org', false],
    ['org-horse-battery', false],
    ['de', false],
    ['nbi', false],
    ['', false],
  ])('%j → refused: %s', (password, refused) => {
    expect(findContextWord(password, terms) !== undefined).toBe(refused);
  });

  it('refuses nothing for a name that is too short to be a term', () => {
    expect(findContextWord('ab', contextTerms({ username: 'ab' }))).toBeUndefined();
  });
});

describe('contextTerms', () => {
  it('always holds the documented project words', () => {
    const own = contextTerms({});
    for (const word of PROJECT_WORDS) {
      expect(own).toContainEqual(wordsOf(word));
    }
  });

  it('skips missing sources and does not repeat a term', () => {
    const list = contextTerms({ instanceName: 'Scorpion', productName: 'scorpion', email: null });
    expect(list.filter((term) => term.join(' ') === 'scorpion')).toHaveLength(1);
  });

  it('uses the part of the address before the @ only', () => {
    expect(
      findContextWord('example', contextTerms({ email: 'jo.doe@example.org' })),
    ).toBeUndefined();
    expect(findContextWord('jo.doe', contextTerms({ email: 'jo.doe@example.org' }))).toBeDefined();
  });
});
