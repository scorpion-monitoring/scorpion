import {
  Conflict,
  Forbidden,
  Invalid,
  NotFound,
  Unauthorized,
  type Actor,
} from '@scorpion/contracts';
import { makeSetting } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { breakOutbox, useSettings } from '../test/harness.ts';
import { changedKeys, type SettingsInternals } from './settings.ts';

const harness = useSettings();
const ANONYMOUS = { kind: 'anonymous' } as const;

async function setup(options: Parameters<typeof harness.start>[0] = {}) {
  const started = await harness.start(options);
  return {
    ...started,
    admin: await started.actorOf('admin'),
    member: await started.actorOf('user'),
    nobody: await started.actorOf(),
    service: started.settings.settings,
  };
}

const events = async (pool: { query: (text: string) => Promise<{ rows: unknown[] }> }) =>
  (await pool.query("select name, payload from kernel_outbox where name = 'settings.changed@1'"))
    .rows as { name: string; payload: Record<string, unknown> }[];

const userIdOf = (actor: { kind: string; userId?: string }) => actor.userId;

describe('changedKeys', () => {
  it.each([
    ['nothing', {}, {}, []],
    ['no stored value', undefined, { a: 1 }, ['a']],
    ['an added key', { a: 1 }, { a: 1, b: 2 }, ['b']],
    ['a removed key', { a: 1, b: 2 }, { a: 1 }, ['b']],
    ['a changed key', { a: 1, b: 2 }, { a: 1, b: 3 }, ['b']],
    ['a deep change', { a: { x: [1, 2] } }, { a: { x: [1, 3] } }, ['a']],
    ['equal deep values', { a: { x: [1, 2] } }, { a: { x: [1, 2] } }, []],
    ['sorted', { z: 1, a: 1 }, { z: 2, a: 2 }, ['a', 'z']],
  ])('%s', (_name, before, after, expected) => {
    expect(changedKeys(before, after)).toEqual(expected);
  });
});

describe('list and get', () => {
  it('lists every module that has settings, with defaults applied and version 0', async () => {
    const { service, admin } = await setup();
    const all = await service.list(admin);
    expect(all.map((entry) => entry.module)).toEqual(['core.settings', 'fix.widgets']);
    const widgets = all.find((entry) => entry.module === 'fix.widgets')!;
    expect(widgets).toMatchObject({
      version: 0,
      values: { limit: 3, label: 'plain', nested: { on: false } },
      updatedAt: null,
    });
  });

  it('shows what is stored, validated, and falls back per key for a stale one', async () => {
    const { service, admin, kernel } = await setup();
    await makeSetting(
      kernel.pool,
      'fix.widgets',
      { limit: 7, label: 12, gone: true },
      { version: 4 },
    );
    const view = await service.get(admin, 'fix.widgets');
    expect(view).toMatchObject({ version: 4, values: { limit: 7, label: 'plain' } });
  });

  it('answers 404 for a module without settings or that is not loaded', async () => {
    const { service, admin } = await setup();
    await expect(service.get(admin, 'core.authz')).rejects.toBeInstanceOf(NotFound);
    await expect(service.get(admin, 'nobody.here')).rejects.toBeInstanceOf(NotFound);
    await expect(service.jsonSchema(admin, 'nobody.here')).rejects.toBeInstanceOf(NotFound);
  });

  const reads: [string, (s: SettingsInternals, actor: Actor) => Promise<unknown>][] = [
    ['list', (s, actor) => s.list(actor)],
    ['get', (s, actor) => s.get(actor, 'fix.widgets')],
    ['jsonSchema', (s, actor) => s.jsonSchema(actor, 'fix.widgets')],
  ];
  it.each(reads)(
    '%s is denied: 403 for a user without the permission, 401 for anonymous',
    async (_n, call) => {
      const { service, member, nobody } = await setup();
      await expect(call(service, member)).rejects.toBeInstanceOf(Forbidden);
      await expect(call(service, nobody)).rejects.toBeInstanceOf(Forbidden);
      await expect(call(service, ANONYMOUS)).rejects.toBeInstanceOf(Unauthorized);
    },
  );

  it('describes the settings as JSON Schema for the admin form', async () => {
    const { service, admin } = await setup();
    const schema = (await service.jsonSchema(admin, 'fix.widgets')) as {
      type: string;
      properties: Record<string, { type: string; maximum?: number }>;
    };
    expect(schema.type).toBe('object');
    expect(schema.properties.limit).toMatchObject({ type: 'integer', maximum: 10 });
    expect(Object.keys(schema.properties)).toEqual(['limit', 'label', 'nested']);
  });
});

