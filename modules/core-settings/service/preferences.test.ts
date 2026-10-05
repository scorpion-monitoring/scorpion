import { Forbidden, Invalid, NotFound, Unauthorized } from '@scorpion/contracts';
import { makePreference } from '@scorpion/testing';
import { defineModule } from '@scorpion/kernel';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { breakOutbox, useSettings } from '../test/harness.ts';

const harness = useSettings();
const ANONYMOUS = { kind: 'anonymous' } as const;

async function setup(options: Parameters<typeof harness.start>[0] = {}) {
  const started = await harness.start(options);
  return {
    ...started,
    alice: await started.actorOf('user'),
    bob: await started.actorOf('user'),
    nobody: await started.actorOf(),
    service: started.settings.preferences,
  };
}

const preferenceEvents = async (pool: { query: (text: string) => Promise<{ rows: unknown[] }> }) =>
  (
    await pool.query(
      "select payload from kernel_outbox where name = 'settings.preference.changed@1' order by occurred_at, id",
    )
  ).rows.map((row) => (row as { payload: unknown }).payload);

describe('set and list', () => {
  it('stores a preference of the caller, validated by the schema the module registered', async () => {
    const { service, alice } = await setup();
    const stored = await service.set(alice, 'fix.widgets.theme', 'dark');
    expect(stored).toMatchObject({ key: 'fix.widgets.theme', value: 'dark' });
    await service.set(alice, 'fix.widgets.layout', { columns: 3 });
    expect(await service.list(alice)).toMatchObject([
      { key: 'fix.widgets.layout', value: { columns: 3 } },
      { key: 'fix.widgets.theme', value: 'dark' },
    ]);
  });

  it('replaces the value of a key and keeps one row', async () => {
    const { service, alice, kernel } = await setup();
    await service.set(alice, 'fix.widgets.theme', 'dark');
    await service.set(alice, 'fix.widgets.theme', 'light');
    expect(await service.list(alice)).toMatchObject([{ value: 'light' }]);
    expect((await kernel.pool.query('select 1 from settings_user_preference')).rows).toHaveLength(
      1,
    );
  });

  it('keeps preferences apart: a caller sees and changes only their own', async () => {
    const { service, alice, bob } = await setup();
    await service.set(alice, 'fix.widgets.theme', 'dark');
    expect(await service.list(bob)).toEqual([]);
    await service.set(bob, 'fix.widgets.theme', 'light');
    await service.remove(bob, 'fix.widgets.theme');
    expect(await service.list(alice)).toMatchObject([{ value: 'dark' }]);
    expect(await service.list(bob)).toEqual([]);
  });

  it('hides a stored preference whose registration is gone', async () => {
    const { service, alice, kernel } = await setup();
    await makePreference(kernel.pool, { id: alice.userId }, 'gone.module.setting', 'x');
    expect(await service.list(alice)).toEqual([]);
  });

  it.each([
    ['a value the schema rejects', 'fix.widgets.theme', 'purple', 'value'],
    ['a value of the wrong type', 'fix.widgets.layout', { columns: 'many' }, 'value.columns'],
    ['an unknown field', 'fix.widgets.layout', { columns: 2, extra: 1 }, 'value'],
    ['null', 'fix.widgets.nullable', null, 'value'],
    ['a value that is too large', 'fix.widgets.note', 'x'.repeat(9_000), 'value'],
  ])('rejects %s with 422 and stores nothing', async (_n, key, value, path) => {
    const { service, alice, kernel } = await setup();
    const failure = await service.set(alice, key, value).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Invalid);
    expect((failure as Invalid).errors?.map((e) => e.path)).toContain(path);
    expect((await kernel.pool.query('select 1 from settings_user_preference')).rows).toEqual([]);
  });

  it('answers 404 for a key no module registered, for set and remove', async () => {
    const { service, alice } = await setup();
    await expect(service.set(alice, 'nobody.registered.this', 1)).rejects.toBeInstanceOf(NotFound);
    await expect(service.remove(alice, 'nobody.registered.this')).rejects.toBeInstanceOf(NotFound);
  });
});

describe('remove', () => {
  it('returns to the default, also when nothing was stored, and emits only for a real removal', async () => {
    const { service, alice, kernel } = await setup();
    await service.set(alice, 'fix.widgets.theme', 'dark');
    await service.remove(alice, 'fix.widgets.theme');
    await service.remove(alice, 'fix.widgets.theme');
    expect(await service.list(alice)).toEqual([]);
    expect(await preferenceEvents(kernel.pool)).toEqual([
      { userId: alice.userId, key: 'fix.widgets.theme', removed: false },
      { userId: alice.userId, key: 'fix.widgets.theme', removed: true },
    ]);
  });
});

