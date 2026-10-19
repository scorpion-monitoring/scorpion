// The rows of a KPI set as the editor holds them, and the choices of the evaluation. Pure: every rule is a
// table-driven test. The server judges the list again (unknown indicator, a necessity that is not an active
// term, a headline outside the set).
export interface Row {
  indicatorId: string;
  name: string;
  necessity: string;
}

export interface PickedIndicator {
  id: string;
  name: string;
}

/** Adds an indicator with the default necessity; one that is already a row is left as it is. */
export function addRow(rows: readonly Row[], picked: PickedIndicator, necessity: string): Row[] {
  if (rows.some((row) => row.indicatorId === picked.id)) return [...rows];
  return [...rows, { indicatorId: picked.id, name: picked.name, necessity }];
}

export const removeRow = (rows: readonly Row[], indicatorId: string): Row[] =>
  rows.filter((row) => row.indicatorId !== indicatorId);

export const setNecessity = (rows: readonly Row[], indicatorId: string, necessity: string): Row[] =>
  rows.map((row) => (row.indicatorId === indicatorId ? { ...row, necessity } : row));

/** The body of `PUT /kpi/sets/{id}/indicators`. */
export const rowsBody = (rows: readonly Row[]) => ({
  indicators: rows.map(({ indicatorId, necessity }) => ({ indicatorId, necessity })),
});

/** Whether the draft differs from what is stored (same indicators with the same necessity, in any order). */
export function rowsChanged(draft: readonly Row[], stored: readonly Row[]): boolean {
  if (draft.length !== stored.length) return true;
  const was = new Map(stored.map((row) => [row.indicatorId, row.necessity]));
  return draft.some((row) => was.get(row.indicatorId) !== row.necessity);
}

/**
 * The aggregates the evaluation offers for a headline: those the value type allows and the vocabulary has active
 * (the headline's own, deactivated or not, stays so a form never changes it silently).
 */
export function aggregateChoices(
  allowed: readonly string[],
  terms: readonly { key: string; active: boolean }[],
  current?: string,
): string[] {
  return terms
    .filter((term) => allowed.includes(term.key) && (term.active || term.key === current))
    .map((term) => term.key);
}

/** The count per necessity in the order of the vocabulary, for the badges of the list; zero is left out. */
export function badgeCounts(
  counts: Readonly<Record<string, number>>,
  order: readonly string[],
): { key: string; count: number }[] {
  const known = order
    .filter((key) => (counts[key] ?? 0) > 0)
    .map((key) => ({ key, count: counts[key]! }));
  const rest = Object.keys(counts)
    .filter((key) => !order.includes(key) && counts[key]! > 0)
    .sort()
    .map((key) => ({ key, count: counts[key]! }));
  return [...known, ...rest];
}
