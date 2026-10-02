import { afterEach, describe, expect, it } from 'vitest';
import { clientSecretFor, clientSecretVariable } from './oidc-secret.ts';

describe('the client secret lookup', () => {
  afterEach(() => {
    delete process.env.OIDC_LIFE_SCIENCE_AAI_CLIENT_SECRET;
  });

  it.each([
    ['keycloak', 'OIDC_KEYCLOAK_CLIENT_SECRET'],
    ['life-science-aai', 'OIDC_LIFE_SCIENCE_AAI_CLIENT_SECRET'],
    ['a1', 'OIDC_A1_CLIENT_SECRET'],
  ])('names the variable of %s', (id, variable) => {
    expect(clientSecretVariable(id)).toBe(variable);
  });

  it('reads the variable, and treats missing or empty as "no secret" (a public client)', () => {
    expect(clientSecretFor('life-science-aai')).toBeUndefined();
    process.env.OIDC_LIFE_SCIENCE_AAI_CLIENT_SECRET = '';
    expect(clientSecretFor('life-science-aai')).toBeUndefined();
    process.env.OIDC_LIFE_SCIENCE_AAI_CLIENT_SECRET = 's3cret';
    expect(clientSecretFor('life-science-aai')).toBe('s3cret');
  });
});
