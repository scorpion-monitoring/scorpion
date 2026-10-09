import { startPostgres, type StartedPostgres } from '@scorpion/testing';
import { Writable } from 'node:stream';
import { z } from 'zod';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  allFixtureSources,
  FIXTURE_MODULE_PACKAGES,
  fixtureProfile,
} from '../test/fixtures/index.ts';
import { loadConfig } from './config.ts';
import { KernelStartupError } from './errors.ts';
import { createKernel, type Kernel } from './kernel.ts';
import { createLogger } from './logger.ts';
import { defineModule, type ModuleManifest } from './manifest.ts';
import type { ModuleSource } from './resolve.ts';

let server: StartedPostgres;
const fixtureSources = await allFixtureSources();
const open: Kernel[] = [];

beforeAll(async () => {
  server = await startPostgres();
}, 120_000);
afterEach(async () => {
  await Promise.all(open.splice(0).map((kernel) => kernel.stop()));
});
afterAll(async () => {
  await server?.stop();
});

async function fixtureKernel(profileName: string): Promise<Kernel> {
  const kernel = createKernel({
    profile: await fixtureProfile(profileName),
    sources: fixtureSources,
    modulePackages: FIXTURE_MODULE_PACKAGES,
    config: loadConfig({ DATABASE_URL: await server.createDatabase() }),
    log: createLogger({ level: 'silent' }),
  });
  open.push(kernel);
  return kernel;
}

/** A kernel over inline modules; `requires` lists package dependencies per module id. */
async function inlineKernel(
  manifests: ModuleManifest[],
  requires: Record<string, string[]> = {},
): Promise<Kernel> {
  const modulePackages: Record<string, string> = {};
  const sources: ModuleSource[] = manifests.map((manifest) => {
    const name = `@scorpion/${manifest.id.replaceAll('.', '-')}`;
    modulePackages[manifest.id] = name;
    return {
      manifest,
      packageJson: {
        name,
        dependencies: Object.fromEntries(
          (requires[manifest.id] ?? []).map((id) => [`@scorpion/${id.replaceAll('.', '-')}`, '*']),
        ),
      },
    };
  });
  const kernel = createKernel({
    profile: { name: 'inline', modules: manifests.map((m) => m.id) },
    sources,
    modulePackages,
    config: loadConfig({ DATABASE_URL: await server.createDatabase() }),
    log: createLogger({ level: 'silent' }),
  });
  open.push(kernel);
  return kernel;
}

describe('start()', () => {
  it('builds the services of a and b, with b available to a through ctx.deps', async () => {
    const kernel = await fixtureKernel('ab');
    await kernel.start();
    expect([...kernel.services.keys()]).toEqual(['fixture.b', 'fixture.a']);
    expect((kernel.services.get('fixture.a') as { describe(): string }).describe()).toBe(
      'a+b+none',
    );
  });

  it('hands over an optional dependency when the profile includes it', async () => {
    const kernel = await fixtureKernel('ab-opt');
    await kernel.start();
    expect((kernel.services.get('fixture.a') as { describe(): string }).describe()).toBe('a+b+opt');
  });

  it('migrates before it builds services', async () => {
    const kernel = await fixtureKernel('ab');
    await kernel.start();
    expect(await kernel.pendingMigrations()).toEqual([]);
  });

  it('refuses a broken profile before anything is created, with the path in the message', () => {
    expect(() =>
      createKernel({
        profile: { name: 'fixture-missing', modules: ['fixture.missing'] },
        sources: fixtureSources,
        modulePackages: FIXTURE_MODULE_PACKAGES,
        config: loadConfig({ DATABASE_URL: 'postgres://x:y@127.0.0.1:1/z' }),
      }),
    ).toThrowError(/fixture\.missing → fixture\.b \(not in profile "fixture-missing"\)/);
  });
});

