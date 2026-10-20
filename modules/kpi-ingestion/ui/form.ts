// The report form as pure functions: the groups, the typed input a value type asks for (from the registry's data, never from a type's id), the
// check of a typed value before it is sent, the state of the form and what is sent. The server judges every value again; these only spare a
// person a round trip and say what is wanted.
import { MANDATORY_NECESSITY } from '../service/necessity.ts';
import type { GridRow, Problem, ValueType } from './types.ts';

/** The longest text a form value may have (the route's limit). */
export const MAX_VALUE_LENGTH = 4000;

export interface PositionedRow {
  row: GridRow;
  /** The place of the indicator in the grid, 1-based: the "column" the server names for a problem of a form. */
  position: number;
}

export interface Group {
  necessity: string;
  rows: PositionedRow[];
}

/** The rows by necessity, the groups in the order of the vocabulary (`order`), then any other key as it appears; rows keep the grid order. */
export function groupRows(rows: readonly GridRow[], order: readonly string[]): Group[] {
  const byKey = new Map<string, PositionedRow[]>();
  rows.forEach((row, index) => {
    const list = byKey.get(row.necessity) ?? [];
    list.push({ row, position: index + 1 });
    byKey.set(row.necessity, list);
  });
  const known = order.filter((key) => byKey.has(key));
  const rest = [...byKey.keys()].filter((key) => !order.includes(key));
  return [...known, ...rest].map((necessity) => ({ necessity, rows: byKey.get(necessity)! }));
}

export const isMandatory = (row: Pick<GridRow, 'necessity'>): boolean =>
  row.necessity === MANDATORY_NECESSITY;

/** How the input of one indicator looks and what it checks. */
export interface InputSpec {
  kind: 'number' | 'text';
  /** `1` for whole numbers, `'any'` for decimals; numbers only. */
  step: number | 'any' | undefined;
  /** The bounds of the indicator inside those of the type; numbers only. */
  min: number | undefined;
  max: number | undefined;
  /** What the whole text must match; text only. */
  pattern: RegExp | undefined;
  /** A format hint that is not language (`HH-MM-SS`). */
  hint: string | undefined;
  inputMode: 'numeric' | 'decimal' | 'text';
}

const tighter = (
  a: number | null | undefined,
  b: number | null | undefined,
  pick: 'min' | 'max',
) => {
  const values = [a, b].filter((value): value is number => typeof value === 'number');
  return values.length === 0 ? undefined : Math[pick](...values);
};

/**
 * The input of an indicator from the registry's data about its value type: its `input` descriptor, else a number input for a numeric type and
 * text for anything else (a type that says nothing still gets a usable field). The bounds are the indicator's inside the type's own range.
 */
export function inputSpec(
  type: Pick<ValueType, 'numeric' | 'range' | 'input'> | undefined,
  row: Pick<GridRow, 'min' | 'max'>,
): InputSpec {
  const input =
    type?.input ??
    (type?.numeric ? { kind: 'number' as const, step: 'any' as const } : { kind: 'text' as const });
  if (input.kind === 'number') {
    return {
      kind: 'number',
      step: input.step ?? 'any',
      min: tighter(row.min, type?.range?.min, 'max'),
      max: tighter(row.max, type?.range?.max, 'min'),
      pattern: undefined,
      hint: input.hint,
      inputMode: input.step === 1 ? 'numeric' : 'decimal',
    };
  }
  return {
    kind: 'text',
    step: undefined,
    min: undefined,
    max: undefined,
    pattern: input.pattern ? safePattern(input.pattern) : undefined,
    hint: input.hint,
    inputMode: 'text',
  };
}

function safePattern(source: string): RegExp | undefined {
  try {
    return new RegExp(source);
  } catch {
    return undefined;
  }
}

/** Why a typed value is not accepted; `bound` is the limit a `min` or `max` problem names. */
export interface ValueIssue {
  code: 'number' | 'integer' | 'min' | 'max' | 'pattern' | 'long';
  bound?: number;
}

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/** `undefined` when the text is fine or blank (blank is no value). `badInput` is true when a number input holds text it could not read. */
export function checkValue(
  spec: InputSpec,
  text: string,
  badInput = false,
): ValueIssue | undefined {
  const value = text.trim();
  if (spec.kind === 'number') {
    if (badInput) return { code: 'number' };
    if (value === '') return undefined;
    if (value.length > 400 || !DECIMAL.test(value)) return { code: 'number' };
    const number = Number(value);
    if (!Number.isFinite(number)) return { code: 'number' };
    if (spec.step === 1 && !Number.isInteger(number)) return { code: 'integer' };
    if (spec.min !== undefined && number < spec.min) return { code: 'min', bound: spec.min };
    if (spec.max !== undefined && number > spec.max) return { code: 'max', bound: spec.max };
    return undefined;
  }
  if (value === '') return undefined;
  if (value.length > MAX_VALUE_LENGTH) return { code: 'long' };
  if (spec.pattern && !spec.pattern.test(value)) return { code: 'pattern' };
  return undefined;
}

/** The text of every field for a month: the stored value, or blank. The grid carries the canonical text (a duration as `HH-MM-SS`). */
export function initialValues(rows: readonly GridRow[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.indicatorId, row.measurement?.value ?? '']));
}

const blank = (text: string | undefined) => (text ?? '').trim() === '';

/** The mandatory indicators that have no value yet. */
export function missingMandatory(
  rows: readonly GridRow[],
  values: Readonly<Record<string, string>>,
): GridRow[] {
  return rows.filter((row) => isMandatory(row) && blank(values[row.indicatorId]));
}

/** Whether anything is filled in. */
export const hasAnyValue = (values: Readonly<Record<string, string>>): boolean =>
  Object.values(values).some((text) => !blank(text));

/** What is sent: the filled-in values by indicator id, trimmed; a blank field is left out (it is "no value", never a value). */
export function valuesPayload(values: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, text] of Object.entries(values)) if (!blank(text)) out[id] = text.trim();
  return out;
}

/** Whether the form differs from what is stored: a field changed, or a stored value cleared. */
export function isDirty(
  rows: readonly GridRow[],
  values: Readonly<Record<string, string>>,
): boolean {
  const stored = initialValues(rows);
  return rows.some(
    (row) => (values[row.indicatorId] ?? '').trim() !== (stored[row.indicatorId] ?? '').trim(),
  );
}

/**
 * The server's problems of a form commit by indicator: for a form the "column" is the indicator's place in the grid (1-based), the row is 1.
 * A problem at column 0 (the form as a whole) is returned under `general`.
 */
export function problemsByIndicator(
  problems: readonly Problem[],
  rows: readonly GridRow[],
): { byIndicator: Map<string, Problem[]>; general: Problem[] } {
  const byIndicator = new Map<string, Problem[]>();
  const general: Problem[] = [];
  for (const problem of problems) {
    const row = problem.column >= 1 ? rows[problem.column - 1] : undefined;
    if (!row) {
      general.push(problem);
      continue;
    }
    byIndicator.set(row.indicatorId, [...(byIndicator.get(row.indicatorId) ?? []), problem]);
  }
  return { byIndicator, general };
}
