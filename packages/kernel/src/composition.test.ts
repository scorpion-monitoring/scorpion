import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  allFixtureSources,
  FIXTURE_MODULE_PACKAGES,
  fixtureProfile,
} from '../test/fixtures/index.ts';
import { buildComposition, tablePrefixOf } from './composition.ts';
import { KernelStartupError } from './errors.ts';
import { defineModule, type ModuleManifest } from './manifest.ts';
import { resolveProfile, type ModuleSource } from './resolve.ts';

const sources = await allFixtureSources();

async function composeFixture(profileName: string) {
  const profile = resolveProfile({
    profile: await fixtureProfile(profileName),
    sources,
    modulePackages: FIXTURE_MODULE_PACKAGES,
  });
  return buildComposition(profile);
}

async function problemsOfFixture(profileName: string): Promise<readonly string[]> {
  try {
    await composeFixture(profileName);
  } catch (error) {
    if (error instanceof KernelStartupError) return error.problems;
    throw error;
  }
  throw new Error(`expected ${profileName} to fail`);
}

/** Composes inline manifests, each in its own package, none depending on another. */
function composeInline(
  manifests: ModuleManifest[],
  optionalAbsent = false,
  requires: Record<string, string[]> = {},
) {
  const modulePackages: Record<string, string> = {};
  const inline: ModuleSource[] = manifests.map((manifest) => {
    const name = `@scorpion/${manifest.id.replaceAll('.', '-')}`;
    modulePackages[manifest.id] = name;
    return {
      manifest,
      packageJson: {
        name,
        dependencies: Object.fromEntries(
          (requires[manifest.id] ?? []).map((id) => [`@scorpion/${id.replaceAll('.', '-')}`, '*']),
        ),
        ...(optionalAbsent
          ? {
              peerDependencies: { '@scorpion/ghost': '*' },
              peerDependenciesMeta: { '@scorpion/ghost': { optional: true } },
            }
          : {}),
      },
    };
  });
  modulePackages['ghost'] = '@scorpion/ghost';
  return buildComposition(
    resolveProfile({
      profile: { name: 'inline', modules: manifests.map((m) => m.id) },
      sources: inline,
      modulePackages,
    }),
  );
}

function problemsOfInline(
  manifests: ModuleManifest[],
  optionalAbsent = false,
  requires: Record<string, string[]> = {},
): readonly string[] {
  try {
    composeInline(manifests, optionalAbsent, requires);
  } catch (error) {
    if (error instanceof KernelStartupError) return error.problems;
    throw error;
  }
  throw new Error('expected composition to fail');
}

describe('buildComposition with the fixture modules', () => {
  it('registers permissions, events and registries, and validates the contribution of a', async () => {
    const composition = await composeFixture('ab');
    expect([...composition.permissions.keys()].sort()).toEqual([
      'fixture.a.read',
      'fixture.b.write',
    ]);
    expect(composition.permissions.get('fixture.b.write')?.module).toBe('fixture.b');
    expect([...composition.events.keys()]).toEqual(['fixture.thing.created@1']);
    expect(composition.registries.get('fixture.widget')?.entries).toEqual([
      { module: 'fixture.a', value: { label: 'from a' } },
    ]);
  });

  it('refuses a contribution from a module that does not depend on the registry owner', async () => {
    expect(await problemsOfFixture('foreign-contrib')).toEqual([
      'fixture.foreign-contrib: contributes to registry "fixture.widget" of fixture.b, which is not a declared dependency',
    ]);
  });

  it('refuses a duplicate permission and the prefix of another module', async () => {
    expect(await problemsOfFixture('dup')).toEqual([
      'fixture.dup: permission "fixture.dup.inner.use" carries the prefix of module "fixture.dup.inner"',
      'permission "fixture.dup.inner.use" is declared by both fixture.dup and fixture.dup.inner',
    ]);
  });
});

