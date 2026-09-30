import { startPostgres, type StartedPostgres } from '@scorpion/testing';
import { z } from 'zod';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
