// The terms of a vocabulary as the page uses them, and the label of one in the person's language. The label comes from the vocabulary (data),
// never from this module; a key that is no longer a term shows as itself.
export interface Term {
  key: string;
  labels: Record<string, string>;
  active: boolean;
}

export function labelOf(terms: readonly Term[], key: string, locale: string): string {
  const term = terms.find((entry) => entry.key === key);
  return term ? (term.labels[locale] ?? term.labels.en ?? key) : key;
}
