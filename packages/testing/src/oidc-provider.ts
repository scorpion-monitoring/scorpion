// A small OIDC provider on a local port, for tests that must see the whole flow without Keycloak:
// discovery, an authorisation endpoint, a token endpoint that checks PKCE and the client secret and
// uses a code once, and a JWKS. A test sets `login` (who signs in) and `faults` (what is wrong with
// the id_token), then plays the browser with `authorize()`.
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import {
  SignJWT,
  exportJWK,
  exportSPKI,
  generateKeyPair,
  type CryptoKey,
  type JWK,
  type KeyObject,
} from 'jose';

export interface StubLogin {
  subject: string;
  email?: string;
  /** `true`, `false`, or another value to see that only the boolean `true` counts. */
  emailVerified?: unknown;
  preferredUsername?: string;
  /**
   * When the person last authenticated at the provider, in seconds since the epoch: what an
   * authorisation request without `prompt=login` and `max_age=0` is answered with (the provider's
   * single sign-on session). Without it no `auth_time` is sent for such a request.
   */
  authTime?: number;
}

export interface TokenFaults {
  /** Replaces the nonce of the authorisation request; `null` leaves it out. */
  nonce?: string | null;
  audience?: string | string[];
  /** Replaces `azp`; `null` leaves it out. */
  azp?: string | null;
  issuer?: string;
  /** Seconds from now until `exp` (negative: already expired). Default 300. */
  expiresIn?: number;
  /** Seconds added to `iat` (positive: issued in the future). */
  issuedAtOffset?: number;
  /** Seconds from now for `nbf` (positive: not valid yet). Left out by default. */
  notBefore?: number;
  /** Which key signs: the provider's own (default), an unrelated one, nothing (`alg: none`), or HS256 keyed with the public key. */
  signWith?: 'issuer-key' | 'other-key' | 'none' | 'hs256-with-public-key';
  /** Leaves `exp` / `iat` / `sub` / `auth_time` out. */
  omit?: ('exp' | 'iat' | 'sub' | 'auth_time')[];
  /** Seconds added to `auth_time` (negative: the login at the provider is older than it should be). */
  authTimeOffset?: number;
  /** The provider ignores `prompt=login` and `max_age`, as a provider that does not support them would. */
  ignorePrompt?: boolean;
  /** The token endpoint answers without an `id_token`. */
  omitIdToken?: boolean;
}

export interface StubIdp {
  issuer: string;
  clientId: string;
  clientSecret: string;
  login: StubLogin;
  faults: TokenFaults;
  /** Make a document or endpoint fail. */
  fail: { discovery: boolean; jwks: boolean; token: boolean };
  /** Milliseconds the token endpoint waits before answering. */
  tokenDelayMs: number;
  requests: { discovery: number; jwks: number; token: number };
  /** The query of the last authorisation request, to check PKCE and nonce. */
  lastAuthorization: URLSearchParams | undefined;
  /** Plays the browser at the authorisation endpoint; returns where the provider sends it back. */
  authorize(authorizationUrl: string, loginOverride?: Partial<StubLogin>): Promise<URL>;
  /** The provider starts signing with a new key (the old one leaves the JWKS). */
  rotateKey(): Promise<void>;
  /** The `oidcProviders` settings entry that points at this provider. */
  provider(id?: string): {
    id: string;
    displayName: string;
    issuer: string;
    clientId: string;
    scopes: string[];
  };
  stop(): Promise<void>;
}

interface CodeRecord {
  challenge: string;
  nonce: string | undefined;
  redirectUri: string;
  clientId: string;
  login: StubLogin;
  /** The `auth_time` this authorisation yields (seconds), if any. */
  authTime: number | undefined;
}