describe('ctx.deps', () => {
  it('cannot reach the services of a module that is not a dependency', async () => {
    const kernel = await inlineKernel(
      [
        defineModule({ id: 'target', version: '1.0.0', services: () => ({ secret: 1 }) }),
        defineModule({
          id: 'nosy',
          version: '1.0.0',
          services: (ctx) => (ctx.deps as Record<string, unknown>)['target'],
        }),
      ],
      {},
    );
    await expect(kernel.start()).rejects.toThrowError(/Module "nosy" cannot reach "target"/);
  });

  it('cannot reach a module through a dependency of a dependency', async () => {
    const kernel = await inlineKernel(
      [
        defineModule({ id: 'base', version: '1.0.0', services: () => ({ base: true }) }),
        defineModule({ id: 'mid', version: '1.0.0', services: () => ({ mid: true }) }),
        defineModule({
          id: 'top',
          version: '1.0.0',
          services: (ctx) => (ctx.deps as Record<string, unknown>)['base'],
        }),
      ],
      { mid: ['base'], top: ['mid'] },
    );
    await expect(kernel.start()).rejects.toThrowError(/Module "top" cannot reach "base"/);
  });

  it('lists only the declared dependencies and is read-only', async () => {
    let seen: Record<string, unknown> = {};
    const kernel = await inlineKernel(
      [
        defineModule({ id: 'dep', version: '1.0.0', services: () => 'dep-service' }),
        defineModule({
          id: 'user',
          version: '1.0.0',
          services: (ctx) => {
            seen = ctx.deps;
            expect(() => {
              seen['dep'] = 'other';
            }).toThrow(TypeError);
            return {};
          },
        }),
      ],
      { user: ['dep'] },
    );
    await kernel.start();
    expect(Object.keys(seen)).toEqual(['dep']);
    expect(seen['dep']).toBe('dep-service');
    expect('nope' in seen).toBe(false);
  });
});

describe('ctx.permissions', () => {
  it('lists the permissions of every loaded module, read-only', async () => {
    let seen: readonly unknown[] = [];
    const kernel = await inlineKernel([
      defineModule({
        id: 'one',
        version: '1.0.0',
        permissions: { 'one.read': { description: 'Read ones' } },
      }),
      defineModule({
        id: 'two',
        version: '1.0.0',
        permissions: { 'two.edit': { description: 'Edit twos', scope: 'two' } },
        services: (ctx) => {
          seen = ctx.permissions;
          return {};
        },
      }),
    ]);
    await kernel.start();
    expect(seen).toEqual([
      { id: 'one.read', module: 'one', description: 'Read ones' },
      { id: 'two.edit', module: 'two', description: 'Edit twos', scope: 'two' },
    ]);
    expect(Object.isFrozen(seen)).toBe(true);
    expect(Object.isFrozen(seen[0])).toBe(true);
  });
});

