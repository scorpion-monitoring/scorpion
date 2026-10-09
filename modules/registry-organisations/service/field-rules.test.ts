// The field-rules table: every field of an organisation and every set of fields maps to the access it
// needs (ADR-0033, Decision 14). A field that is added without a rule fails here.
import { describe, expect, it } from 'vitest';
import {
  adminFieldsOf,
  ADMIN_FIELDS,
  allows,
  editableFields,
  EDITOR_FIELDS,
  fieldsOfBody,
  fieldsOfInput,
  requiredAccess,
  type Access,
  type AccessLevel,
  type OrganisationField,
} from './field-rules.ts';
import { createOrganisationSchema, updateOrganisationSchema } from './input.ts';

describe('requiredAccess', () => {
  it.each(ADMIN_FIELDS)('%s needs admin', (field) => {
    expect(requiredAccess([field])).toBe('admin');
  });

  it.each(EDITOR_FIELDS)('%s needs edit', (field) => {
    expect(requiredAccess([field])).toBe('edit');
  });

  it.each<[OrganisationField[], 'admin' | 'edit']>([
    [[], 'edit'],
    [['description', 'website'], 'edit'],
    [['description', 'name'], 'admin'],
    [['logo', 'contact', 'sameAs', 'rorId'], 'edit'],
    [['type', 'abbreviation', 'name'], 'admin'],
    [['description', 'type'], 'admin'],
  ])('%j needs %s', (fields, access) => {
    expect(requiredAccess(fields)).toBe(access);
  });

  it('has no field in both groups', () => {
    expect(ADMIN_FIELDS.filter((f) => (EDITOR_FIELDS as readonly string[]).includes(f))).toEqual(
      [],
    );
  });
});

describe('fieldsOfBody', () => {
  it('groups contactEmail and contactType as one field and ignores undefined', () => {
    expect(
      fieldsOfBody({
        contactEmail: 'a@b.org',
        contactType: 'x',
        name: 'n',
        website: undefined,
      }).sort(),
    ).toEqual(['contact', 'name']);
  });

  it('maps every key of the create and update schemas to a field', () => {
    for (const schema of [createOrganisationSchema, updateOrganisationSchema]) {
      // The schemas are refined; the keys are on the inner object.
      const shape = (schema as unknown as { def: { in?: { shape: object }; shape?: object } }).def;
      const keys = Object.keys((shape.in?.shape ?? shape.shape) as object);
      expect(keys.length).toBeGreaterThan(5);
      expect(() => fieldsOfBody(Object.fromEntries(keys.map((key) => [key, 1])))).not.toThrow();
    }
  });

  it('throws for a key that is no field, so a new column cannot skip the table', () => {
    expect(() => fieldsOfBody({ colour: 'red' })).toThrow(/not a field/);
  });
});

describe('fieldsOfInput (before the input is parsed)', () => {
  it.each<[unknown, OrganisationField[]]>([
    [null, []],
    ['x', []],
    [[], []],
    [{ colour: 'red' }, []],
    [{ colour: 'red', name: 'x' }, ['name']],
    [{ contactType: 'x', description: 'y' }, ['contact', 'description']],
  ])('%j → %j', (input, expected) => {
    expect(fieldsOfInput(input).sort()).toEqual([...expected].sort());
  });
});

describe('allows: what a caller holds against what a change needs', () => {
  it.each<[AccessLevel, Access, boolean]>([
    ['admin', 'admin', true],
    ['admin', 'edit', true],
    ['edit', 'edit', true],
    ['edit', 'admin', false],
    [null, 'edit', false],
    [null, 'admin', false],
  ])('holding %s, needing %s → %s', (level, needed, expected) => {
    expect(allows(level, needed)).toBe(expected);
  });

  it('lets a manager write every set of editor fields and no set that names an identity field', () => {
    const everyField = [...ADMIN_FIELDS, ...EDITOR_FIELDS];
    // All 512 subsets of the nine fields: a manager passes exactly those without an identity field.
    for (let mask = 0; mask < 1 << everyField.length; mask++) {
      const fields = everyField.filter((_, index) => mask & (1 << index));
      const hasIdentityField = fields.some((field) =>
        (ADMIN_FIELDS as readonly string[]).includes(field),
      );
      expect(allows('edit', requiredAccess(fields)), fields.join()).toBe(!hasIdentityField);
      expect(allows('admin', requiredAccess(fields)), fields.join()).toBe(true);
      expect(allows(null, requiredAccess(fields)), fields.join()).toBe(false);
    }
  });
});

describe('editableFields (what GET /organisations/{id} tells a screen)', () => {
  it('is every field for an admin, the descriptive ones for an editor, none for anybody else', () => {
    expect(editableFields('admin')).toEqual([...ADMIN_FIELDS, ...EDITOR_FIELDS]);
    expect(editableFields('edit')).toEqual([...EDITOR_FIELDS]);
    expect(editableFields(null)).toEqual([]);
  });

  it('agrees with allows: a field is listed exactly when a change to that field alone is allowed', () => {
    for (const level of ['admin', 'edit', null] as const) {
      for (const field of [...ADMIN_FIELDS, ...EDITOR_FIELDS]) {
        expect(editableFields(level).includes(field), `${level} ${field}`).toBe(
          allows(level, requiredAccess([field])),
        );
      }
    }
  });
});

describe('adminFieldsOf (the names a refusal lists)', () => {
  it.each<[OrganisationField[], string[]]>([
    [[], []],
    [['description', 'logo'], []],
    [['name'], ['name']],
    [
      ['name', 'description', 'type'],
      ['type', 'name'],
    ],
    [
      ['name', 'abbreviation', 'type'],
      ['type', 'abbreviation', 'name'],
    ],
  ])('%j → %j', (fields, expected) => {
    expect(adminFieldsOf(fields)).toEqual(expected);
  });
});
