import { describe, expect, it } from 'vitest';
import { clientSecretFrom, clientSecretName } from './oidc-secret.ts';

describe('the client secret lookup', () => {
  it.each([
    ['keycloak', 'oidc.keycloak.client-secret'],
    ['life-science-aai', 'oidc.life-science-aai.client-secret'],
    ['a1', 'oidc.a1.client-secret'],
  ])('names the secret of %s', (id, name) => {
    expect(clientSecretName(id)).toBe(name);
  });

  it('asks the secrets store under that name, and yields undefined for a provider without one', async () => {
    const asked: string[] = [];
    const lookup = clientSecretFrom({
      getSecret: (name) => {
        asked.push(name);
        return Promise.resolve(name === 'oidc.keycloak.client-secret' ? 's3cret' : undefined);
      },
    });
    expect(await lookup('keycloak')).toBe('s3cret');
    expect(await lookup('other')).toBeUndefined();
    expect(asked).toEqual(['oidc.keycloak.client-secret', 'oidc.other.client-secret']);
  });

  it('does not read the environment, whatever the old variable holds', async () => {
    process.env.OIDC_KEYCLOAK_CLIENT_SECRET = 'from-the-environment';
    try {
      const lookup = clientSecretFrom({ getSecret: () => Promise.resolve(undefined) });
      expect(await lookup('keycloak')).toBeUndefined();
    } finally {
      delete process.env.OIDC_KEYCLOAK_CLIENT_SECRET;
    }
  });
});
