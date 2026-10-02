import { describe, expect, it } from 'vitest';
import {
  createTokenInput,
  createUserInput,
  email,
  password,
  rotateTokenInput,
  scope,
  username,
} from './validation.ts';

const ok = (schema: { safeParse(value: unknown): { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe('username', () => {
  it.each<[string, string, boolean]>([
    ['the shortest', 'abc', true],
    ['the longest', 'a'.repeat(31), true],
    ['digits, underscore and hyphen', 'a1_b-2', true],
    ['digits only', '123', true],
    ['too short', 'ab', false],
    ['too long', 'a'.repeat(32), false],
    ['empty', '', false],
    ['upper case', 'Alice', false],
    ['a space', 'al ice', false],
    ['a dot', 'al.ice', false],
    ['an at sign', 'al@ice', false],
    ['a slash', 'al/ice', false],
    ['a non-ASCII letter', 'älice', false],
    ['an emoji', 'ali😀ce', false],
    ['a newline at the end', 'alice\n', false],
    ['padding', ' alice', false],
  ])('%s: %j', (_name, value, valid) => {
    expect(ok(username, value)).toBe(valid);
  });

  it.each([undefined, null, 42, {}, ['alice']])(
    'rejects a value that is not a string: %j',
    (value) => {
      expect(ok(username, value)).toBe(false);
    },
  );
});

describe('password', () => {
  it.each<[string, string, boolean]>([
    ['the shortest', 'a'.repeat(8), true],
    ['the longest', 'a'.repeat(255), true],
    ['spaces and symbols', 'correct horse battery staple!', true],
    ['non-ASCII', 'pässwörd-日本語', true],
    ['too short', 'a'.repeat(7), false],
    ['too long', 'a'.repeat(256), false],
    ['empty', '', false],
  ])('%s', (_name, value, valid) => {
    expect(ok(password, value)).toBe(valid);
  });
});

describe('email', () => {
  it.each<[string, string, boolean]>([
    ['a plain address', 'alice@example.org', true],
    ['a plus tag', 'alice+scorpion@example.org', true],
    ['a subdomain', 'alice@mail.ipk.example.org', true],
    ['upper case', 'Alice@Example.ORG', true],
    ['no at sign', 'alice.example.org', false],
    ['no domain', 'alice@', false],
    ['no local part', '@example.org', false],
    ['no top-level domain', 'alice@example', false],
    ['two at signs', 'a@b@example.org', false],
    ['a space inside', 'al ice@example.org', false],
    ['padding', ' alice@example.org', false],
    ['empty', '', false],
    [
      'the longest',
      `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.org`,
      true,
    ],
    [
      'over 254 characters',
      `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.org`,
      false,
    ],
  ])('%s: %j', (_name, value, valid) => {
    expect(ok(email, value)).toBe(valid);
  });
});

describe('createUserInput', () => {
  const local = { provider: 'local', password: 'long enough password' };
  const base = { username: 'alice', auth: local };

  it('accepts a password account and applies the defaults', () => {
    expect(createUserInput.parse(base)).toEqual({
      username: 'alice',
      emailVerified: false,
      status: 'pending',
      auth: local,
    });
  });

  it('accepts an identity-provider account with a verified address', () => {
    const input = {
      username: 'alice',
      email: 'alice@example.org',
      emailVerified: true,
      status: 'active',
      auth: { provider: 'lifescience-aai', subject: 'abc123@example.org' },
    };
    expect(createUserInput.parse(input)).toEqual(input);
  });

  it.each<[string, unknown]>([
    ['an unknown field', { ...base, isBootstrapAdmin: true }],
    ['an unknown status', { ...base, status: 'rejected' }],
    ['an invalid username', { ...base, username: 'Alice!' }],
    ['an invalid email', { ...base, email: 'not-an-email' }],
    ['a short password', { ...base, auth: { provider: 'local', password: 'short' } }],
    ['no auth', { username: 'alice' }],
    [
      'a password for a provider',
      { ...base, auth: { provider: 'oidc', password: 'x'.repeat(10) } },
    ],
    ['a provider without a subject', { ...base, auth: { provider: 'oidc' } }],
    ['an empty subject', { ...base, auth: { provider: 'oidc', subject: '' } }],
    [
      'a subject over 255 characters',
      { ...base, auth: { provider: 'oidc', subject: 's'.repeat(256) } },
    ],
    ['a provider id with upper case', { ...base, auth: { provider: 'OIDC', subject: 's' } }],
    [
      'a verified address without an address',
      { ...base, emailVerified: true, auth: { provider: 'oidc', subject: 's' } },
    ],
    [
      'a verified address on a password account',
      { ...base, email: 'a@example.org', emailVerified: true },
    ],
    ['a subject with the local provider', { ...base, auth: { provider: 'local', subject: 's' } }],
  ])('rejects %s', (_name, input) => {
    expect(createUserInput.safeParse(input).success).toBe(false);
  });

  it('never repeats the password in an error message', () => {
    const result = createUserInput.safeParse({
      ...base,
      auth: { provider: 'local', password: 'tiny' },
    });
    expect(JSON.stringify(result.error?.issues)).not.toContain('tiny');
  });
});

describe('scope', () => {
  it.each<[string, string, boolean]>([
    ['read a resource', 'read:kpi', true],
    ['write a dotted resource', 'write:registry.services', true],
    ['kebab case', 'read:kpi-ingestion', true],
    ['an unknown action', 'delete:kpi', false],
    ['no action', 'kpi', false],
    ['no resource', 'read:', false],
    ['upper case', 'read:KPI', false],
    ['a wildcard', 'read:*', false],
    ['a space', 'read: kpi', false],
    ['a trailing dot', 'read:kpi.', false],
    ['a leading digit in a segment', 'read:1kpi', false],
    ['too long', `read:${'a'.repeat(60)}`, false],
    ['non-ASCII', 'read:kpí', false],
  ])('%s: %j', (_name, value, valid) => {
    expect(ok(scope, value)).toBe(valid);
  });
});

describe('createTokenInput', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  it('defaults to no scopes and no expiry, trims the name, sorts and de-duplicates scopes', () => {
    expect(createTokenInput.parse({ name: ' ci ' })).toEqual({
      name: 'ci',
      scopes: [],
      expiresAt: null,
    });
    expect(
      createTokenInput.parse({
        name: 'a',
        scopes: ['write:b', 'read:a', 'read:a'],
        expiresAt: future,
      }),
    ).toEqual({ name: 'a', scopes: ['read:a', 'write:b'], expiresAt: new Date(future) });
  });

  it.each<[string, unknown]>([
    ['no name', {}],
    ['an empty name', { name: '  ' }],
    ['a long name', { name: 'x'.repeat(65) }],
    ['a control character in the name', { name: 'a\u0000b' }],
    ['a number for the name', { name: 7 }],
    ['an unknown scope shape', { name: 'a', scopes: ['everything'] }],
    ['too many scopes', { name: 'a', scopes: Array.from({ length: 21 }, (_, i) => `read:a${i}`) }],
    ['an expiry that is not a date', { name: 'a', expiresAt: 'tomorrow' }],
    ['an expiry without a time zone', { name: 'a', expiresAt: '2030-01-01T00:00:00' }],
    ['an extra field', { name: 'a', admin: true }],
  ])('refuses %s', (_name, value) => {
    expect(ok(createTokenInput, value)).toBe(false);
  });

  it('takes an optional expiry for rotation and nothing else', () => {
    expect(ok(rotateTokenInput, {})).toBe(true);
    expect(ok(rotateTokenInput, { expiresAt: future })).toBe(true);
    expect(ok(rotateTokenInput, { name: 'other' })).toBe(false);
  });
});
