import { describe, expect, it } from 'vitest';
import { createUserInput, email, password, username } from './validation.ts';

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
