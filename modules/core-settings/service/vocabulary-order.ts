// Pure helpers for vocabulary terms: their order and the label a locale sees.

export interface OrderedTerm {
  key: string;
  sortOrder: number;
}

/** Binary comparison, so that the order never depends on the database or process locale. */
const compareKeys = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Terms by `sortOrder`, then by key (binary). Returns a new array. */
export function orderTerms<T extends OrderedTerm>(terms: readonly T[]): T[] {
  return [...terms].sort((a, b) => a.sortOrder - b.sortOrder || compareKeys(a.key, b.key));
}

/**
 * The label for a locale: the exact one (`de-AT`), else its language (`de`), else English, else
 * the first one (by locale, for a stable answer), else the key.
 */
export function labelFor(labels: Readonly<Record<string, string>>, locale: string, key: string) {
  const language = locale.split('-')[0] ?? locale;
  return (
    labels[locale] ??
    labels[language] ??
    labels.en ??
    Object.entries(labels).sort(([a], [b]) => compareKeys(a, b))[0]?.[1] ??
    key
  );
}
