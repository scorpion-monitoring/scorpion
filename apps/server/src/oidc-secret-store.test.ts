// OIDC client secrets come from the secrets store of core.settings and nowhere else (M3 decision 4,
// ADR 0016): a stored secret is used for the code exchange, a provider without one is a public
// client, the start-up log names those providers, and the old environment variable has no effect.
import { makeSecret, makeSecretsKey } from '@scorpion/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { PROVIDER, person, useOidcApp } from './testing/oidc-flow.ts';

const { idp, startApp } = useOidcApp();
const SECRET_NAME = `oidc.${PROVIDER}.client-secret`;
const VARIABLE = `OIDC_${PROVIDER.toUpperCase()}_CLIENT_SECRET`;

afterEach(() => {
  delete process.env[VARIABLE];
});

/** The default lookup, which is the secrets store: the test helper's stand-in is switched off. */
const fromStore = { clientSecret: undefined };
const users = async (kernel: { pool: { query: (sql: string) => Promise<{ rows: unknown[] }> } }) =>
  (await kernel.pool.query('select 1 from identity_user')).rows.length;

describe('the client secret of a provider', () => {
  it('is read from the secrets store for the code exchange', async () => {
    const { web, kernel, settings } = await startApp(fromStore);
    await settings.secrets.setAsSystem(SECRET_NAME, idp.clientSecret);
    const { reply } = await web.login(person());
    expect(reply.status).toBe(403); // a new account waits for approval: the exchange itself worked
    expect(await users(kernel)).toBe(1);
  });

  it('is absent: the provider’s client is a public client and the exchange is refused with 502', async () => {
    const { web, kernel } = await startApp(fromStore);
    const { reply } = await web.login(person());
    expect(reply.status).toBe(502);
    expect(await users(kernel)).toBe(0);
  });

  it('is not read from OIDC_<ID>_CLIENT_SECRET any more, even when it holds the right value', async () => {
    process.env[VARIABLE] = idp.clientSecret;
    const { web, kernel } = await startApp(fromStore);
    const { reply } = await web.login(person());
    expect(reply.status).toBe(502);
    expect(await users(kernel)).toBe(0);
  });

  it('prefers nothing over the store: a wrong stored value fails whatever the variable holds', async () => {
    process.env[VARIABLE] = idp.clientSecret;
    const { web, settings } = await startApp(fromStore);
    await settings.secrets.setAsSystem(SECRET_NAME, 'not-the-secret');
    expect((await web.login(person())).reply.status).toBe(502);
  });

  it('that cannot be decrypted is an operator’s error: 500, and the log holds no value', async () => {
    const { web, kernel, logText } = await startApp(fromStore);
    // A row written under some other key: this process does not hold it.
    await makeSecret(kernel.pool, {
      name: SECRET_NAME,
      value: 'unreadable-secret-value',
      key: makeSecretsKey(),
    });
    const started = await web.start(); // the authorisation URL needs no secret
    const reply = await web.callback(await web.provider(started, person()), started);
    expect(reply.status).toBe(500);
    expect(await users(kernel)).toBe(0);
    expect(JSON.stringify(reply.body)).not.toContain('unreadable-secret-value');
    expect(logText()).toContain('unhandled error');
    expect(logText()).not.toContain('unreadable-secret-value');
  });

  it('is replaced by the next login after it is changed (no restart)', async () => {
    const { web, settings } = await startApp(fromStore);
    await settings.secrets.setAsSystem(SECRET_NAME, 'old-wrong-value');
    expect((await web.login(person())).reply.status).toBe(502);
    await settings.secrets.setAsSystem(SECRET_NAME, idp.clientSecret);
    expect((await web.login(person())).reply.status).toBe(403);
  });
});

describe('the start-up log', () => {
  it('names the providers without a stored secret, and holds no secret', async () => {
    const { logText } = await startApp(fromStore);
    const line = logText()
      .split('\n')
      .find((text) => text.includes('public clients'));
    expect(line).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({
      providers: [PROVIDER],
      secrets: [SECRET_NAME],
      module: 'core.identity',
    });
    expect(logText()).not.toContain(idp.clientSecret);
  });

  it('says nothing about a provider whose secret is stored', async () => {
    // Store the secret first, then start the module over the same database: the check runs at start-up.
    const first = await startApp(fromStore);
    await first.settings.secrets.setAsSystem(SECRET_NAME, idp.clientSecret);
    expect(first.logText()).toContain('public clients'); // it was not stored yet at that start
    const second = await startApp({
      ...fromStore,
      databaseUrl: first.databaseUrl,
      secretsKey: first.secretsKey,
    });
    expect(second.logText()).not.toContain('public clients');
    expect(second.logText()).not.toContain(idp.clientSecret);
  });
});