describe('ctx.settings', () => {
  const settings = z.strictObject({ flag: z.boolean().default(true) });
  const reader = () =>
    defineModule<unknown, never, never, z.output<typeof settings>>({
      id: 'reader',
      version: '1.0.0',
      settings,
      services: (ctx) => ({ read: () => ctx.settings.get() }),
    });
  const store = (value: unknown) =>
    defineModule({
      id: 'store',
      version: '1.0.0',
      contributes: { 'kernel.settingsStore': [{ read: () => Promise.resolve(value) }] },
    });
  const read = async (kernel: Kernel) => {
    await kernel.start();
    return (kernel.services.get('reader') as { read(): Promise<unknown> }).read();
  };

  it('yields the schema defaults when no module provides a store', async () => {
    expect(await read(await inlineKernel([reader()]))).toEqual({ flag: true });
  });

  it('yields the stored value of the module when a store is present', async () => {
    const kernel = await inlineKernel([store({ flag: false }), reader()]);
    expect(await read(kernel)).toEqual({ flag: false });
  });

  it('lets the server read a module’s settings, and refuses a module that is not loaded', async () => {
    const kernel = await inlineKernel([store({ flag: false }), reader()]);
    expect(await kernel.settingsOf('reader').get()).toEqual({ flag: false });
    expect(() => kernel.settingsOf('nobody')).toThrowError(/not in the profile/);
  });

  it('gives a module its dependencies even when its context was made before start()', async () => {
    // The server reads the stored rate limits through `settingsOf()` before it starts the kernel. That
    // made the context of core.settings early, and a snapshot of `ctx.deps` kept `undefined` for the
    // module's dependencies: every settings route then failed with a 500 in a running server.
    let seen: unknown;
    const base = defineModule({ id: 'base', version: '1.0.0', services: () => ({ name: 'base' }) });
    const above = defineModule({
      id: 'above',
      version: '1.0.0',
      settings: z.strictObject({}),
      services: (ctx) => {
        seen = (ctx.deps as Record<string, unknown>).base;
        return {};
      },
    });
    const kernel = await inlineKernel([base, above], { above: ['base'] });
    kernel.settingsOf('above'); // creates the context of `above` before any service exists
    await kernel.start();
    expect(seen).toEqual({ name: 'base' });
  });

  it('shows modules the settings schemas of every loaded module, and no values', async () => {
    let seen: ReadonlyMap<string, unknown> | undefined;
    const looker = defineModule({
      id: 'looker',
      version: '1.0.0',
      services: (ctx) => {
        seen = ctx.settingsSchemas;
        return {};
      },
    });
    await (await inlineKernel([reader(), looker])).start();
    expect([...seen!.keys()]).toEqual(['reader']);
  });

  it('refuses two stores', async () => {
    const second = defineModule({
      id: 'store2',
      version: '1.0.0',
      contributes: { 'kernel.settingsStore': [{ read: () => Promise.resolve({}) }] },
    });
    await expect(inlineKernel([store({}), second])).rejects.toThrowError(
      /more than one module contributes to "kernel.settingsStore"/,
    );
  });
});

describe('ctx.registry', () => {
  const widget = z.strictObject({ label: z.string() });

  it('gives a module the entries of a registry it depends on, validated, and frozen', async () => {
    let entries: readonly unknown[] = [];
    const kernel = await inlineKernel(
      [
        defineModule({ id: 'own', version: '1.0.0', registries: { 'own.widget': widget } }),
        defineModule({
          id: 'con',
          version: '1.0.0',
          contributes: { 'own.widget': [{ label: 'one' }] },
          services: (ctx) => {
            entries = ctx.registry('own.widget');
            return {};
          },
        }),
      ],
      { con: ['own'] },
    );
    await kernel.start();
    expect(entries).toEqual([{ label: 'one' }]);
    expect(Object.isFrozen(entries)).toBe(true);
  });

  it('refuses a registry of a module that is not a dependency, and an unknown registry', async () => {
    const kernel = await inlineKernel([
      defineModule({ id: 'own', version: '1.0.0', registries: { 'own.widget': widget } }),
      defineModule({ id: 'nosy', version: '1.0.0', services: (ctx) => ctx.registry('own.widget') }),
    ]);
    await expect(kernel.start()).rejects.toThrowError(
      /Module "nosy" cannot read registry "own.widget"/,
    );

    const other = await inlineKernel([
      defineModule({
        id: 'nosy',
        version: '1.0.0',
        services: (ctx) => ctx.registry('nothing.here'),
      }),
    ]);
    await expect(other.start()).rejects.toBeInstanceOf(KernelStartupError);
  });
});

describe('ctx', () => {
  it('carries db, config and a logger bound to the module', async () => {
    let ctxSeen: { moduleId: string; hasTx: boolean; profile: string; bound: unknown } | undefined;
    const kernel = await inlineKernel([
      defineModule({
        id: 'probe',
        version: '1.0.0',
        services: (ctx) => {
          ctxSeen = {
            moduleId: ctx.moduleId,
            hasTx: typeof ctx.db.tx === 'function',
            profile: ctx.config.PROFILE,
            bound: ctx.log.bindings(),
          };
          return {};
        },
      }),
    ]);
    await kernel.start();
    expect(ctxSeen).toEqual({
      moduleId: 'probe',
      hasTx: true,
      profile: 'full',
      bound: { module: 'probe' },
    });
  });
});

