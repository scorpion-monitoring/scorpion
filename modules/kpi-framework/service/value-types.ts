// The registry `kpi.valueType` and its five entries (integer, float, text, duration, percentage). An indicator
// names one by key; `kpi.ingestion` (M10) parses a submitted value with `parse`, `kpi.analytics` (M11) aggregates
// with `aggregates` and shows with `format`. Another module adds a type by contributing an entry; nothing here
// branches on a type's id (CLAUDE.md rule 7). All of it is pure.
import { z } from '@scorpion/contracts';

export const VALUE_TYPE_REGISTRY = 'kpi.valueType';

/** The optional bounds of an indicator; only a numeric type may have them. */
export interface ValueTypeConfig {
  min?: number | null;
  max?: number | null;
}

/** What `parse` answers: the canonical value, or the reason the input is not a value of the type. */
export type ParseResult<T = unknown> = { ok: true; value: T } | { ok: false; problem: string };

const key = z
  .string()
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'must be a lower-case key')
  .max(32);
const labelSchema = z.string().min(1).max(100);
const fn = <T>() =>
  z.custom<T>((value) => typeof value === 'function', { message: 'expected a function' });

/**
 * One value type. `parse` turns what a form, a spreadsheet or the API gives into the canonical value (a number
 * or a string) or says why not; `schema(config)` is the same check as a Zod schema with the indicator's bounds
 * (the canonical value is its output); `format` writes a canonical value for people and for CSV; `aggregates`
 * are the keys of the `aggregate` vocabulary that make sense for the type; `numeric` says that the type has an
 * order, so the indicator may have `min` and `max`.
 */
export const valueTypeEntrySchema = z.strictObject({
  id: key,
  labels: z.strictObject({ en: labelSchema, de: labelSchema.optional() }),
  numeric: z.boolean(),
  /** The range the type allows by itself (a percentage is 0 to 100); an indicator's bounds lie inside it. */
  range: z.strictObject({ min: z.number().optional(), max: z.number().optional() }).optional(),
  aggregates: z.array(z.string().min(1).max(64)).max(20),
  parse: fn<(input: unknown) => ParseResult>(),
  format: fn<(value: unknown) => string>(),
  schema: fn<(config?: ValueTypeConfig) => z.ZodType>(),
});
export type ValueTypeEntry = z.output<typeof valueTypeEntrySchema>;

// ----- the pure parsers -----------------------------------------------------------------------------

const INTEGER_TEXT = /^[+-]?\d{1,15}$/;
const DECIMAL_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const MAX_TEXT_LENGTH = 4000;
/** `HH-MM-SS`: hours 0 to 9999, minutes and seconds 00 to 59, always two digits for the last two. */
const DURATION_TEXT = /^(\d{1,4})-([0-5]\d)-([0-5]\d)$/;

const ok = <T>(value: T): ParseResult<T> => ({ ok: true, value });
const bad = (problem: string): ParseResult<never> => ({ ok: false, problem });

export function parseInteger(input: unknown): ParseResult<number> {
  if (typeof input === 'number') {
    return Number.isSafeInteger(input) ? ok(input) : bad('must be a whole number');
  }
  if (typeof input === 'string') {
    const text = input.trim();
    if (!INTEGER_TEXT.test(text)) return bad('must be a whole number');
    const value = Number(text);
    return Number.isSafeInteger(value)
      ? ok(value === 0 ? 0 : value)
      : bad('must be a whole number');
  }
  return bad('must be a whole number');
}

export function parseFloatValue(input: unknown): ParseResult<number> {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? ok(input === 0 ? 0 : input) : bad('must be a finite number');
  }
  if (typeof input === 'string') {
    const text = input.trim();
    if (!DECIMAL_TEXT.test(text)) return bad('must be a number');
    const value = Number(text);
    return Number.isFinite(value) ? ok(value === 0 ? 0 : value) : bad('must be a finite number');
  }
  return bad('must be a number');
}

export function parseText(input: unknown): ParseResult<string> {
  if (typeof input !== 'string') return bad('must be text');
  const text = input.trim();
  if (text === '') return bad('must not be empty');
  if (text.length > MAX_TEXT_LENGTH) return bad(`must be at most ${MAX_TEXT_LENGTH} characters`);
  return ok(text);
}

