// The words a password may not be or contain (ASVS 6.1.2, 6.2.11): the names of this installation,
// the person's own names and a short list for the project. Pure functions, so the rule is a table
// test. `docs/security/authentication.md` lists them for the reader.

/** Fixed for every installation; the instance's own names come from the settings. */
export const PROJECT_WORDS = ['Scorpion', 'de.NBI', 'NFDI', 'IPK'] as const;

/** A term counts from this many characters (letters and digits), a part of a longer term from `PART_MIN`. */
const TERM_MIN = 3;
const PART_MIN = 4;

/**
 * The words of a text: lower case, split at everything that is not a letter or a digit and at
 * every border between letters and digits, so `Scorpion2024!` is `scorpion` and `2024`.
 */
export function wordsOf(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+|(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u)
    .filter((word) => word.length > 0);
}

export interface ContextSources {
  instanceName?: string | null;
  productName?: string | null;
  /** The public host name, without a port. */
  host?: string | null;
  username?: string | null;
  email?: string | null;
}

/** A term is a phrase: the words that must follow each other in the password. */
export type ContextTerm = readonly string[];

const length = (phrase: ContextTerm) => phrase.join('').length;

/**
 * The terms for one password: each source as a phrase, each longer word of a multi-word source on
 * its own, and a multi-word source written together (`de.NBI` also as `denbi`).
 */
export function contextTerms(sources: ContextSources): ContextTerm[] {
  const texts = [
    sources.instanceName,
    sources.productName,
    sources.host,
    sources.username,
    sources.email?.split('@')[0],
    ...PROJECT_WORDS,
  ];
  const seen = new Map<string, ContextTerm>();
  const add = (phrase: ContextTerm, min: number) => {
    if (length(phrase) >= min) seen.set(phrase.join('\u0000'), phrase);
  };
  for (const text of texts) {
    if (!text) continue;
    const phrase = wordsOf(text);
    add(phrase, TERM_MIN);
    if (phrase.length > 1) {
      add([phrase.join('')], TERM_MIN);
      for (const part of phrase) add([part], PART_MIN);
    }
  }
  return [...seen.values()];
}

/** The first term that is the whole password or a run of whole words of it, or `undefined`. */
export function findContextWord(
  password: string,
  terms: readonly ContextTerm[],
): ContextTerm | undefined {
  const words = wordsOf(password);
  return terms.find((term) => {
    for (let start = 0; start + term.length <= words.length; start += 1) {
      if (term.every((word, offset) => words[start + offset] === word)) return true;
    }
    return false;
  });
}
