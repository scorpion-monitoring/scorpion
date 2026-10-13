// What `SchemaField` draws for one field of the schema the server sent: the field's JSON Schema, found at its
// pointer in the step's schema, with the label, the help and the widget of the field on it. Shared by the wizard
// and the edit form of the service page, so a field looks and limits itself the same in both. Pure.
import { describeField, type FieldNode, type JsonSchema } from '@scorpion/ui-kit/schema-form';
import type { WizardField, WizardStep } from './wizard-types.ts';

/** The JSON Schema of one field, found at its pointer in the step's schema. */
export function propertyOf(step: Pick<WizardStep, 'schema'>, field: WizardField): JsonSchema {
  let node: unknown = step.schema;
  for (const segment of field.path.slice(1).split('/')) {
    const properties = (node as { properties?: Record<string, unknown> }).properties;
    node = properties?.[segment];
  }
  return (node ?? { type: 'string' }) as JsonSchema;
}

/**
 * The form draws a string as a box of several lines when its limit is long. Only the `description` format is
 * written in paragraphs; a web address or a name is one line whatever its limit, so the limit is left to the
 * check (the step's schema) and not to the control.
 */
export function oneLine(schema: JsonSchema, field: WizardField): JsonSchema {
  const long = typeof schema.maxLength === 'number' && schema.maxLength > 300;
  if (!long || field.config.format === 'description') return schema;
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== 'maxLength'));
}

/** The node of one field, with its texts in the person's language (`t` is handed in). */
export function fieldNode(
  step: Pick<WizardStep, 'schema'>,
  field: WizardField,
  t: (key: string) => string,
): FieldNode {
  const property = oneLine(propertyOf(step, field), field);
  const items = property.items;
  const decorated: JsonSchema = {
    ...property,
    ...(typeof items === 'object' &&
      items !== null && {
        items: oneLine(items as JsonSchema, field),
      }),
    title: t(field.label),
    ...(field.help !== undefined && { description: t(field.help) }),
    widget: field.widget,
  };
  return describeField(decorated, decorated, {
    pointer: field.path,
    key: field.path.slice(field.path.lastIndexOf('/') + 1),
    required: field.required,
  });
}