/** `HH-MM-SS` (or a whole number of seconds) to seconds. */
export function parseDuration(input: unknown): ParseResult<number> {
  if (typeof input === 'number') {
    return Number.isSafeInteger(input) && input >= 0
      ? ok(input)
      : bad('must be a number of seconds');
  }
  if (typeof input === 'string') {
    const match = DURATION_TEXT.exec(input.trim());
    if (!match) return bad('must be of the form HH-MM-SS');
    return ok(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
  }
  return bad('must be of the form HH-MM-SS');
}

/** A number from 0 to 100, with a fraction allowed. */
export function parsePercentage(input: unknown): ParseResult<number> {
  const parsed = parseFloatValue(input);
  if (!parsed.ok) return parsed;
  return parsed.value >= 0 && parsed.value <= 100 ? parsed : bad('must be between 0 and 100');
}

/** Seconds to `HH-MM-SS` (hours are not capped at 99). */
export function formatDuration(seconds: unknown): string {
  if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds < 0)
    throw new RangeError('a duration is a non-negative whole number of seconds');
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}-${String(m).padStart(2, '0')}-${String(s).padStart(2, '0')}`;
}

const formatNumber = (value: unknown): string => {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new RangeError('a number was expected');
  return String(value);
};
const formatText = (value: unknown): string => {
  if (typeof value !== 'string') throw new RangeError('text was expected');
  return value;
};

// ----- bounds -----------------------------------------------------------------------------------------

/** A Zod schema for a numeric type: the type's parser, then the type's range, then the indicator's bounds. */
function numericSchema(
  parse: (input: unknown) => ParseResult<number>,
  config: ValueTypeConfig = {},
): z.ZodType {
  const { min, max } = config;
  return z.unknown().transform((input, ctx) => {
    const parsed = parse(input);
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: parsed.problem });
      return z.NEVER;
    }
    if (typeof min === 'number' && parsed.value < min) {
      ctx.addIssue({ code: 'custom', message: `must be at least ${min}` });
      return z.NEVER;
    }
    if (typeof max === 'number' && parsed.value > max) {
      ctx.addIssue({ code: 'custom', message: `must be at most ${max}` });
      return z.NEVER;
    }
    return parsed.value;
  });
}

function textSchema(): z.ZodType {
  return z.unknown().transform((input, ctx) => {
    const parsed = parseText(input);
    if (!parsed.ok) {
      ctx.addIssue({ code: 'custom', message: parsed.problem });
      return z.NEVER;
    }
    return parsed.value;
  });
}

/**
 * Whether an indicator's `min` and `max` fit its value type: only a numeric type has bounds, `min` does not
 * exceed `max`, and a bound lies in the range the type allows (a percentage in 0 to 100). Returns the problem
 * and the field it belongs to, or `undefined`.
 */
export function boundsProblem(
  type: Pick<ValueTypeEntry, 'id' | 'numeric' | 'range'>,
  config: ValueTypeConfig,
): { field: 'min' | 'max'; problem: string } | undefined {
  const { min, max } = config;
  const range = type.range ?? {};
  const has = (value: number | null | undefined): value is number =>
    value !== null && value !== undefined;
  if (!type.numeric) {
    if (has(min)) return { field: 'min', problem: `a ${type.id} indicator has no bounds` };
    if (has(max)) return { field: 'max', problem: `a ${type.id} indicator has no bounds` };
    return undefined;
  }
  for (const [field, value] of [
    ['min', min],
    ['max', max],
  ] as const) {
    if (!has(value)) continue;
    if (!Number.isFinite(value)) return { field, problem: 'must be a finite number' };
    if (range.min !== undefined && value < range.min)
      return { field, problem: `must be at least ${range.min}` };
    if (range.max !== undefined && value > range.max)
      return { field, problem: `must be at most ${range.max}` };
  }
  if (has(min) && has(max) && min > max) return { field: 'min', problem: 'must not exceed max' };
  return undefined;
}

// ----- the entries ------------------------------------------------------------------------------------

/** `sum` of percentages means nothing, and text has no aggregate (an indicator without an order cannot be a headline). */
const ALL_AGGREGATES = ['sum', 'avg', 'min', 'max'];

export const SEED_VALUE_TYPES: ValueTypeEntry[] = [
  {
    id: 'integer',
    labels: { en: 'Whole number', de: 'Ganze Zahl' },
    numeric: true,
    aggregates: ALL_AGGREGATES,
    parse: parseInteger,
    format: formatNumber,
    schema: (config) => numericSchema(parseInteger, config),
  },
  {
    id: 'float',
    labels: { en: 'Decimal number', de: 'Dezimalzahl' },
    numeric: true,
    aggregates: ALL_AGGREGATES,
    parse: parseFloatValue,
    format: formatNumber,
    schema: (config) => numericSchema(parseFloatValue, config),
  },
  {
    id: 'text',
    labels: { en: 'Text', de: 'Text' },
    numeric: false,
    aggregates: [],
    parse: parseText,
    format: formatText,
    schema: () => textSchema(),
  },
  {
    id: 'duration',
    labels: { en: 'Duration (HH-MM-SS)', de: 'Dauer (HH-MM-SS)' },
    numeric: true,
    range: { min: 0 },
    aggregates: ALL_AGGREGATES,
    parse: parseDuration,
    format: formatDuration,
    schema: (config) => numericSchema(parseDuration, config),
  },
  {
    id: 'percentage',
    labels: { en: 'Percentage', de: 'Prozentwert' },
    numeric: true,
    range: { min: 0, max: 100 },
    aggregates: ['avg', 'min', 'max'],
    parse: parsePercentage,
    format: formatNumber,
    schema: (config) => numericSchema(parsePercentage, config),
  },
];

/** Whether an indicator may have this value type when it is qualitative (Decision 11): only `text`. */
export const QUALITATIVE_VALUE_TYPE = 'text';
