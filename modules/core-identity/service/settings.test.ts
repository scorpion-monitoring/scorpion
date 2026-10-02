import { describe, expect, it } from 'vitest';
import { isSecureUrl, oidcProviderSchema, settingsSchema } from './settings.ts';

const provider = {
  id: 'keycloak',
  displayName: 'Keycloak',
  issuer: 'https://idp.example.org/realms/main',
  clientId: 'scorpion',
};

describe('oidcProviders', () => {
  it('are empty by default, so OIDC is off', () => {
    expect(settingsSchema.parse({}).oidcProviders).toEqual([]);
  });

  it('default the scopes to openid, email and profile', () => {
    expect(oidcProviderSchema.parse(provider).scopes).toEqual(['openid', 'email', 'profile']);
  });

  it.each([
    ['an http issuer on localhost', { issuer: 'http://localhost:8080/realms/x' }],
    ['an http issuer on 127.0.0.1', { issuer: 'http://127.0.0.1:8080/realms/x' }],
    ['custom scopes', { scopes: ['openid', 'groups'] }],
    ['an id with digits and dashes', { id: 'life-science-aai2' }],
  ])('accept %s', (_name, over) => {
    expect(oidcProviderSchema.safeParse({ ...provider, ...over }).success).toBe(true);
  });

  it.each([
    ['an http issuer on another host', { issuer: 'http://idp.example.org' }],
    ['a javascript: issuer', { issuer: 'javascript:alert(1)' }],
    ['an issuer that is not a URL', { issuer: 'idp' }],
    ['the reserved id local', { id: 'local' }],
    ['an upper-case id', { id: 'Keycloak' }],
    ['an id with an underscore', { id: 'key_cloak' }],
    ['an id that starts with a digit', { id: '1abc' }],
    ['an id over 32 characters', { id: 'a'.repeat(33) }],
    ['an empty display name', { displayName: ' ' }],
    ['an empty client id', { clientId: '' }],
    ['scopes without openid', { scopes: ['email'] }],
    ['a scope with a space', { scopes: ['openid', 'a b'] }],
    ['an unknown field (a secret does not belong here)', { clientSecret: 'x' }],
  ])('refuse %s', (_name, over) => {
    expect(oidcProviderSchema.safeParse({ ...provider, ...over }).success).toBe(false);
  });

  it('refuse two providers with one id, and more than 20', () => {
    expect(settingsSchema.safeParse({ oidcProviders: [provider, provider] }).success).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => ({ ...provider, id: `p${i}` }));
    expect(settingsSchema.safeParse({ oidcProviders: many }).success).toBe(false);
  });
});

describe('isSecureUrl', () => {
  it.each([
    ['https://a.example', true],
    ['http://localhost:3000', true],
    ['http://[::1]:3000', true],
    ['http://localhost.evil.example', false],
    ['http://example.org', false],
    ['ftp://localhost', false],
    ['not a url', false],
  ])('%s → %s', (value, expected) => {
    expect(isSecureUrl(value)).toBe(expected);
  });
});
