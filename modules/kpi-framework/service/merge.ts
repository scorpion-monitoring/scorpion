// The rule of the effective KPI set, pure and without imports: the browser draws the same list the server answers
// with (the wizard shows it before the service exists), so it lives apart from the queries of `effective.ts`.

export const EXTRA_NECESSITY = 'optional';

export interface NamedIndicator {
  indicatorId: string;
  name: string;
}

export type EffectiveRow<T extends NamedIndicator> = T & {
  necessity: string;
  /** Where the row comes from: the KPI set or the service's own choice. */
  source: 'set' | 'extra';
};

/** By name without case, then name, then id: the order of every list of indicators in this module. */
export function compareIndicators(a: NamedIndicator, b: NamedIndicator): number {
  const left = a.name.toLowerCase();
  const right = b.name.toLowerCase();
  return left < right
    ? -1
    : left > right
      ? 1
      : a.name < b.name
        ? -1
        : a.name > b.name
          ? 1
          : a.indicatorId < b.indicatorId
            ? -1
            : a.indicatorId > b.indicatorId
              ? 1
              : 0;
}

/**
 * The rule. `setRows` are the set's rows (each with its necessity), `extras` the indicators the service chose.
 * A row of the set wins over an extra of the same indicator (the extra is dropped, not the row), an indicator
 * listed twice counts once, and the result does not depend on the order of the input.
 */
export function mergeEffective<
  S extends NamedIndicator & { necessity: string },
  E extends NamedIndicator,
>(setRows: readonly S[], extras: readonly E[]): (EffectiveRow<S> | EffectiveRow<E>)[] {
  const taken = new Set<string>();
  const fromSet: EffectiveRow<S>[] = [];
  for (const row of [...setRows].sort(compareIndicators)) {
    if (taken.has(row.indicatorId)) continue;
    taken.add(row.indicatorId);
    fromSet.push({ ...row, source: 'set' });
  }
  const fromExtras: EffectiveRow<E>[] = [];
  for (const row of [...extras].sort(compareIndicators)) {
    if (taken.has(row.indicatorId)) continue;
    taken.add(row.indicatorId);
    fromExtras.push({ ...row, necessity: EXTRA_NECESSITY, source: 'extra' });
  }
  return [...fromSet, ...fromExtras];
}