describe('buildComposition', () => {
  const widget = z.strictObject({ label: z.string() });
  const owner = defineModule({ id: 'own', version: '1.0.0', registries: { 'own.widget': widget } });

  it('rejects a registry entry that does not match the schema, naming the entry and field', () => {
    const contributor = defineModule({
      id: 'con',
      version: '1.0.0',
      contributes: { 'own.widget': [{ label: 'ok' }, { label: 5 }] },
    });
    const problems = problemsOfInline([owner, contributor], false, { con: ['own'] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^con: registry "own.widget" entry 1.label: /);
  });

  it('keeps the parsed value of an entry, so defaults and transforms apply', () => {
    const withDefault = defineModule({
      id: 'own',
      version: '1.0.0',
      registries: { 'own.widget': z.object({ label: z.string(), size: z.number().default(3) }) },
    });
    const contributor = defineModule({
      id: 'con',
      version: '1.0.0',
      contributes: { 'own.widget': [{ label: 'x' }] },
    });
    const composition = composeInline([withDefault, contributor], false, { con: ['own'] });
    expect(composition.registries.get('own.widget')?.entries).toEqual([
      { module: 'con', value: { label: 'x', size: 3 } },
    ]);
  });

  it('rejects a duplicate registry, event and job name', () => {
    const one = defineModule({
      id: 'one',
      version: '1.0.0',
      registries: { 'x.reg': widget },
      events: { emits: { 'x.done@1': z.object({}) } },
    });
    const two = defineModule({
      id: 'two',
      version: '1.0.0',
      registries: { 'x.reg': widget },
      events: { emits: { 'x.done@1': z.object({}) } },
    });
    expect(problemsOfInline([one, two])).toEqual([
      'event "x.done@1" is emitted by both one and two',
      'registry "x.reg" is declared by both one and two',
    ]);
  });

  it('rejects a command name that two modules both declare', () => {
    const command = { name: 'tidy', description: 'x', run: async () => {} };
    const one = defineModule({ id: 'one', version: '1.0.0', commands: [command] });
    const two = defineModule({ id: 'two', version: '1.0.0', commands: [command] });
    expect(problemsOfInline([one, two])).toEqual([
      'command "tidy" is declared by both one and two',
    ]);
  });

  it('rejects overlapping table prefixes and the kernel prefix', () => {
    const a = defineModule({ id: 'kpi', version: '1.0.0', tablePrefix: 'kpi_' });
    const b = defineModule({ id: 'kpi.ingestion', version: '1.0.0' });
    const c = defineModule({ id: 'kernel', version: '1.0.0' });
    expect(problemsOfInline([a, b, c])).toEqual([
      'kernel: table prefix "kernel_" is reserved for the kernel',
      'table prefixes of kpi ("kpi_") and kpi.ingestion ("kpi_ingestion_") overlap',
    ]);
  });

  it('rejects a subscription to an event nobody emits', () => {
    const module = defineModule({
      id: 'sub',
      version: '1.0.0',
      events: { on: { 'ghost.thing@1': async () => {} } },
    });
    expect(problemsOfInline([module])).toEqual([
      'sub: subscribes to "ghost.thing@1", which no module in the profile emits',
    ]);
  });

  it('rejects a subscription to the event of a module that is not a dependency', () => {
    const emitter = defineModule({
      id: 'emit',
      version: '1.0.0',
      events: { emits: { 'emit.done@1': z.object({}) } },
    });
    const sub = defineModule({
      id: 'sub',
      version: '1.0.0',
      events: { on: { 'emit.done@1': async () => {} } },
    });
    expect(problemsOfInline([emitter, sub])).toEqual([
      'sub: subscribes to "emit.done@1" of emit, which is not a declared dependency',
    ]);
  });

  it('skips targets that may belong to an absent optional dependency instead of failing', () => {
    const module = defineModule({
      id: 'con',
      version: '1.0.0',
      contributes: { 'graph.nodeProvider': [{ anything: true }] },
      events: { on: { 'ghost.thing@1': async () => {} } },
    });
    const composition = composeInline([module], true);
    expect(composition.skipped).toEqual([
      'con: subscription "ghost.thing@1" (no module in the profile emits it)',
      'con: contribution to registry "graph.nodeProvider" (no module declares it)',
    ]);
  });
});

describe('tablePrefixOf', () => {
  it.each([
    [{ id: 'kpi.ingestion', manifest: {} }, 'kpi_ingestion_'],
    [{ id: 'core.ui-shell', manifest: {} }, 'core_ui_shell_'],
    [{ id: 'maturity', manifest: {} }, 'maturity_'],
    [{ id: 'core.identity', manifest: { tablePrefix: 'identity_' } }, 'identity_'],
  ])('%j → %s', (module, expected) => {
    expect(tablePrefixOf(module as never)).toBe(expected);
  });
});
