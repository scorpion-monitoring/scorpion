import { Forbidden, Invalid, NotFound, Unauthorized } from '@scorpion/contracts';
import { makeSecret, makeSecretsKey } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { breakOutbox, useSettings } from '../test/harness.ts';
import { SecretDecryptError, decrypt, encrypt, parseKey } from './crypto.ts';
import type { SecretsInternals } from './secrets.ts';

const harness = useSettings();
const ANONYMOUS = { kind: 'anonymous' } as const;
const VALUE = 'client-secret-VALUE-9f3b2c';

async function setup(options: Parameters<typeof harness.start>[0] = {}) {
  const started = await harness.start(options);
  return {
    ...started,
    admin: await started.actorOf('admin'),
    member: await started.actorOf('user'),
    nobody: await started.actorOf(),
    service: started.settings.secrets,
  };
}

const rowsOf = async (pool: { query: (text: string) => Promise<{ rows: unknown[] }> }) =>
  (await pool.query('select name, key_id, ciphertext, nonce from settings_secret order by name'))
    .rows as { name: string; key_id: string; ciphertext: Buffer; nonce: Buffer }[];

describe('set, list, get and remove', () => {
  it('stores a value encrypted and gives it back to trusted code only', async () => {
    const { service, admin, kernel, secretsKey } = await setup();
    const status = await service.set(admin, 'oidc.keycloak.client-secret', VALUE);
    expect(status).toMatchObject({ name: 'oidc.keycloak.client-secret', set: true });
    expect(JSON.stringify(status)).not.toContain(VALUE);

    const [row] = await rowsOf(kernel.pool);
    expect(row!.key_id).toBe(parseKey(secretsKey)!.id);
    expect(row!.ciphertext.includes(Buffer.from(VALUE))).toBe(false);
    expect(row!.nonce).toHaveLength(12);
    expect(await service.getSecret('oidc.keycloak.client-secret')).toBe(VALUE);
    expect(await service.getSecret('no.such.secret')).toBeUndefined();
    expect(await kernel.services.get('core.settings')).toHaveProperty('getSecret');
  });

  it('replaces a value under a new nonce, keeping one row', async () => {
    const { service, admin, kernel } = await setup();
    await service.set(admin, 'a.b', 'first');
    const [before] = await rowsOf(kernel.pool);
    await service.set(admin, 'a.b', 'second');
    const after = await rowsOf(kernel.pool);
    expect(after).toHaveLength(1);
    expect(after[0]!.nonce.equals(before!.nonce)).toBe(false);
    expect(await service.getSecret('a.b')).toBe('second');
  });

  it('lists names and when they were set, never a value, to a holder of core.settings.read', async () => {
    const { service, admin, kernel, secretsKey } = await setup();
    await service.set(admin, 'b.two', VALUE);
    await makeSecret(kernel.pool, { name: 'a.one', key: secretsKey });
    const listed = await service.list(admin);
    expect(listed.map((entry) => entry.name)).toEqual(['a.one', 'b.two']);
    expect(listed.every((entry) => entry.set === true)).toBe(true);
    expect(JSON.stringify(listed)).not.toContain(VALUE);
    expect(Object.keys(listed[0]!).sort()).toEqual(['name', 'set', 'updatedAt']);
  });

  it('removes a secret, and answers 404 for one that is not there', async () => {
    const { service, admin } = await setup();
    await service.set(admin, 'a.b', VALUE);
    await service.remove(admin, 'a.b');
    expect(await service.getSecret('a.b')).toBeUndefined();
    await expect(service.remove(admin, 'a.b')).rejects.toBeInstanceOf(NotFound);
  });

  it.each([
    ['an empty name', '', VALUE, 'name'],
    ['a name with upper case', 'Oidc.Key', VALUE, 'name'],
    ['a name starting with a digit', '1abc', VALUE, 'name'],
    ['a name with a space', 'a b', VALUE, 'name'],
    ['a name that is too long', `a${'b'.repeat(128)}`, VALUE, 'name'],
    ['an empty value', 'a.b', '', 'value'],
    ['a value that is too long', 'a.b', 'x'.repeat(4097), 'value'],
  ])('rejects %s with 422 and stores nothing', async (_n, name, value, path) => {
    const { service, admin, kernel } = await setup();
    const failure = await service.set(admin, name, value).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Invalid);
    expect((failure as Invalid).errors?.[0]?.path).toBe(path);
    expect(JSON.stringify(failure)).not.toContain('xxxx');
    expect(await rowsOf(kernel.pool)).toEqual([]);
  });

  it('keeps the value out of the events, the log and every error', async () => {
    const { service, admin, kernel, logs, secretsKey } = await setup();
    await service.set(admin, 'a.b', VALUE);
    await service.set(admin, 'a.b', `${VALUE}-2`);
    await service.remove(admin, 'a.b');
    const emitted = JSON.stringify(
      (await kernel.pool.query('select name, payload from kernel_outbox')).rows,
    );
    expect(emitted).toContain('settings.secret.changed@1');
    expect(emitted).toContain('"name":"a.b"');
    expect(emitted).not.toContain(VALUE);
    const everything = logs.join('');
    expect(everything).not.toContain(VALUE);
    expect(everything).not.toContain(secretsKey);
    expect(everything).not.toContain(parseKey(secretsKey)!.id);
  });
});

