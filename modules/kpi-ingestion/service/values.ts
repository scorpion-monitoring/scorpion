// A value in its table: the registry `kpi.valueType` says whether a type is numeric, and a value is stored in its canonical
// form (a duration as seconds): a numeric type in `value_numeric`, any other in `value_text`; exactly one of the two is set
// (a check constraint says so). Pure. These two functions are the only place that knows the mapping, for the write
// (`upsertBatch`) and for the reads of sprint 2.
import type { ParseResult } from '@scorpion/kpi-framework/public';

/** The longest text a measurement holds (a check constraint says so; `parseText` enforces it too). */
export const MAX_TEXT_VALUE = 4000;

/** The two columns of a value; exactly one is not `null`. */
export interface ValueColumns {
  /** A decimal as text, exactly as Postgres reads it into a `numeric`. */
  valueNumeric: string | null;
  valueText: string | null;
}

/**
 * The columns for a canonical value (what `valueType.schema(config)` produces). A numeric type needs a finite number, any
 * other type a text of 1 to 4000 characters; a registry entry that returns the wrong kind, or too much, is a problem here
 * and never a failing insert.
 */
export function toColumns(numeric: boolean, canonical: unknown): ParseResult<ValueColumns> {
  if (numeric) {
    if (typeof canonical !== 'number' || !Number.isFinite(canonical))
      return { ok: false, problem: 'must be a finite number' };
    // `String(1e21)` is `1e+21`, which numeric reads; `-0` is `0`.
    return {
      ok: true,
      value: { valueNumeric: canonical === 0 ? '0' : String(canonical), valueText: null },
    };
  }
  if (typeof canonical !== 'string' || canonical.length === 0 || canonical.length > MAX_TEXT_VALUE)
    return { ok: false, problem: `must be text of 1 to ${MAX_TEXT_VALUE} characters` };
  return { ok: true, value: { valueNumeric: null, valueText: canonical } };
}

/** The canonical value of a stored row: a number for `value_numeric`, text for `value_text`. */
export function fromColumns(columns: ValueColumns): number | string {
  if (columns.valueNumeric !== null) return Number(columns.valueNumeric);
  if (columns.valueText !== null) return columns.valueText;
  throw new RangeError('a measurement has a numeric or a text value');
}

/** Whether two stored values are the same value (`numeric` compares by value, so `1.50` and `1.5` are equal). */
export function sameColumns(a: ValueColumns, b: ValueColumns): boolean {
  if (a.valueText !== null || b.valueText !== null) return a.valueText === b.valueText;
  return (
    a.valueNumeric !== null &&
    b.valueNumeric !== null &&
    Number(a.valueNumeric) === Number(b.valueNumeric)
  );
}
