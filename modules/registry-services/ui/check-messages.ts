// The words for what the browser's check found: a rule of the step's JSON Schema (`SchemaIssue`) becomes a
// sentence of the catalogue, in the person's language, on the field the pointer names. The server's own
// sentences are English and for developers; these are what a person reads before the request. Pure: `t` is
// handed in.
import type { SchemaIssue } from '@scorpion/ui-kit/json-schema';
import type { WizardField, WizardStep } from './wizard-types.ts';

type T = (key: string, params?: Record<string, string | number>) => string;

/** The field a pointer belongs to: the one at the pointer, or the list the pointer is an item of. */
export function fieldOfPointer(
  steps: readonly WizardStep[],
  pointer: string,
): WizardField | undefined {
  return steps
    .flatMap((step) => step.fields)
    .find((field) => pointer === field.path || pointer.startsWith(`${field.path}/`));
}

const FORMATS_WITH_A_WORD = new Set(['slug', 'url', 'email']);

/** The sentence for one failed rule. */
export function issueMessage(issue: SchemaIssue, field: WizardField | undefined, t: T): string {
  const limit = issue.limit ?? 0;
  switch (issue.keyword) {
    case 'required':
      return t('services.check.required');
    case 'minLength':
      return t('services.check.required');
    case 'maxLength':
      return t('services.check.maxLength', { limit });
    case 'maxItems':
      return t('services.check.maxItems', { limit });
    case 'pattern': {
      const format = field?.config.format;
      return typeof format === 'string' && FORMATS_WITH_A_WORD.has(format)
        ? t(`services.check.pattern.${format}`)
        : t('services.check.pattern');
    }
    case 'uniqueItems':
      return t('services.check.uniqueItems');
    case 'dependentRequired':
      return t('services.check.dependentRequired');
    case 'additionalProperties':
      return t('services.check.unknown');
    case 'enum':
      return t('services.check.enum');
    case 'unsupported':
      return t('services.check.unsupported');
    default:
      return t('services.check.invalid');
  }
}

/** The sentences by pointer for a list of issues (a pointer may have several). */
export function errorMap(
  issues: readonly SchemaIssue[],
  steps: readonly WizardStep[],
  t: T,
): Map<string, string[]> {
  const byPointer = new Map<string, string[]>();
  for (const issue of issues) {
    const message = issueMessage(issue, fieldOfPointer(steps, issue.pointer), t);
    const known = byPointer.get(issue.pointer) ?? [];
    if (!known.includes(message)) byPointer.set(issue.pointer, [...known, message]);
  }
  return byPointer;
}
