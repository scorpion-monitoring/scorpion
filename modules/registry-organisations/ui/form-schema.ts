// The JSON Schema of the organisation form, for ui-kit's `SchemaForm`. The server judges every value; this
// only says which fields to draw, in which order, with which limits shown as help. The limits are the ones
// of `service/fields.ts` (`form-schema.test.ts` fails when they drift apart), and every text comes from
// the message catalogue.
import type { Translate } from '@scorpion/ui-kit';

/** The limits of the fields, as help text. Kept equal to `service/fields.ts` by a test. */
export const FORM_LIMITS = {
  sameAs: 20,
  url: 500,
  description: 4000,
  name: 200,
  abbreviation: 64,
  email: 254,
  contactType: 64,
} as const;

/** The field groups of the API (`editableFields`), of which the form draws the ones the caller may write. */
export type FormField =
  | 'type'
  | 'abbreviation'
  | 'name'
  | 'description'
  | 'website'
  | 'sameAs'
  | 'rorId'
  | 'logo'
  | 'contact';

export type FormMode = 'create' | 'edit';

type Schema = Record<string, unknown>;

/** The ROR pattern shown as help, `02skbsp27`. */
export const ROR_EXAMPLE = '02skbsp27';

/**
 * The form for the fields in `fields` (the logo is a block of its own, not a field of the form). A field
 * the caller may not write is not in the schema at all, so a manager's form has no `name` to edit; the page
 * shows the identity fields as read-only text beside it.
 */
export function organisationFormSchema(options: {
  t: Translate;
  fields: readonly FormField[];
  mode: FormMode;
}): Schema {
  const { t, fields, mode } = options;
  const has = (field: FormField) => fields.includes(field);
  const group = (name: 'identity' | 'profile' | 'contact') => t(`organisation.form.group.${name}`);
  const properties: Record<string, Schema> = {};

  if (has('type')) {
    properties.type = {
      type: 'string',
      title: t('organisation.form.type'),
      description: t('organisation.form.type.help'),
      widget: 'orgType',
      group: group('identity'),
      order: 10,
    };
  }
  if (has('abbreviation')) {
    properties.abbreviation = {
      type: 'string',
      title: t('organisation.form.abbreviation'),
      description: t('organisation.form.abbreviation.help', { max: FORM_LIMITS.abbreviation }),
      maxLength: FORM_LIMITS.abbreviation,
      group: group('identity'),
      order: 20,
    };
  }
  if (has('name')) {
    properties.name = {
      type: 'string',
      title: t('organisation.form.name'),
      description: t('organisation.form.name.help', { max: FORM_LIMITS.name }),
      maxLength: FORM_LIMITS.name,
      group: group('identity'),
      order: 30,
    };
  }
  if (has('description')) {
    properties.description = {
      type: 'string',
      format: 'textarea',
      title: t('organisation.form.description'),
      description: t('organisation.form.description.help', { max: FORM_LIMITS.description }),
      maxLength: FORM_LIMITS.description,
      group: group('profile'),
      order: 40,
    };
  }
  if (has('website')) {
    properties.website = {
      type: 'string',
      format: 'uri',
      title: t('organisation.form.website'),
      description: t('organisation.form.website.help'),
      maxLength: FORM_LIMITS.url,
      group: group('profile'),
      order: 50,
    };
  }
  if (has('rorId')) {
    properties.rorId = {
      type: 'string',
      title: t('organisation.form.rorId'),
      description: t('organisation.form.rorId.help', { example: ROR_EXAMPLE }),
      widget: 'ror',
      group: group('profile'),
      order: 60,
    };
  }
  if (has('sameAs')) {
    properties.sameAs = {
      type: 'array',
      title: t('organisation.form.sameAs'),
      description: t('organisation.form.sameAs.help', { max: FORM_LIMITS.sameAs }),
      maxItems: FORM_LIMITS.sameAs,
      items: { type: 'string', format: 'uri', maxLength: FORM_LIMITS.url },
      group: group('profile'),
      order: 70,
    };
  }
  if (has('contact')) {
    properties.contactEmail = {
      type: 'string',
      format: 'email',
      title: t('organisation.form.contactEmail'),
      // "A shared address, not a person's": the same text for an administrator and for a manager.
      description: t('organisation.form.contactEmail.help', { max: FORM_LIMITS.email }),
      maxLength: FORM_LIMITS.email,
      group: group('contact'),
      order: 80,
    };
    properties.contactType = {
      type: 'string',
      title: t('organisation.form.contactType'),
      description: t('organisation.form.contactType.help', { max: FORM_LIMITS.contactType }),
      maxLength: FORM_LIMITS.contactType,
      group: group('contact'),
      order: 90,
    };
  }

  const required =
    mode === 'create'
      ? (['type', 'abbreviation', 'name'] as const).filter((field) => has(field))
      : [];
  return { type: 'object', properties, required, additionalProperties: false };
}

/** The form fields a list of API fields draws (`contact` is two inputs, `logo` none). */
export const FORM_KEYS: Record<FormField, readonly string[]> = {
  type: ['type'],
  abbreviation: ['abbreviation'],
  name: ['name'],
  description: ['description'],
  website: ['website'],
  sameAs: ['sameAs'],
  rorId: ['rorId'],
  logo: [],
  contact: ['contactEmail', 'contactType'],
};
