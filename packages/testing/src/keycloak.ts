// A Keycloak container with one realm, for the OIDC test that must run against a real provider.
// One container per test file: it needs about 15 to 40 seconds to start, so only the start is retried.
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

/** Pinned: a moving tag would change the provider under the test. */
export const KEYCLOAK_IMAGE = 'quay.io/keycloak/keycloak:26.0.8';
export const KEYCLOAK_REALM = 'scorpion';
export const KEYCLOAK_CLIENT_ID = 'scorpion';
export const KEYCLOAK_CLIENT_SECRET = 'keycloak-test-client-secret';
/** A client whose id_tokens name another audience: what a token meant for someone else looks like. */
export const KEYCLOAK_WRONG_AUDIENCE_CLIENT_ID = 'scorpion-wrong-audience';

export interface KeycloakUser {
  username: string;
  password: string;
  email: string;
  emailVerified: boolean;
}

/** `alice` has a verified address, `mallory` has the same kind of account with an unverified one. */
export const KEYCLOAK_USERS: Record<'alice' | 'mallory', KeycloakUser> = {
  alice: {
    username: 'alice',
    password: 'alice-password',
    email: 'alice@example.org',
    emailVerified: true,
  },
  mallory: {
    username: 'mallory',
    password: 'mallory-password',
    email: 'mallory@example.org',
    emailVerified: false,
  },
};

function client(clientId: string, redirectUri: string, extra: object = {}) {
  return {
    clientId,
    enabled: true,
    protocol: 'openid-connect',
    publicClient: false,
    secret: KEYCLOAK_CLIENT_SECRET,
    standardFlowEnabled: true,
    directAccessGrantsEnabled: false,
    redirectUris: [redirectUri],
    // Keycloak itself refuses a login without a PKCE S256 challenge.
    attributes: { 'pkce.code.challenge.method': 'S256' },
    ...extra,
  };
}

function realm(redirectUri: string) {
  return {
    realm: KEYCLOAK_REALM,
    enabled: true,
    sslRequired: 'none',
    registrationAllowed: false,
    clients: [
      client(KEYCLOAK_CLIENT_ID, redirectUri),
      client(KEYCLOAK_WRONG_AUDIENCE_CLIENT_ID, redirectUri, {
        protocolMappers: [
          {
            name: 'someone-elses-audience',
            protocol: 'openid-connect',
            protocolMapper: 'oidc-hardcoded-claim-mapper',
            config: {
              'claim.name': 'aud',
              'claim.value': 'someone-else',
              'jsonType.label': 'String',
              'id.token.claim': 'true',
              'access.token.claim': 'false',
              'userinfo.token.claim': 'false',
            },
          },
        ],
      }),
    ],
    users: Object.values(KEYCLOAK_USERS).map((user) => ({
      username: user.username,
      enabled: true,
      email: user.email,
      emailVerified: user.emailVerified,
      firstName: user.username,
      lastName: 'Tester',
      credentials: [{ type: 'password', value: user.password, temporary: false }],
    })),
  };
}

export interface StartedKeycloak {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /**
   * Plays the browser at Keycloak's login page: opens the authorisation URL, submits the form
   * and returns where Keycloak sends the browser back (the callback URL with `code` and `state`).
   */
  authorize(authorizationUrl: string, user: KeycloakUser): Promise<URL>;
  /**
   * One browser that keeps its cookies between requests, so Keycloak's single sign-on session
   * survives from one `authorize` to the next. Without `prompt=login` or `max_age` Keycloak then
   * answers at once, without showing the form; `formsShown` counts the times it did show it.
   */
  browser(): { authorize: StartedKeycloak['authorize']; readonly formsShown: number };
  stop(): Promise<void>;
}

class Jar {
  private readonly cookies = new Map<string, string>();
  keep(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = pair!.indexOf('=');
      this.cookies.set(pair!.slice(0, eq), pair!.slice(eq + 1));
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

/**
 * Opens the authorisation URL in the browser that holds `jar`. With a single sign-on session
 * Keycloak may answer with the redirect straight away; otherwise it shows the login form, which is
 * submitted here.
 */
async function login(jar: Jar, authorizationUrl: string, user: KeycloakUser) {
  const page = await fetch(authorizationUrl, {
    redirect: 'manual',
    headers: { cookie: jar.header() },
  });
  jar.keep(page);
  const direct = page.headers.get('location');
  if (page.status === 302 && direct && new URL(direct).searchParams.has('code')) {
    return { back: new URL(direct), formShown: false };
  }
  const html = await page.text();
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(html)?.[1];
  if (!action) throw new Error(`no login form (status ${page.status})`);
  const submitted = await fetch(action.replaceAll('&amp;', '&'), {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
    body: new URLSearchParams({ username: user.username, password: user.password }),
  });
  jar.keep(submitted);
  const location = submitted.headers.get('location');
  if (submitted.status !== 302 || !location) {
    throw new Error(`login was not accepted (status ${submitted.status})`);
  }
  return { back: new URL(location), formShown: true };
}

export async function startKeycloak(options: { redirectUri: string }): Promise<StartedKeycloak> {
  const content = JSON.stringify(realm(options.redirectUri));
  let container: StartedTestContainer | undefined;
  for (let attempt = 1; container === undefined; attempt++) {
    try {
      container = await new GenericContainer(KEYCLOAK_IMAGE)
        .withExposedPorts(8080)
        .withEnvironment({ KC_HOSTNAME_STRICT: 'false', KC_HTTP_ENABLED: 'true' })
        .withCopyContentToContainer([
          { content, target: '/opt/keycloak/data/import/realm.json', mode: 0o644 },
        ])
        .withCommand(['start-dev', '--import-realm'])
        .withWaitStrategy(
          Wait.forHttp(`/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration`, 8080),
        )
        .withStartupTimeout(240_000)
        .start();
    } catch (error) {
      if (attempt >= 2) throw error; // only the container start is retried
    }
  }
  const started = container;
  const issuer = `http://${started.getHost()}:${started.getMappedPort(8080)}/realms/${KEYCLOAK_REALM}`;

  return {
    issuer,
    clientId: KEYCLOAK_CLIENT_ID,
    clientSecret: KEYCLOAK_CLIENT_SECRET,
    authorize: (authorizationUrl, user) =>
      login(new Jar(), authorizationUrl, user).then((r) => r.back),
    browser() {
      const jar = new Jar();
      let formsShown = 0;
      return {
        async authorize(authorizationUrl, user) {
          const done = await login(jar, authorizationUrl, user);
          if (done.formShown) formsShown++;
          return done.back;
        },
        get formsShown() {
          return formsShown;
        },
      };
    },
    stop: async () => {
      await started.stop();
    },
  };
}
