// The field-rules table of a service: which access a set of fields needs, who holds it, which fields a
// caller may write. Pure and table-driven; the effect on a real update is in `editing.test.ts`.
import { describe, expect, it } from 'vitest';
import { FIELDS } from '../config/fields.ts';
import {
  allows,
  editableFields,
  identityFieldsOf,
  IDENTITY_FIELDS,
  isIdentityField,
  requiredAccess,
  type AccessLevel,
} from './field-rules.ts';

const KEYS = FIELDS.map((field) => field.key);
const ADMIN: AccessLevel = { edit: true, identity: true };
const MEMBER: AccessLevel = { edit: true, identity: false };
const NOBODY: AccessLevel = { edit: false, identity: false };
const IDENTITY_ONLY: AccessLevel = { edit: false, identity: true }; // a token that names one scope

describe('requiredAccess', () => {
  it.each([
    [['description'], ['edit']],
    [['name', 'stage', 'license', 'url', 'sameAs', 'contactEmail', 'contactType'], ['edit']],
    [['consortia'], ['edit']],
    [['icon'], ['edit']],
    [['slug'], ['identity']],
    [['provider'], ['identity']],
    [['slug', 'provider'], ['identity']],
    [
      ['slug', 'description'],
      ['edit', 'identity'],
    ],
    [
      ['provider', 'consortia', 'name'],
      ['edit', 'identity'],
    ],
    [['anExtraFieldOfADeployment'], ['edit']],
    [[], ['edit']],
  ])('%j needs %j', (fields, needed) => {
    expect(requiredAccess(fields)).toEqual(needed);
  });

  it('names exactly the slug and the provider as the identity of a service', () => {
    expect([...IDENTITY_FIELDS]).toEqual(['slug', 'provider']);
    expect(KEYS.filter(isIdentityField)).toEqual(['slug', 'provider']);
  });
});

describe('allows', () => {
  it.each([
    ['Admin', ADMIN, ['edit'], true],
    ['Admin', ADMIN, ['identity'], true],
    ['Admin', ADMIN, ['edit', 'identity'], true],
    ['a member', MEMBER, ['edit'], true],
    ['a member', MEMBER, ['identity'], false],
    ['a member', MEMBER, ['edit', 'identity'], false],
    ['nobody', NOBODY, ['edit'], false],
    ['nobody', NOBODY, ['identity'], false],
    ['only identity', IDENTITY_ONLY, ['edit', 'identity'], false],
    ['only identity', IDENTITY_ONLY, ['identity'], true],
  ] as const)('%s with %j needing %j: %s', (_who, level, needed, expected) => {
    expect(allows(level, needed)).toBe(expected);
  });
});

describe('editableFields', () => {
  it('gives everything to a caller who holds both accesses, in the order of the configuration', () => {
    expect(editableFields(ADMIN, KEYS)).toEqual(KEYS);
  });

  it('gives a member everything but the slug and the provider', () => {
    expect(editableFields(MEMBER, KEYS)).toEqual(KEYS.filter((key) => !isIdentityField(key)));
    expect(editableFields(MEMBER, KEYS)).toContain('consortia');
    expect(editableFields(MEMBER, KEYS)).toContain('icon');
    expect(editableFields(MEMBER, KEYS)).not.toContain('slug');
  });

  it('gives nobody nothing, and an identity-only caller only the identity', () => {
    expect(editableFields(NOBODY, KEYS)).toEqual([]);
    expect(editableFields(IDENTITY_ONLY, KEYS)).toEqual(['slug', 'provider']);
  });

  it('agrees with requiredAccess: a field is editable exactly when the access it needs is allowed', () => {
    for (const level of [ADMIN, MEMBER, NOBODY, IDENTITY_ONLY]) {
      const editable = new Set(editableFields(level, KEYS));
      for (const key of KEYS) {
        expect(editable.has(key), `${key} for ${JSON.stringify(level)}`).toBe(
          allows(level, requiredAccess([key])),
        );
      }
    }
  });
});

describe('identityFieldsOf', () => {
  it('keeps the identity fields of a request in the order of the table', () => {
    expect(identityFieldsOf(['provider', 'name', 'slug'])).toEqual(['slug', 'provider']);
    expect(identityFieldsOf(['name'])).toEqual([]);
  });
});
