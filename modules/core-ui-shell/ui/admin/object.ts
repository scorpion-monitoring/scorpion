/** The object without one key (a copy; the input is kept). */
export function omit<T extends Record<string, unknown>>(
  value: T,
  key: string,
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...value };
  delete copy[key];
  return copy;
}

/** The object with the part of `changed` laid over it: what a form that draws only some keys sends back. */
export function overlay(
  original: Record<string, unknown>,
  changed: Record<string, unknown>,
): Record<string, unknown> {
  return { ...original, ...changed };
}
