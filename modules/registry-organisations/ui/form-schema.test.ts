// The form schema and the fields of the API: what the form offers is what the field-rules table lets the
// caller write, and its limits are the ones of `service/fields.ts`.
import { createTranslator } from '@scorpion/ui-kit/i18n';
import { describe, expect, it } from 'vitest';
import { ADMIN_FIELDS, EDITOR_FIELDS, editableFields } from '../service/field-rules.ts';
import {
  MAX_ABBREVIATION_LENGTH,
  MAX_CONTACT_TYPE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_SAME_AS,
  MAX_URL_LENGTH,
} from '../service/fields.ts';
import { FORM_KEYS, FORM_LIMITS, organisationFormSchema, type FormField } from './form-schema.ts';
import { messages } from './messages.ts';

const t = createTranslator({ en: messages.en!, de: messages.de! }, 'en');
const schemaFor = (fields: readonly FormField[], mode: 'create' | 'edit' = 'edit') =>
  organisationFormSchema({ t, fields, mode }) as {
    properties: Record<string, Record<string, unknown>>;
    required: string[];
  };

describe('the form schema', () => {
  it('has the limits of service/fields.ts', () => {
    expect(FORM_LIMITS).toEqual({
      sameAs: MAX_SAME_AS,
      url: MAX_URL_LENGTH,
      description: MAX_DESCRIPTION_LENGTH,
      name: MAX_NAME_LENGTH,
      abbreviation: MAX_ABBREVIATION_LENGTH,
      email: MAX_EMAIL_LENGTH,
      contactType: MAX_CONTACT_TYPE_LENGTH,
    });
    const all = schemaFor([...ADMIN_FIELDS, ...EDITOR_FIELDS]).properties;
    expect(all.abbreviation!.maxLength).toBe(MAX_ABBREVIATION_LENGTH);
    expect(all.name!.maxLength).toBe(MAX_NAME_LENGTH);
    expect(all.description!.maxLength).toBe(MAX_DESCRIPTION_LENGTH);
    expect(all.website!.maxLength).toBe(MAX_URL_LENGTH);
    expect(all.sameAs!.maxItems).toBe(MAX_SAME_AS);
    expect((all.sameAs!.items as { maxLength: number }).maxLength).toBe(MAX_URL_LENGTH);
    expect(all.contactEmail!.maxLength).toBe(MAX_EMAIL_LENGTH);
    expect(all.contactType!.maxLength).toBe(MAX_CONTACT_TYPE_LENGTH);
  });

  it('draws exactly the fields an administrator may write', () => {
    const drawn = Object.keys(schemaFor(editableFields('admin')).properties).sort();
    expect(drawn).toEqual(
      [
        'type',
        'abbreviation',
        'name',
        'description',
        'website',
        'sameAs',
        'rorId',
        'contactEmail',
        'contactType',
      ].sort(),
    );
  });

  it('draws none of the identity fields for a manager, and the contact point as its two inputs', () => {
    const drawn = Object.keys(schemaFor(editableFields('edit')).properties).sort();
    expect(drawn).toEqual(
      ['description', 'website', 'sameAs', 'rorId', 'contactEmail', 'contactType'].sort(),
    );
    for (const field of ADMIN_FIELDS) expect(drawn).not.toContain(field);
  });

  it('draws nothing for a caller who may write nothing', () => {
    expect(schemaFor(editableFields(null)).properties).toEqual({});
  });

  it('maps every field of the API to the inputs it draws, and the logo to none (it has its own block)', () => {
    expect(Object.keys(FORM_KEYS).sort()).toEqual([...ADMIN_FIELDS, ...EDITOR_FIELDS].sort());
    expect(FORM_KEYS.logo).toEqual([]);
    for (const field of Object.keys(FORM_KEYS) as FormField[]) {
      const drawn = Object.keys(schemaFor([field]).properties).sort();
      expect(drawn, field).toEqual([...FORM_KEYS[field]].sort());
    }
  });

  it('requires type, abbreviation and name when creating, and nothing when editing', () => {
    expect(schemaFor(editableFields('admin'), 'create').required).toEqual([
      'type',
      'abbreviation',
      'name',
    ]);
    expect(schemaFor(editableFields('admin'), 'edit').required).toEqual([]);
  });

  it('asks for the custom controls of the type and the ROR id, and a text area for the description', () => {
    const { properties } = schemaFor(editableFields('admin'));
    expect(properties.type!.widget).toBe('orgType');
    expect(properties.rorId!.widget).toBe('ror');
    expect(properties.description!.format).toBe('textarea');
    expect(properties.type).not.toHaveProperty('enum'); // the options come from the registry, not from here
  });

  it('shows the limit of the links and the shared-address note as help, in both languages', () => {
    for (const locale of ['en', 'de'] as const) {
      const translate = createTranslator({ en: messages.en!, de: messages.de! }, locale);
      const { properties } = organisationFormSchema({
        t: translate,
        fields: editableFields('admin'),
        mode: 'edit',
      }) as { properties: Record<string, { description: string }> };
      expect(properties.sameAs!.description).toContain(String(MAX_SAME_AS));
      expect(properties.contactEmail!.description).toMatch(/info@/);
      expect(properties.rorId!.description).toContain('02skbsp27');
    }
  });
});
