// Talking to an OIDC provider: discovery and the key set. Every request has a timeout, a size
// limit and no redirects; both documents are cached, and a failure is a `ProviderUnavailable`
// (502), never a stack trace. `fetch` is a parameter so tests can use a stub.
import type { JSONWebKeySet } from 'jose';
import { z } from 'zod';
import { ProviderUnavailable } from './oidc-errors.ts';
import { isSecureUrl, type OidcProvider } from './settings.ts';

export const DISCOVERY_TTL_MS = 60 * 60 * 1000;
export const JWKS_TTL_MS = 10 * 60 * 1000;
/** A key we do not know may be a rotation: re-read the key set, but not more often than this. */
export const JWKS_REFRESH_COOLDOWN_MS = 30 * 1000;
export const HTTP_TIMEOUT_MS = 10_000;
const MAX_DOCUMENT_BYTES = 1024 * 1024;

const endpoint = z.string().max(2000).refine(isSecureUrl, 'must be an https URL');
const discoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: endpoint,
  token_endpoint: endpoint,
  jwks_uri: endpoint,
});
const jwksSchema = z.object({ keys: z.array(z.record(z.string(), z.unknown())).max(100) });

export interface Discovery {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

export interface ProviderClient {
  discovery(provider: OidcProvider): Promise<Discovery>;
  /** The provider's keys; `refresh` re-reads them (allowed once per cooldown). */
  keys(provider: OidcProvider, discovery: Discovery, refresh?: boolean): Promise<JSONWebKeySet>;
}

export interface ProviderClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

interface Cached<T> {
  value: T;
  at: number;
}

export function createProviderClient(options: ProviderClientOptions = {}): ProviderClient {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? HTTP_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const discoveries = new Map<string, Cached<Discovery>>();
  const keySets = new Map<string, Cached<JSONWebKeySet>>();
  const inFlight = new Map<string, Promise<unknown>>();
  // A changed issuer (settings are data from M3) must not reuse what was cached for the old one.
  const keyOf = (provider: OidcProvider) => `${provider.id}\0${provider.issuer}`;

  /** One request at a time per key; concurrent callers share the answer. */
  function once<T>(key: string, run: () => Promise<T>): Promise<T> {
    const running = inFlight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const promise = run().finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  }

  async function getJson(url: string): Promise<unknown> {
    try {
      const response = await doFetch(url, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok || response.body === null) throw new Error(`status ${response.status}`);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array };
        if (done || value === undefined) break;
        size += value.byteLength;
        if (size > MAX_DOCUMENT_BYTES) {
          await reader.cancel();
          throw new Error('document too large');
        }
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      // Whatever it was, the caller learns only that the provider is unavailable; the URL is the
      // operator's configuration and is not repeated.
      throw new ProviderUnavailable();
    }
  }

  return {
    discovery(provider) {
      const cached = discoveries.get(keyOf(provider));
      if (cached && now() - cached.at < DISCOVERY_TTL_MS) return Promise.resolve(cached.value);
      return once(`discovery:${keyOf(provider)}`, async () => {
        const url = `${provider.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
        const parsed = discoverySchema.safeParse(await getJson(url));
        // The document must name the issuer we were configured with, character for character.
        if (!parsed.success || parsed.data.issuer !== provider.issuer)
          throw new ProviderUnavailable();
        const value: Discovery = {
          authorizationEndpoint: parsed.data.authorization_endpoint,
          tokenEndpoint: parsed.data.token_endpoint,
          jwksUri: parsed.data.jwks_uri,
        };
        discoveries.set(keyOf(provider), { value, at: now() });
        return value;
      });
    },

    keys(provider, discovery, refresh = false) {
      const cached = keySets.get(keyOf(provider));
      if (cached) {
        const age = now() - cached.at;
        if (refresh ? age < JWKS_REFRESH_COOLDOWN_MS : age < JWKS_TTL_MS) {
          return Promise.resolve(cached.value);
        }
      }
      return once(`jwks:${keyOf(provider)}`, async () => {
        const parsed = jwksSchema.safeParse(await getJson(discovery.jwksUri));
        if (!parsed.success) throw new ProviderUnavailable();
        const value: JSONWebKeySet = parsed.data;
        keySets.set(keyOf(provider), { value, at: now() });
        return value;
      });
    },
  };
}