describe('update', () => {
  it('stores validated settings, bumps the version and tells the module’s own port at once', async () => {
    const { service, admin, widgets } = await setup();
    expect(await widgets.settings()).toMatchObject({ limit: 3 });
    const saved = await service.update(admin, 'fix.widgets', {
      version: 0,
      values: { limit: 5, label: ' big ' },
    });
    expect(saved).toMatchObject({ version: 1, values: { limit: 5, label: 'big' } });
    expect(saved.updatedBy).toBe(admin.userId);
    expect(await widgets.settings()).toMatchObject({ limit: 5, label: 'big' });
    const again = await service.update(admin, 'fix.widgets', { version: 1, values: { limit: 6 } });
    expect(again.version).toBe(2);
  });

  it('emits settings.changed@1 with the module and the changed key names, never the values', async () => {
    const { service, admin, kernel } = await setup();
    await service.update(admin, 'fix.widgets', {
      version: 0,
      values: { limit: 5, label: 'hunter2-label' },
    });
    await service.update(admin, 'fix.widgets', {
      version: 1,
      values: { limit: 5, label: 'other' },
    });
    const emitted = await events(kernel.pool);
    expect(emitted.map((e) => e.payload)).toEqual([
      { module: 'fix.widgets', keys: ['label', 'limit'], version: 1, actorId: userIdOf(admin) },
      { module: 'fix.widgets', keys: ['label'], version: 2, actorId: userIdOf(admin) },
    ]);
    expect(JSON.stringify(emitted)).not.toContain('hunter2-label');
  });

  it('writes nothing and emits nothing when nothing changed', async () => {
    const { service, admin, kernel } = await setup();
    await service.update(admin, 'fix.widgets', { version: 0, values: { limit: 5 } });
    const same = await service.update(admin, 'fix.widgets', { version: 1, values: { limit: 5 } });
    expect(same.version).toBe(1);
    expect(await events(kernel.pool)).toHaveLength(1);
  });

  it.each([
    ['a value out of range', { limit: 99 }, 'values.limit'],
    ['a value of the wrong type', { limit: 'many' }, 'values.limit'],
    ['a key the schema does not know', { colour: 'red' }, 'values'],
    ['a nested error', { nested: { on: 'yes' } }, 'values.nested.on'],
    ['an empty label', { label: '   ' }, 'values.label'],
  ])('rejects %s with 422 and the failing field, and stores nothing', async (_n, values, path) => {
    const { service, admin, kernel } = await setup();
    const failure = await service
      .update(admin, 'fix.widgets', { version: 0, values })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Invalid);
    expect((failure as Invalid).errors?.map((e) => e.path)).toContain(path);
    expect((await kernel.pool.query('select 1 from settings_setting')).rows).toEqual([]);
  });

  it('rejects a body that is not an object with 422', async () => {
    const { service, admin } = await setup();
    for (const values of [null, [], 'x', 4]) {
      await expect(
        service.update(admin, 'fix.widgets', { version: 0, values }),
      ).rejects.toBeInstanceOf(Invalid);
    }
  });

  it('answers 404 for a module without settings', async () => {
    const { service, admin } = await setup();
    await expect(
      service.update(admin, 'core.authz', { version: 0, values: {} }),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it('answers 409 for a stale version and changes nothing', async () => {
    const { service, admin } = await setup();
    await service.update(admin, 'fix.widgets', { version: 0, values: { limit: 5 } });
    for (const version of [0, 2]) {
      await expect(
        service.update(admin, 'fix.widgets', { version, values: { limit: 6 } }),
      ).rejects.toBeInstanceOf(Conflict);
    }
    expect((await service.get(admin, 'fix.widgets')).values).toMatchObject({ limit: 5 });
  });

  it('lets exactly one of two writers with the same version win, also for the first save', async () => {
    const { service, admin } = await setup();
    for (const version of [0, 1]) {
      const results = await Promise.allSettled([
        service.update(admin, 'fix.widgets', { version, values: { limit: 4 + version } }),
        service.update(admin, 'fix.widgets', { version, values: { limit: 8 } }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(Conflict);
    }
  });

  it('is denied without core.settings.write (403) and for anonymous (401), and stores nothing', async () => {
    const { service, member, nobody, kernel } = await setup();
    const input = { version: 0, values: { limit: 5 } };
    await expect(service.update(member, 'fix.widgets', input)).rejects.toBeInstanceOf(Forbidden);
    await expect(service.update(nobody, 'fix.widgets', input)).rejects.toBeInstanceOf(Forbidden);
    await expect(service.update(ANONYMOUS, 'fix.widgets', input)).rejects.toBeInstanceOf(
      Unauthorized,
    );
    expect((await kernel.pool.query('select 1 from settings_setting')).rows).toEqual([]);
  });

  it('rolls the row back together with the event when the event cannot be written', async () => {
    const { service, admin, kernel } = await setup();
    await service.update(admin, 'fix.widgets', { version: 0, values: { limit: 5 } });
    const restore = await breakOutbox(kernel.pool);
    await expect(
      service.update(admin, 'fix.widgets', { version: 1, values: { limit: 6 } }),
    ).rejects.toThrow();
    await expect(
      service.update(admin, 'core.settings', { version: 0, values: {} }),
    ).resolves.toBeDefined(); // no change, no event
    await restore();
    const view = await service.get(admin, 'fix.widgets');
    expect(view).toMatchObject({ version: 1, values: { limit: 5 } });
  });
});

describe('seed (trusted code, no human caller)', () => {
  it('stores the values when nothing is stored, tells the module at once and emits the event', async () => {
    const { service, admin, kernel } = await setup();
    expect(await service.seed('fix.widgets', { limit: 7 })).toBe('seeded');
    expect(await service.get(admin, 'fix.widgets')).toMatchObject({
      version: 1,
      values: { limit: 7 },
      updatedBy: null,
    });
    expect((await events(kernel.pool)).map((e) => e.payload)).toEqual([
      { module: 'fix.widgets', keys: ['limit'], version: 1, actorId: null }, // a seed has no human caller
    ]);
  });

  it('never overwrites what is stored, and emits nothing then', async () => {
    const { service, admin, kernel } = await setup();
    await service.update(admin, 'fix.widgets', { version: 0, values: { limit: 5 } });
    expect(await service.seed('fix.widgets', { limit: 9 })).toBe('kept');
    expect(await service.get(admin, 'fix.widgets')).toMatchObject({ values: { limit: 5 } });
    expect(await events(kernel.pool)).toHaveLength(1);
  });

  it('refuses values the schema rejects (422) and a module with no settings (404), storing nothing', async () => {
    const { service, kernel } = await setup();
    await expect(service.seed('fix.widgets', { limit: 'many' })).rejects.toBeInstanceOf(Invalid);
    await expect(service.seed('fix.widgets', [])).rejects.toBeInstanceOf(Invalid);
    await expect(service.seed('no.such', {})).rejects.toBeInstanceOf(NotFound);
    expect((await kernel.pool.query('select 1 from settings_setting')).rows).toEqual([]);
  });

  it('rolls the row back with the event when the event cannot be written', async () => {
    const { service, kernel } = await setup();
    const restore = await breakOutbox(kernel.pool);
    await expect(service.seed('fix.widgets', { limit: 3 })).rejects.toThrow();
    await restore();
    expect((await kernel.pool.query('select 1 from settings_setting')).rows).toEqual([]);
  });
});

describe('the cache', () => {
  it('serves a read from memory until the TTL passes, and a write empties it in this process', async () => {
    let now = 1_000;
    const { service, admin, kernel, widgets } = await setup({ cacheTtlMs: 5_000, now: () => now });
    expect(await widgets.settings()).toMatchObject({ limit: 3 });
    await makeSetting(kernel.pool, 'fix.widgets', { limit: 9 }); // behind the service's back
    expect(await widgets.settings()).toMatchObject({ limit: 3 }); // still cached
    now += 5_000;
    expect(await widgets.settings()).toMatchObject({ limit: 9 });
    await service.update(admin, 'fix.widgets', { version: 1, values: { limit: 2 } });
    expect(await widgets.settings()).toMatchObject({ limit: 2 }); // no waiting in the writing process
  });

  it('reaches a second process within the TTL (two kernels over one database)', async () => {
    let nowB = 1_000;
    const a = await setup({ cacheTtlMs: 5_000 });
    const b = await setup({ databaseUrl: a.databaseUrl, cacheTtlMs: 5_000, now: () => nowB });
    expect(await b.widgets.settings()).toMatchObject({ limit: 3 }); // B has the old value cached
    await a.service.update(a.admin, 'fix.widgets', { version: 0, values: { limit: 8 } });
    expect(await a.widgets.settings()).toMatchObject({ limit: 8 }); // A at once
    expect(await b.widgets.settings()).toMatchObject({ limit: 3 }); // B inside the bound
    nowB += 5_000; // the TTL passes
    expect(await b.widgets.settings()).toMatchObject({ limit: 8 });
  });
});
