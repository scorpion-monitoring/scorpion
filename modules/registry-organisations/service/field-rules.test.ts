// The field-rules table: every field of an organisation and every set of fields maps to the access it
// needs (ADR-0033, Decision 14). A field that is added without a rule fails here.
import { describe, expect, it } from 'vitest';
import {
  ADMIN_FIELDS,
  EDITOR_FIELDS,
  fieldsOfBody,
  fieldsOfInput,
  requiredAccess,
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