describe('module commands', () => {
  const io = () => {
    const out: string[] = [];
    return {
      out,
      io: {
        out: (text: string) => void out.push(text),
        err: (text: string) => void out.push(`err: ${text}`),
        readSecret: () => Promise.resolve('hunter2'),
      },
    };
  };

  async function inline(manifest: ModuleManifest): Promise<Kernel> {
    const kernel = createKernel({
      profile: { name: 'inline', modules: [manifest.id] as never },
      sources: [{ manifest, packageJson: { name: `@scorpion/${manifest.id}`, dependencies: {} } }],
      modulePackages: { [manifest.id]: `@scorpion/${manifest.id}` },
      config: loadConfig({ DATABASE_URL: await server.createDatabase() }),
      log: createLogger({ level: 'silent' }),
    });
    open.push(kernel);
    return kernel;
  }

  it('lists the commands without touching the database, and runs one with the services built, no routes and no system.ready', async () => {
    const ready = vi.fn();
    const seen: unknown[] = [];
    const kernel = await inline(
      defineModule<{ greet: () => string }>({
        id: 'tool',
        version: '1.0.0',
        services: () => ({ greet: () => 'hello' }),
        routes: () => seen.push('routes registered'),
        events: { on: { 'system.ready': ready } },
        commands: [
          {
            name: 'greet',
            description: 'Say hello',
            usage: 'greet <name>',
            run: (args, cliIo, ctx) => {
              cliIo.out(`${args.join(' ')} ${ctx.moduleId}`);
              return Promise.resolve(3);
            },
          },
        ],
      }),
    );
    expect(kernel.commands).toEqual([
      { module: 'tool', name: 'greet', description: 'Say hello', usage: 'greet <name>' },
    ]);

    const { out, io: cliIo } = io();
    expect(await kernel.runCommand('greet', ['to', 'you'], cliIo)).toBe(3);
    expect(out).toEqual(['to you tool']);
    expect(ready).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
    // The database was migrated for it.
    expect((await kernel.pool.query(`select 1 from kernel_outbox`)).rows).toEqual([]);
  });

  it('treats a command that returns nothing as exit code 0, and refuses an unknown name', async () => {
    const kernel = await inline(
      defineModule({
        id: 'tool',
        version: '1.0.0',
        commands: [{ name: 'noop', description: 'x', run: async () => {} }],
      }),
    );
    expect(await kernel.runCommand('noop', [], io().io)).toBe(0);
    await expect(kernel.runCommand('nope', [], io().io)).rejects.toThrow(KernelStartupError);
  });
});

describe('the database pool', () => {
  it('logs a lost idle connection with its code only, never the client and its password', async () => {
    const lines: string[] = [];
    const kernel = createKernel({
      profile: await fixtureProfile('ab'),
      sources: fixtureSources,
      modulePackages: FIXTURE_MODULE_PACKAGES,
      config: loadConfig({ DATABASE_URL: await server.createDatabase() }),
      log: createLogger({
        level: 'warn',
        destination: new Writable({
          write(chunk: Buffer, _encoding, callback) {
            lines.push(chunk.toString());
            callback();
          },
        }),
      }),
    });
    open.push(kernel);
    const [idle, other] = await Promise.all([kernel.pool.connect(), kernel.pool.connect()]);
    const pid = (await idle.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid;
    idle.release();
    await other.query('select pg_terminate_backend($1)', [pid]);
    other.release();
    await expect.poll(() => lines.length).toBe(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      code: '57P01',
      msg: 'an idle database connection was lost',
    });
    expect(lines[0]).not.toContain('password');
    expect(lines[0]).not.toContain('connectionParameters');
  });
});
