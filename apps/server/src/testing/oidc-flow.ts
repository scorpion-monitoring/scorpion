// Helpers for tests of the OIDC routes: the settings that point at a stub provider, and a "browser"
// that walks the three steps (start, provider, callback) and lets a test change any one of them.
import { startStubIdp, type StubIdp } from '@scorpion/testing';
import { afterAll, beforeAll } from 'vitest';
import {
  API,
  settingsWith,
  useIdentityApp,
  type Reply,
  type RequestOptions,
} from './identity-app.ts';

export const PROVIDER = 'stub';
export const LOGIN_COOKIE = '__Host-oidc-login';

export const oidcSettings = (idp: StubIdp, over: Record<string, unknown> = {}) =>
  settingsWith({
    localAccounts: true,
    approvalPolicy: 'manual',
    oidcProviders: [idp.provider(PROVIDER)],
    ...over,
  });

interface App {
  call(method: string, path: string, options?: RequestOptions): Promise<Reply>;
}

/** The value of a cookie this response set, `''` when it cleared it, `undefined` when it did not mention it. */
export function setCookieValue(reply: Reply, name: string): string | undefined {
  const line = reply.res.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  return line === undefined ? undefined : line.slice(name.length + 1).split(';')[0];
}

export interface Started {
  reply: Reply;
  authorizationUrl: string;
  /** The login cookie value this browser now holds. */
  loginCookie: string;
}

export interface Callback {
  /** Path and query below the API prefix, as the provider sends the browser back. */
  path: string;
  state: string;
  code: string;
}

/** What plays the provider's login page: a stub, or a real Keycloak. */
export interface Authorizer<Who> {
  authorize(authorizationUrl: string, who: Who): Promise<URL>;
}

export function browser<Who = undefined>(
  app: App,
  idp: Authorizer<Who>,
  providerId: string = PROVIDER,
) {
  /**
   * `POST .../start` (`.../link` and `reauthenticate` need a session) and keep the login cookie.
   * `reauthenticate` is the re-authentication of the caller's session (ADR 0025).
   */
  async function start(
    kind: 'start' | 'link' | 'reauthenticate' = 'start',
    options: RequestOptions = {},
  ): Promise<Started> {
    const path =
      kind === 'reauthenticate'
        ? `/account/reauthenticate/oidc/${providerId}`
        : `/auth/oidc/${providerId}/${kind}`;
    const reply = await app.call('POST', path, options);
    if (reply.status !== 200) throw new Error(`start answered ${reply.status}`);
    return {
      reply,
      authorizationUrl: (reply.body as { authorizationUrl: string }).authorizationUrl,
      loginCookie: setCookieValue(reply, LOGIN_COOKIE) ?? '',
    };
  }

  /** The provider step: the browser logs in there and is sent back with a code. */
  async function provider(started: Started, who: Who): Promise<Callback> {
    const back = await idp.authorize(started.authorizationUrl, who);
    return {
      path: `${back.pathname.slice(API.length)}${back.search}`,
      state: back.searchParams.get('state')!,
      code: back.searchParams.get('code')!,
    };
  }

  /** The callback, with the login cookie of `started` unless a test gives other cookies. */
  function callback(
    callbackUrl: Callback,
    started: Pick<Started, 'loginCookie'> | undefined,
    options: RequestOptions & { session?: string } = {},
  ): Promise<Reply> {
    const { session, ...rest } = options;
    const cookies = [
      started ? `${LOGIN_COOKIE}=${started.loginCookie}` : undefined,
      session === undefined ? undefined : `__Host-session=${session}`,
    ].filter((c): c is string => c !== undefined);
    return app.call('GET', callbackUrl.path, {
      ...rest,
      headers: { ...(cookies.length > 0 ? { cookie: cookies.join('; ') } : {}), ...rest.headers },
    });
  }

  /** All three steps. */
  async function login(who: Who, options: RequestOptions & { session?: string } = {}) {
    const started = await start();
    const back = await provider(started, who);
    return { started, back, reply: await callback(back, started, options) };
  }

  return { start, provider, callback, login };
}

let counter = 0;
/** A login nobody has used before. */
export const person = () => {
  counter++;
  return {
    subject: `oidc-sub-${counter}`,
    email: `p${counter}@example.org`,
    preferredUsername: `pp${counter}`,
  };
};

export const isProblem = (reply: { res: Response }) =>
  (reply.res.headers.get('content-type') ?? '').startsWith('application/problem+json');

/** One stub provider per test file and an app over Postgres that knows it. */
export function useOidcApp() {
  const app = useIdentityApp();
  let current: StubIdp | undefined;
  beforeAll(async () => {
    current = await startStubIdp();
  });
  afterAll(async () => {
    await current?.stop();
  });
  const idp: StubIdp = new Proxy({} as StubIdp, {
    get: (_target, key) => Reflect.get(current!, key) as unknown,
    set: (_target, key, value) => Reflect.set(current!, key, value),
  });
  const startApp = async (options: Parameters<typeof app.start>[0] = {}) => {
    const started = await app.start({
      settings: oidcSettings(idp),
      clientSecret: () => idp.clientSecret,
      ...options,
    });
    return { ...started, web: browser(started, idp) };
  };
  return { app, idp, startApp };
}