describe('permissions', () => {
  it('denies every method to a user without the permission (403) and to anonymous (401)', async () => {
    const { service, admin, member, nobody, kernel } = await setup();
    await service.set(admin, 'a.b', VALUE);
    for (const actor of [member, nobody]) {
      await expect(service.list(actor)).rejects.toBeInstanceOf(Forbidden);
      await expect(service.set(actor, 'c.d', VALUE)).rejects.toBeInstanceOf(Forbidden);
      await expect(service.remove(actor, 'a.b')).rejects.toBeInstanceOf(Forbidden);
    }
    await expect(service.list(ANONYMOUS)).rejects.toBeInstanceOf(Unauthorized);
    await expect(service.set(ANONYMOUS, 'c.d', VALUE)).rejects.toBeInstanceOf(Unauthorized);
    await expect(service.remove(ANONYMOUS, 'a.b')).rejects.toBeInstanceOf(Unauthorized);
    expect((await rowsOf(kernel.pool)).map((row) => row.name)).toEqual(['a.b']);
  });

  it('separates reading from writing: a role with core.settings.read lists and cannot change', async () => {
    const { service, authz, admin, actorOf } = await setup();
    await authz.setRolePermissions(admin, 'reviewer', ['core.settings.read']);
    const reviewer = await actorOf('reviewer');
    await service.set(admin, 'a.b', VALUE);
    expect((await service.list(reviewer)).map((entry) => entry.name)).toEqual(['a.b']);
    await expect(service.set(reviewer, 'c.d', VALUE)).rejects.toBeInstanceOf(Forbidden);
    await expect(service.remove(reviewer, 'a.b')).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('rollback', () => {
  it('stores nothing when the event cannot be written, for a set and for a remove', async () => {
    const { service, admin, kernel } = await setup();
    await service.set(admin, 'a.b', 'first');
    const restore = await breakOutbox(kernel.pool);
    await expect(service.set(admin, 'a.b', 'second')).rejects.toThrow();
    await expect(service.set(admin, 'c.d', 'new')).rejects.toThrow();
    await expect(service.remove(admin, 'a.b')).rejects.toThrow();
    await restore();
    expect(await service.getSecret('a.b')).toBe('first');
    expect(await service.getSecret('c.d')).toBeUndefined();
  });
});

describe('what a stored row can and cannot do', () => {
  it('does not decrypt a row copied under another name', async () => {
    const { service, kernel, secretsKey } = await setup();
    const made = await makeSecret(kernel.pool, { name: 'a.b', value: VALUE, key: secretsKey });
    await kernel.pool.query("update settings_secret set name = 'c.d' where id = $1", [made.id]);
    await expect(service.getSecret('c.d')).rejects.toBeInstanceOf(SecretDecryptError);
  });

  it('reads rows made by the factory, so the factory and the module agree on the format', async () => {
    const { service, kernel, secretsKey } = await setup();
    const made = await makeSecret(kernel.pool, { name: 'f.g', value: VALUE, key: secretsKey });
    expect(await service.getSecret('f.g')).toBe(VALUE);
    expect(made.key_id).toBe(parseKey(secretsKey)!.id);
  });

  it('fails clearly, and without a key id, for a row of a key it does not hold', async () => {
    const { service, kernel } = await setup();
    await makeSecret(kernel.pool, { name: 'x.y', value: VALUE, key: makeSecretsKey() });
    const failure = await service.getSecret('x.y').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    const [row] = await rowsOf(kernel.pool);
    expect((failure as Error).message).toContain('"x.y"');
    expect((failure as Error).message).not.toContain(row!.key_id);
    expect((failure as Error).message).not.toContain(VALUE);
  });
});

describe('rotation', () => {
  const OLD = makeSecretsKey();
  const NEW = makeSecretsKey();

  async function rotating(count = 5, extra: Parameters<typeof harness.start>[0] = {}) {
    // Rows written under the old key, then a kernel that holds both keys.
    const first = await harness.start({ secretsKey: OLD });
    const pool = first.kernel.pool;
    const names: Record<string, string> = {};
    for (let i = 0; i < count; i += 1) {
      const made = await makeSecret(pool, { name: `s.n${i}`, value: `value-${i}`, key: OLD });
      names[made.name] = made.value;
    }
    const started = await setup({
      databaseUrl: first.databaseUrl,
      secretsKey: OLD,
      secretsKeyNext: NEW,
      ...extra,
    });
    return { ...started, names };
  }

  it('moves every row to the next key, in batches, and every value still reads', async () => {
    const { service, kernel, names } = await rotating(5);
    const report = await service.rotate({ batchSize: 2 });
    expect(report).toEqual({ rotated: 5, remaining: 0 });
    const newId = parseKey(NEW)!.id;
    expect((await rowsOf(kernel.pool)).every((row) => row.key_id === newId)).toBe(true);
    for (const [name, value] of Object.entries(names))
      expect(await service.getSecret(name)).toBe(value);
  });

  it('keeps old-key rows readable while the run is in progress', async () => {
    const { service, kernel, names } = await rotating(5);
    const seen: { old: number; moved: number }[] = [];
    await service.rotate({
      batchSize: 2,
      afterBatch: async () => {
        const rows = await rowsOf(kernel.pool);
        const newId = parseKey(NEW)!.id;
        seen.push({
          old: rows.filter((row) => row.key_id !== newId).length,
          moved: rows.filter((row) => row.key_id === newId).length,
        });
        for (const [name, value] of Object.entries(names))
          expect(await service.getSecret(name)).toBe(value);
      },
    });
    expect(seen).toEqual([
      { old: 3, moved: 2 },
      { old: 1, moved: 4 },
      { old: 0, moved: 5 },
    ]);
  });

  it('writes new values under the next key while a rotation is configured', async () => {
    const { service, admin, kernel } = await rotating(1);
    await service.set(admin, 'fresh.one', 'v');
    const row = (await rowsOf(kernel.pool)).find((r) => r.name === 'fresh.one');
    expect(row!.key_id).toBe(parseKey(NEW)!.id);
    expect(await service.countOffKey()).toBe(1);
  });

  it('is resumable: a second run takes what the first left, and a third has nothing to do', async () => {
    const { service, names } = await rotating(4);
    let batches = 0;
    await expect(
      service.rotate({
        batchSize: 1,
        afterBatch: () => {
          batches += 1;
          if (batches === 2) throw new Error('stopped by the test');
        },
      }),
    ).rejects.toThrow('stopped by the test');
    expect(await service.countOffKey()).toBe(2);
    expect(await service.rotate({ batchSize: 1 })).toEqual({ rotated: 2, remaining: 0 });
    expect(await service.rotate()).toEqual({ rotated: 0, remaining: 0 });
    for (const [name, value] of Object.entries(names))
      expect(await service.getSecret(name)).toBe(value);
  });

  it('stops at a row it cannot decrypt, leaves every other row readable, and names no value', async () => {
    const { service, kernel, names } = await rotating(3);
    const stranger = await makeSecret(kernel.pool, {
      name: 's.zz',
      value: 'lost',
      key: makeSecretsKey(),
    });
    const failure = await service.rotate({ batchSize: 1 }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String((failure as Error).message)).toContain('"s.zz"');
    expect(String((failure as Error).message)).not.toContain('lost');
    // Every row except the one that was never readable decrypts, whichever key it is on.
    for (const [name, value] of Object.entries(names))
      expect(await service.getSecret(name)).toBe(value);
    await expect(service.getSecret(stranger.name)).rejects.toThrow();
    // Once the stranger is gone, the rest completes.
    await kernel.pool.query("delete from settings_secret where name = 's.zz'");
    expect((await service.rotate()).remaining).toBe(0);
  });

  it('verifies before it commits: a new ciphertext that does not read back changes nothing', async () => {
    const broken = {
      encrypt: (key: Parameters<typeof encrypt>[0], name: string, plaintext: string) => {
        const sealed = encrypt(key, name, plaintext);
        sealed.ciphertext[0] = sealed.ciphertext[0]! ^ 0xff; // corrupt it
        return sealed;
      },
      decrypt,
    };
    const { service, kernel, names } = await rotating(3, { cipher: broken });
    const before = await rowsOf(kernel.pool);
    await expect(service.rotate({ batchSize: 2 })).rejects.toBeInstanceOf(SecretDecryptError);
    expect(await rowsOf(kernel.pool)).toEqual(before); // nothing moved, nothing damaged
    for (const [name, value] of Object.entries(names)) {
      // reads with the (healthy) old key on the unchanged rows; the factory made them under OLD
      expect(await service.getSecret(name)).toBe(value);
    }
  });

  it('refuses to run without SECRETS_KEY_NEXT, and says what to set', async () => {
    const { service } = await setup();
    await expect(service.rotate()).rejects.toThrow(/SECRETS_KEY_NEXT/);
  });

  it('refuses a bad batch size', async () => {
    const { service } = await rotating(1);
    for (const batchSize of [0, -1, 1.5, Number.NaN]) {
      await expect(service.rotate({ batchSize })).rejects.toThrow(/batch size/);
    }
  });
});

describe('starting', () => {
  it('refuses to start without a key, and says how to make one', async () => {
    await expect(harness.start({ secretsKey: null })).rejects.toThrowError(
      /Cannot start core\.settings:[\s\S]*SECRETS_KEY is not set[\s\S]*openssl rand -base64 32/,
    );
  });

  it('refuses a key of the wrong size without echoing it', async () => {
    const bad = 'c2hvcnQ=';
    const failure = await harness.start({ secretsKey: bad }).catch((error: unknown) => error);
    expect((failure as Error).message).toMatch(/SECRETS_KEY is not valid/);
    expect((failure as Error).message).not.toContain(bad);
  });

  it('starts with a key and a next key, and writes with the next', async () => {
    const started = await setup({ secretsKeyNext: makeSecretsKey() });
    const secrets: SecretsInternals = started.service;
    await secrets.set(started.admin, 'a.b', VALUE);
    expect(await secrets.countOffKey()).toBe(0);
  });
});
