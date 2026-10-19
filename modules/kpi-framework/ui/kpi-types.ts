// What the list of a service's KPIs knows of an indicator that the person added or that the service stores.
export interface Known {
  indicatorId: string;
  name: string;
  unit: string | null;
}

/** The value of the wizard's field: the KPI set (or none) and the ids of the extras. */
export interface KpisValue {
  setId: string | null;
  extras: string[];
}

/** Reads the form's value for the field, which may be absent or (in the JSON console) anything. */
export function kpisValue(value: unknown): KpisValue {
  if (typeof value !== 'object' || value === null) return { setId: null, extras: [] };
  const { setId, extras } = value as { setId?: unknown; extras?: unknown };
  return {
    setId: typeof setId === 'string' ? setId : null,
    extras: Array.isArray(extras)
      ? extras.filter((id): id is string => typeof id === 'string')
      : [],
  };
}
