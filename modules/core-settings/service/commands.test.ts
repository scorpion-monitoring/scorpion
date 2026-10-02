import type { CommandIo } from '@scorpion/kernel';
import { makeSecret, makeSecretsKey } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useSettings } from '../test/harness.ts';
import { parseKey } from './crypto.ts';

const harness = useSettings();
const VALUE = 'cli-secret-VALUE-77ab';

function terminal(answer = VALUE) {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const io: CommandIo = {
    out: (text) => void out.push(text),
    err: (text) => void err.push(text),
    readSecret: (prompt) => {
      asked.push(prompt);
      return Promise.resolve(answer);
    },
  };
  return { io, out, err, asked, all: () => [...out, ...err, ...asked].join('\n') };
}

describe('scorpion set-secret', () => {
  it('asks for the value, stores it encrypted and prints only the name', async () => {
    const { kernel, settings } = await harness.start();
    const t = terminal();
    expect(await kernel.runCommand('set-secret', ['oidc.keycloak.client-secret'], t.io)).toBe(0);
    expect(t.asked).toEqual(['Value: ']);
    expect(t.out).toEqual(['Stored the secret "oidc.keycloak.client-secret".']);
    expect(t.all()).not.toContain(VALUE);
    expect(await settings.secrets.getSecret('oidc.keycloak.client-secret')).toBe(VALUE);
  });

  it('replaces an existing secret and emits an event with the name only', async () => {
    const { kernel } = await harness.start();
    await kernel.runCommand('set-secret', ['a.b'], terminal('first').io);
    await kernel.runCommand('set-secret', ['a.b'], terminal('second').io);
    const rows = (await kernel.pool.query('select count(*)::int as n from settings_secret')).rows;
    expect(rows).toEqual([{ n: 1 }]);
    const events = JSON.stringify(
      (
        await kernel.pool.query(
          "select payload from kernel_outbox where name = 'settings.secret.changed@1'",
        )
      ).rows,
    );
    expect(events).toContain('"name":"a.b"');
    expect(events).not.toContain('first');
    expect(events).not.toContain('second');
  });

  it.each([
    ['no name', []],
    ['two names', ['a.b', 'c.d']],
    ['a value on the command line', ['--value=hunter2']],
    ['a flag', ['-x']],
  ])('refuses %s with the usage and never takes a value from argv', async (_n, args) => {
    const { kernel } = await harness.start();
    const t = terminal();
    expect(await kernel.runCommand('set-secret', args, t.io)).toBe(2);
    expect(t.err.join('\n')).toMatch(/Usage: scorpion set-secret <name>/);
    expect(t.asked).toEqual([]);
    expect(t.all()).not.toContain('hunter2');
  });

  it.each([
    ['a bad name', 'Bad Name', VALUE, /name is not valid/],
    ['an empty value', 'a.b', '', /Nothing was stored/],
    ['a value that is too long', 'a.b', 'x'.repeat(5000), /Nothing was stored/],
  ])('refuses %s and stores nothing', async (_n, name, answer, message) => {
    const { kernel } = await harness.start();
    const t = terminal(answer);
    expect(await kernel.runCommand('set-secret', [name], t.io)).toBe(2);
    expect(t.err.join('\n')).toMatch(message);
    expect((await kernel.pool.query('select 1 from settings_secret')).rows).toEqual([]);
  });

  it('is a command of the module, listed without touching the database', async () => {
    const { kernel } = await harness.start();
    expect(kernel.commands.filter((c) => c.module === 'core.settings').map((c) => c.name)).toEqual([
      'set-secret',
      'rotate-secrets',
    ]);
  });
});

describe('scorpion rotate-secrets', () => {
  it('explains what to set when there is no next key', async () => {
    const { kernel } = await harness.start();
    const t = terminal();
    expect(await kernel.runCommand('rotate-secrets', [], t.io)).toBe(1);
    expect(t.err.join('\n')).toMatch(/SECRETS_KEY_NEXT/);
  });

  it('re-encrypts everything, prints counts and the steps that follow, and never a value', async () => {
    const oldKey = makeSecretsKey();
    const newKey = makeSecretsKey();
    const first = await harness.start({ secretsKey: oldKey });
    const made = [];
    for (let i = 0; i < 3; i += 1) {
      made.push(await makeSecret(first.kernel.pool, { name: `s.n${i}`, key: oldKey }));
    }
    const { kernel, settings } = await harness.start({
      databaseUrl: first.databaseUrl,
      secretsKey: oldKey,
      secretsKeyNext: newKey,
    });
    const t = terminal();
    expect(await kernel.runCommand('rotate-secrets', ['--batch-size', '2'], t.io)).toBe(0);
    expect(t.out[0]).toBe('Re-encrypted 3 secret(s); 0 remain on another key.');
    expect(t.out.join('\n')).toMatch(/set SECRETS_KEY to the value of SECRETS_KEY_NEXT/);
    for (const m of made) {
      expect(t.all()).not.toContain(m.value);
      expect(await settings.secrets.getSecret(m.name)).toBe(m.value);
    }
    const rows = (await kernel.pool.query('select distinct key_id from settings_secret')).rows;
    expect(rows).toEqual([{ key_id: parseKey(newKey)!.id }]);
    // A second run has nothing to do.
    const again = terminal();
    expect(await kernel.runCommand('rotate-secrets', [], again.io)).toBe(0);
    expect(again.out[0]).toMatch(/Nothing to rotate/);
  });

  it('reports a failure without a value and says nothing was lost', async () => {
    const oldKey = makeSecretsKey();
    const first = await harness.start({ secretsKey: oldKey });
    await makeSecret(first.kernel.pool, {
      name: 's.lost',
      value: 'unreadable-value',
      key: makeSecretsKey(),
    });
    const { kernel } = await harness.start({
      databaseUrl: first.databaseUrl,
      secretsKey: oldKey,
      secretsKeyNext: makeSecretsKey(),
    });
    const t = terminal();
    expect(await kernel.runCommand('rotate-secrets', [], t.io)).toBe(1);
    expect(t.err.join('\n')).toMatch(/Rotation stopped:.*"s\.lost"/);
    expect(t.err.join('\n')).toMatch(/Nothing was lost/);
    expect(t.all()).not.toContain('unreadable-value');
  });

  it.each([
    ['--batch-size'],
    ['--batch-size', '0'],
    ['--batch-size', 'abc'],
    ['--unknown'],
    ['extra'],
  ])('refuses the arguments %j with the usage', async (...args) => {
    const { kernel } = await harness.start();
    const t = terminal();
    expect(await kernel.runCommand('rotate-secrets', args, t.io)).toBe(2);
    expect(t.err.join('\n')).toMatch(/Usage: scorpion rotate-secrets/);
  });
});
