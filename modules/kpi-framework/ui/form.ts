// The indicator form as plain data: the state of the fields, the body the API takes, and the rules the page
// draws from the registry (a qualitative indicator is a `text` one without bounds; only a numeric type has
// bounds). The server judges everything again; this only keeps the form from offering what it will refuse.
export interface ValueTypeChoice {
  id: string;
  labels: { en: string; de?: string | undefined };
  numeric: boolean;
  range?: { min?: number | undefined; max?: number | undefined } | undefined;
  aggregates: readonly string[];
}

export interface IndicatorForm {
  name: string;
  description: string;
  example: string;
  qualitative: boolean;
  valueType: string;
  unit: string;
  min: string;
  max: string;
  thematic: string;
  measuredBy: string[];
  canBeAutomatedBy: string[];
}

export interface StoredIndicator {
  name: string;
  description: string | null;
  example: string | null;
  qualitative: boolean;
  valueType: string;
  unit: string | null;
  min: number | null;
  max: number | null;
  thematic: string;
  measuredBy: readonly string[];
  canBeAutomatedBy: readonly string[];
}

export const emptyForm = (valueType = '', thematic = ''): IndicatorForm => ({
  name: '',
  description: '',
  example: '',
  qualitative: false,
  valueType,
  unit: '',
  min: '',
  max: '',
  thematic,
  measuredBy: [],
  canBeAutomatedBy: [],
});

export const formFromIndicator = (stored: StoredIndicator): IndicatorForm => ({
  name: stored.name,
  description: stored.description ?? '',
  example: stored.example ?? '',
  qualitative: stored.qualitative,
  valueType: stored.valueType,
  unit: stored.unit ?? '',
  min: stored.min === null ? '' : String(stored.min),
  max: stored.max === null ? '' : String(stored.max),
  thematic: stored.thematic,
  measuredBy: [...stored.measuredBy],
  canBeAutomatedBy: [...stored.canBeAutomatedBy],
});

/** The one value type a qualitative indicator may have (Decision 11); the form fixes it. */
export const QUALITATIVE_TYPE = 'text';

/** A bound as typed: `null` for an empty box, `undefined` for text that is not a number. */
export function parseBound(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/** Whether the form draws the bounds: a numeric type, and not a qualitative indicator. */
export const showsBounds = (form: IndicatorForm, types: readonly ValueTypeChoice[]) =>
  !form.qualitative && (types.find((type) => type.id === form.valueType)?.numeric ?? false);

/** The body of `POST` and `PUT /kpi/indicators`, or the fields whose text is not a number. */
export function bodyFromForm(
  form: IndicatorForm,
  types: readonly ValueTypeChoice[],
): { body: Record<string, unknown> } | { invalid: ('min' | 'max')[] } {
  const bounds = showsBounds(form, types);
  const min = bounds ? parseBound(form.min) : null;
  const max = bounds ? parseBound(form.max) : null;
  const invalid = [min === undefined && 'min', max === undefined && 'max'].filter(Boolean) as (
    'min' | 'max'
  )[];
  if (invalid.length > 0) return { invalid };
  return {
    body: {
      name: form.name,
      description: form.description,
      example: form.example,
      qualitative: form.qualitative,
      valueType: form.qualitative ? QUALITATIVE_TYPE : form.valueType,
      unit: form.unit || null,
      min,
      max,
      thematic: form.thematic,
      measuredBy: form.measuredBy,
      canBeAutomatedBy: form.canBeAutomatedBy,
    },
  };
}