const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export async function startStubIdp(
  options: { clientId?: string; clientSecret?: string } = {},
): Promise<StubIdp> {
  const clientId = options.clientId ?? 'scorpion-test';
  const clientSecret = options.clientSecret ?? randomBytes(16).toString('hex');
  const codes = new Map<string, CodeRecord>();
  let key = await generateKeyPair('RS256', { extractable: true });
  const other = await generateKeyPair('RS256', { extractable: true });
  let kid = 'key-1';
  let jwk: JWK = { ...(await exportJWK(key.publicKey)), kid, alg: 'RS256', use: 'sig' };

  const state: StubIdp = {
    issuer: '',
    clientId,
    clientSecret,
    login: { subject: 'subject-1', email: 'person@example.org', emailVerified: true },
    faults: {},
    fail: { discovery: false, jwks: false, token: false },
    tokenDelayMs: 0,
    requests: { discovery: 0, jwks: 0, token: 0 },
    lastAuthorization: undefined,
    async authorize(authorizationUrl, loginOverride) {
      pendingLogin = { ...state.login, ...loginOverride };
      const response = await fetch(authorizationUrl, { redirect: 'manual' });
      const location = response.headers.get('location');
      if (response.status !== 302 || !location) {
        throw new Error(`the stub provider refused the request: ${response.status}`);
      }
      return new URL(location);
    },
    async rotateKey() {
      key = await generateKeyPair('RS256', { extractable: true });
      kid = `key-${Number(kid.split('-')[1]) + 1}`;
      jwk = { ...(await exportJWK(key.publicKey)), kid, alg: 'RS256', use: 'sig' };
    },
    provider: (id = 'stub') => ({
      id,
      displayName: 'Stub provider',
      issuer: state.issuer,
      clientId,
      scopes: ['openid', 'email', 'profile'],
    }),
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
  let pendingLogin: StubLogin = state.login;

  async function idToken(code: CodeRecord): Promise<string> {
    const f = state.faults;
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: f.issuer ?? state.issuer,
      aud: f.audience ?? clientId,
      iat: now + (f.issuedAtOffset ?? 0),
      exp: now + (f.expiresIn ?? 300),
      sub: code.login.subject,
      email: code.login.email,
      email_verified: code.login.emailVerified,
      preferred_username: code.login.preferredUsername,
    };
    if (code.authTime !== undefined) claims.auth_time = code.authTime + (f.authTimeOffset ?? 0);
    if (f.nonce !== null) claims.nonce = f.nonce ?? code.nonce;
    if (f.azp !== null && f.azp !== undefined) claims.azp = f.azp;
    if (f.notBefore !== undefined) claims.nbf = now + f.notBefore;
    for (const name of f.omit ?? []) delete claims[name];

    const mode = f.signWith ?? 'issuer-key';
    if (mode === 'none') {
      return `${b64(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64(JSON.stringify(claims))}.`;
    }
    if (mode === 'hs256-with-public-key') {
      const secret = new TextEncoder().encode(await exportSPKI(key.publicKey));
      return new SignJWT(claims).setProtectedHeader({ alg: 'HS256', kid }).sign(secret);
    }
    const signer: CryptoKey | KeyObject = mode === 'other-key' ? other.privateKey : key.privateKey;
    return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid }).sign(signer);
  }

  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', state.issuer);
      const json = (status: number, body: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      };
      try {
        if (url.pathname === '/.well-known/openid-configuration') {
          state.requests.discovery++;
          if (state.fail.discovery) return json(500, { error: 'server_error' });
          return json(200, {
            issuer: state.issuer,
            authorization_endpoint: `${state.issuer}/authorize`,
            token_endpoint: `${state.issuer}/token`,
            jwks_uri: `${state.issuer}/jwks`,
          });
        }
        if (url.pathname === '/jwks') {
          state.requests.jwks++;
          if (state.fail.jwks) return json(500, { error: 'server_error' });
          return json(200, { keys: [jwk] });
        }
        if (url.pathname === '/authorize') {
          state.lastAuthorization = url.searchParams;
          const q = url.searchParams;
          const redirect = q.get('redirect_uri');
          if (
            q.get('response_type') !== 'code' ||
            q.get('client_id') !== clientId ||
            q.get('code_challenge_method') !== 'S256' ||
            !q.get('code_challenge') ||
            !q.get('state') ||
            !redirect
          ) {
            return json(400, { error: 'invalid_request' });
          }
          const code = randomBytes(24).toString('base64url');
          // `prompt=login` or `max_age=0` makes the provider ask for a login now; one that
          // ignores them (`faults.ignorePrompt`) answers from its single sign-on session.
          const asksForLogin = q.get('prompt') === 'login' || q.get('max_age') === '0';
          const authTime =
            asksForLogin && !state.faults.ignorePrompt
              ? Math.floor(Date.now() / 1000)
              : pendingLogin.authTime;
          codes.set(code, {
            authTime,
            challenge: q.get('code_challenge')!,
            nonce: q.get('nonce') ?? undefined,
            redirectUri: redirect,
            clientId,
            login: pendingLogin,
          });
          const back = new URL(redirect);
          back.searchParams.set('code', code);
          back.searchParams.set('state', q.get('state')!);
          response.writeHead(302, { location: back.toString() });
          return void response.end();
        }
        if (url.pathname === '/token' && request.method === 'POST') {
          state.requests.token++;
          if (state.tokenDelayMs > 0) await new Promise((r) => setTimeout(r, state.tokenDelayMs));
          if (state.fail.token) return json(500, { error: 'server_error' });
          const form = await readForm(request);
          const basic = /^Basic (.+)$/.exec(request.headers.authorization ?? '')?.[1];
          const [user, pass] = basic ? Buffer.from(basic, 'base64').toString().split(':') : [];
          const authenticated =
            (user === clientId && pass === clientSecret) ||
            (!basic && form.get('client_id') === clientId && !clientSecret);
          if (!authenticated) return json(401, { error: 'invalid_client' });
          const record = codes.get(form.get('code') ?? '');
          codes.delete(form.get('code') ?? ''); // a code is good once
          const verifier = form.get('code_verifier') ?? '';
          if (
            !record ||
            record.redirectUri !== form.get('redirect_uri') ||
            createHash('sha256').update(verifier).digest('base64url') !== record.challenge
          ) {
            return json(400, { error: 'invalid_grant' });
          }
          return json(200, {
            token_type: 'Bearer',
            access_token: 'stub-access-token',
            expires_in: 300,
            ...(state.faults.omitIdToken ? {} : { id_token: await idToken(record) }),
          });
        }
        return json(404, { error: 'not_found' });
      } catch {
        return json(500, { error: 'server_error' });
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  state.issuer = `http://127.0.0.1:${address.port}`;
  return state;
}
