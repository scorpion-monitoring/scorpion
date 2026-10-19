// The shape of the two configuration files, `config/fields.ts` and `config/steps.ts` (ADR-0035): typed
// TypeScript, the successors of the legacy `service_schema.json` and `steps.json`. The validator
// (`validate.ts`) checks them again at start, so a file that bypasses the types (a cast, a generated file)
// still cannot start the server with a broken wizard.
import { z } from '@scorpion/contracts';
import {
  fieldConfigSchema,
  messageKey,
  showIfSchema,
  type FieldConfig,
} from '../service/registries.ts';

export type { FieldConfig };
export { fieldConfigSchema };

/** One step of the wizard, in the order of `order`. A step lists the keys of its fields, or names a `component`. */
export const stepConfigSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'must be a lower-case key')
    .max(32),
  order: z.number().int().min(0).max(100_000),
  /** The message key of the step's title. */
  title: messageKey,
  /** Message keys of the paragraphs above the fields (the legacy `texts`). */
  intro: z.array(messageKey).max(10).optional(),
  /** Keys of fields of `config/fields.ts`. */
  fields: z.array(z.string().min(1).max(64)).max(50).optional(),
  /** The name of a UI component for a step that is not a list of fields. */
  component: z.string().min(1).max(64).optional(),
  /** Shown only when the condition holds (ADR-0040 addendum); the fields of a hidden step are not required. */
  showIf: showIfSchema.optional(),
});
export type StepConfig = z.output<typeof stepConfigSchema>;

export interface ServicesConfig {
  steps: readonly StepConfig[];
  fields: readonly FieldConfig[];
}
