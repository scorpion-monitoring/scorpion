// Deterministic JSON: object keys in sorted order at every depth, two spaces, a newline at the end. Arrays keep the order they were given (the
// builders sort the ones whose order carries no meaning), so two exports of the same code are the same bytes and a diff shows real changes.
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => [key, sortKeys(entry)]),
    );
  }
  return value;
}

export const stableJson = (value: unknown): string =>
  `${JSON.stringify(sortKeys(value), null, 2)}\n`;

/** Strings by code unit, not by locale, so the order does not depend on the machine. */
export const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