describe('events', () => {
  it('say which preference of which user, never the value', async () => {
    const { service, alice, kernel } = await setup();
    await service.set(alice, 'fix.widgets.note', 'my-private-note-123');
    const emitted = JSON.stringify(await preferenceEvents(kernel.pool));
    expect(emitted).toContain('fix.widgets.note');
    expect(emitted).not.toContain('my-private-note-123');
  });
});

describe('permissions', () => {
  it('are held by the role user by default, and by Admin', async () => {
    const { service, actorOf } = await setup();
    for (const role of ['user', 'admin']) {
      const actor = await actorOf(role);
      await expect(service.set(actor, 'fix.widgets.theme', 'dark')).resolves.toBeDefined();
      await expect(service.list(actor)).resolves.toHaveLength(1);
    }
  });

  it('are denied to a user without them (403) and to anonymous (401), and store nothing', async () => {
    const { service, nobody, alice, kernel } = await setup();
    await service.set(alice, 'fix.widgets.theme', 'dark');
    await expect(service.list(nobody)).rejects.toBeInstanceOf(Forbidden);
    await expect(service.set(nobody, 'fix.widgets.theme', 'dark')).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(service.remove(nobody, 'fix.widgets.theme')).rejects.toBeInstanceOf(Forbidden);
    await expect(service.list(ANONYMOUS)).rejects.toBeInstanceOf(Unauthorized);
    await expect(service.set(ANONYMOUS, 'fix.widgets.theme', 'dark')).rejects.toBeInstanceOf(
      Unauthorized,
    );
    await expect(service.remove(ANONYMOUS, 'fix.widgets.theme')).rejects.toBeInstanceOf(
      Unauthorized,
    );
    expect((await kernel.pool.query('select 1 from settings_user_preference')).rows).toHaveLength(
      1,
    );
  });

  it('can be taken from the role user by an administrator', async () => {
    const { service, authz, actorOf, alice } = await setup();
    const admin = await actorOf('admin');
    await authz.setRolePermissions(admin, 'user', []);
    await expect(service.set(alice, 'fix.widgets.theme', 'dark')).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('rollback', () => {
  it('stores nothing when the event cannot be written, and keeps the old value on a replace', async () => {
    const { service, alice, kernel } = await setup();
    await service.set(alice, 'fix.widgets.theme', 'dark');
    const restore = await breakOutbox(kernel.pool);
    await expect(service.set(alice, 'fix.widgets.theme', 'light')).rejects.toThrow();
    await expect(service.set(alice, 'fix.widgets.layout', { columns: 2 })).rejects.toThrow();
    await expect(service.remove(alice, 'fix.widgets.theme')).rejects.toThrow();
    await restore();
    expect(await service.list(alice)).toMatchObject([{ key: 'fix.widgets.theme', value: 'dark' }]);
  });
});

describe('registration', () => {
  it('stops the start-up when two modules register the same key', async () => {
    const clash = {
      id: 'fix.clash',
      manifest: defineModule({
        id: 'fix.clash',
        version: '1.0.0',
        contributes: {
          'settings.userPreference': [
            { key: 'fix.widgets.theme', description: 'Again', schema: z.string() },
          ],
        },
      }),
    };
    const { widgetsModule } = await import('../test/harness.ts');
    await expect(harness.start({ modules: [widgetsModule(), clash] })).rejects.toThrowError(
      /user preference "fix\.widgets\.theme" is registered twice/,
    );
  });

  it('stops the start-up for a key that is not dot-separated lower case', async () => {
    const bad = {
      id: 'fix.bad',
      manifest: defineModule({
        id: 'fix.bad',
        version: '1.0.0',
        contributes: {
          'settings.userPreference': [{ key: 'NotAKey', description: 'x', schema: z.string() }],
        },
      }),
    };
    await expect(harness.start({ modules: [bad] })).rejects.toThrowError(
      /registry "settings.userPreference" entry 0.key/,
    );
  });
});

describe('getForUser (trusted code, no human caller)', () => {
  it('returns the stored value of another user, validated, and undefined when nothing is stored', async () => {
    const { service, alice, bob } = await setup();
    await service.set(alice, 'fix.widgets.theme', 'dark');
    expect(await service.getForUser(alice.userId, 'fix.widgets.theme')).toBe('dark');
    expect(await service.getForUser(bob.userId, 'fix.widgets.theme')).toBeUndefined();
  });

  it('answers undefined for an unregistered key, a malformed id and a stored value that no longer fits', async () => {
    const { service, alice, kernel } = await setup();
    await makePreference(kernel.pool, { id: alice.userId }, 'gone.module.setting', 'x');
    await makePreference(kernel.pool, { id: alice.userId }, 'fix.widgets.theme', 'purple');
    expect(await service.getForUser(alice.userId, 'gone.module.setting')).toBeUndefined();
    expect(await service.getForUser('not-a-uuid', 'fix.widgets.theme')).toBeUndefined();
    expect(await service.getForUser(alice.userId, 'fix.widgets.theme')).toBeUndefined();
  });
});
