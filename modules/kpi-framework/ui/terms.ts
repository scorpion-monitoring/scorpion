// The terms of a vocabulary as the pages use them, and the label of one in the person's language. The label comes
// from the vocabulary (data), never from this module; a key that is no longer a term shows as itself.
export interface Term {
  key: string;
  labels: Record<string, string>;
  active: boolean;
}

export function labelOf(terms: readonly Term[], key: string, locale: string): string {
  const term = terms.find((entry) => entry.key === key);
  return term ? (term.labels[locale] ?? term.labels.en ?? key) : key;
}

/**
 * The terms a select offers: the active ones, and the one the row already has even when it was deactivated (the
 * server keeps accepting it), so a form never silently changes a value.
 */
export function offered(terms: readonly Term[], current: readonly string[] = []): Term[] {
  const keep = new Set(current);
  return terms.filter((term) => term.active || keep.has(term.key));
}
