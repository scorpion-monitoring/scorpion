// Discovery and the key set: caching, limits and failures, with a stub `fetch`.
import { describe, expect, it } from 'vitest';
import { ProviderUnavailable } from './oidc-errors.ts';
import {
  DISCOVERY_TTL_MS,
  JWKS_REFRESH_COOLDOWN_MS,
  JWKS_TTL_MS,
  createProviderClient,
} from './oidc-provider.ts';
import type { OidcProvider } from './settings.ts';

const ISSUER = 'https://idp.example.org/realms/test';
const provider: OidcProvider = {
  id: 'corp',
  displayName: 'Corp',
  issuer: ISSUER,
  clientId: 'scorpion',
  scopes: ['openid'],
};
const document = (over: Record<string, unknown> = {}) => ({
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/auth`,
  token_endpoint: `${ISSUER}/token`,
  jwks_uri: `${ISSUER}/certs`,
  ...over,
});

function stub(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchStub = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const route = routes[url];
    return Promise.resolve(route ? route() : new Response('nope', { status: 404 }));
  }) as typeof fetch;
  return { fetch: fetchStub, calls };
}
const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;

describe('discovery', () => {
  it('reads the document from the issuer, without redirects, with a timeout, and caches it', async () => {
    let clock = 0;
    const { fetch, calls } = stub({ [DISCOVERY]: json(document()) });
    const client = createProviderClient({ fetch, now: () => clock });
    expect(await client.discovery(provider)).toEqual({
      authorizationEndpoint: `${ISSUER}/auth`,
      tokenEndpoint: `${ISSUER}/token`,
      jwksUri: `${ISSUER}/certs`,
    });
    await client.discovery(provider);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init).toMatchObject({ redirect: 'error' });
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    clock += DISCOVERY_TTL_MS + 1;
    await client.discovery(provider);
    expect(calls).toHaveLength(2);
  });

  it('shares one request between concurrent callers', async () => {
    const { fetch, calls } = stub({ [DISCOVERY]: json(document()) });
    const client = createProviderClient({ fetch });
    await Promise.all([
      client.discovery(provider),
      client.discovery(provider),
      client.discovery(provider),
    ]);
    expect(calls).toHaveLength(1);
  });

  it('does not reuse the cache for a provider whose issuer changed', async () => {
    const other = { ...provider, issuer: 'https://other.example.org' };
    const { fetch, calls } = stub({
      [DISCOVERY]: json(document()),
      'https://other.example.org/.well-known/openid-configuration': json(
        document({
          issuer: other.issuer,
          authorization_endpoint: 'https://other.example.org/a',
          token_endpoint: 'https://other.example.org/t',
          jwks_uri: 'https://other.example.org/j',
        }),
      ),
    });
    const client = createProviderClient({ fetch });
    await client.discovery(provider);
    expect((await client.discovery(other)).tokenEndpoint).toBe('https://other.example.org/t');
    expect(calls).toHaveLength(2);
  });

  it.each([
    ['an issuer that differs', json(document({ issuer: `${ISSUER}/` }))],
    ['an issuer of another host', json(document({ issuer: 'https://evil.example.org' }))],
    ['a missing endpoint', json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/auth` })],
    [
      'an http endpoint on another host',
      json(document({ token_endpoint: 'http://idp.example.org/token' })),
    ],
    ['a javascript: endpoint', json(document({ authorization_endpoint: 'javascript:alert(1)' }))],
    ['a document that is not JSON', () => new Response('<html>')],
    ['a JSON array', json([])],
    ['a 500', json({}, 500)],
    ['a 404', json({}, 404)],
    ['a document over the size limit', () => new Response('x'.repeat(2 * 1024 * 1024))],
  ])('is a ProviderUnavailable for %s', async (_name, route) => {
    const { fetch } = stub({ [DISCOVERY]: route });
    const client = createProviderClient({ fetch });
    await expect(client.discovery(provider)).rejects.toBeInstanceOf(ProviderUnavailable);
  });

  it('is a ProviderUnavailable when the request fails or hangs, and the message hides the URL', async () => {
    const failing = createProviderClient({
      fetch: () => Promise.reject(new TypeError('connect ECONNREFUSED 10.0.0.1:443')),
    });
    const error = await failing.discovery(provider).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderUnavailable);
    expect((error as Error).message).not.toContain('10.0.0.1');
    expect((error as ProviderUnavailable).status).toBe(502);

    const hanging = createProviderClient({
      timeoutMs: 20,
      fetch: ((_u: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as typeof fetch,
    });
    await expect(hanging.discovery(provider)).rejects.toBeInstanceOf(ProviderUnavailable);
  });

  it('does not cache a failure', async () => {
    let fail = true;
    const { fetch, calls } = stub({
      [DISCOVERY]: () => (fail ? new Response('x', { status: 500 }) : json(document())()),
    });
    const client = createProviderClient({ fetch });
    await expect(client.discovery(provider)).rejects.toBeInstanceOf(ProviderUnavailable);
    fail = false;
    await client.discovery(provider);
    expect(calls).toHaveLength(2);
  });

  it('allows http for localhost only', async () => {
    const local = { ...provider, issuer: 'http://127.0.0.1:8080/realms/x' };
    const { fetch } = stub({
      'http://127.0.0.1:8080/realms/x/.well-known/openid-configuration': json(
        document({
          issuer: local.issuer,
          authorization_endpoint: 'http://127.0.0.1:8080/a',
          token_endpoint: 'http://127.0.0.1:8080/t',
          jwks_uri: 'http://127.0.0.1:8080/j',
        }),
      ),
    });
    expect((await createProviderClient({ fetch }).discovery(local)).jwksUri).toBe(
      'http://127.0.0.1:8080/j',
    );
  });
});

describe('keys', () => {
  const discovery = { authorizationEndpoint: '', tokenEndpoint: '', jwksUri: `${ISSUER}/certs` };
  const keyset = { keys: [{ kty: 'RSA', kid: 'k1' }] };

  it('caches the key set for ten minutes', async () => {
    let clock = 0;
    const { fetch, calls } = stub({ [discovery.jwksUri]: json(keyset) });
    const client = createProviderClient({ fetch, now: () => clock });
    expect(await client.keys(provider, discovery)).toEqual(keyset);
    await client.keys(provider, discovery);
    expect(calls).toHaveLength(1);
    clock += JWKS_TTL_MS + 1;
    await client.keys(provider, discovery);
    expect(calls).toHaveLength(2);
  });

  it('re-reads on request, but not more often than the cooldown', async () => {
    let clock = 0;
    const { fetch, calls } = stub({ [discovery.jwksUri]: json(keyset) });
    const client = createProviderClient({ fetch, now: () => clock });
    await client.keys(provider, discovery);
    await client.keys(provider, discovery, true); // too soon: served from the cache
    expect(calls).toHaveLength(1);
    clock += JWKS_REFRESH_COOLDOWN_MS + 1;
    await client.keys(provider, discovery, true);
    expect(calls).toHaveLength(2);
  });

  it.each([
    ['a failure', () => new Response('x', { status: 503 })],
    ['something that is not a key set', json({ nothing: true })],
    ['too many keys', json({ keys: Array.from({ length: 101 }, () => ({ kty: 'RSA' })) })],
    ['rubbish', () => new Response('{{{')],
  ])('is a ProviderUnavailable for %s', async (_name, route) => {
    const { fetch } = stub({ [discovery.jwksUri]: route });
    await expect(createProviderClient({ fetch }).keys(provider, discovery)).rejects.toBeInstanceOf(
      ProviderUnavailable,
    );
  });
});
