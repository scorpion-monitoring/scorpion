import { describe, expect, it } from 'vitest';
import {
  allFixtureSources,
  FIXTURE_MODULE_PACKAGES,
  fixtureProfile,
} from '../test/fixtures/index.ts';
import { KernelStartupError } from './errors.ts';
import { resolveProfile } from './resolve.ts';

const sources = await allFixtureSources();

async function resolveFixture(profileName: string) {
  return resolveProfile({
    profile: await fixtureProfile(profileName),
    sources,
    modulePackages: FIXTURE_MODULE_PACKAGES,
  });
}

async function problemsOf(profileName: string): Promise<readonly string[]> {
  try {
    await resolveFixture(profileName);
  } catch (error) {
    if (error instanceof KernelStartupError) return error.problems;
    throw error;
  }
  throw new Error(`expected profile ${profileName} to fail`);
}

describe('resolveProfile with the fixture modules', () => {
  it('orders a after b and computes dependencies from package.json', async () => {
    const resolved = await resolveFixture('ab');
    expect(resolved.modules.map((m) => m.id)).toEqual(['fixture.b', 'fixture.a']);
    const a = resolved.modules.find((m) => m.id === 'fixture.a')!;
    expect(a.dependsOn).toEqual(['fixture.b']);
    expect(a.optionalDependsOn).toEqual(['fixture.opt']);
    expect(a.presentOptional).toEqual([]);
  });

  it('wires an optional dependency when the profile includes it', async () => {
    const resolved = await resolveFixture('ab-opt');
    const a = resolved.modules.find((m) => m.id === 'fixture.a')!;
    expect(a.presentOptional).toEqual(['fixture.opt']);
    expect(resolved.modules.map((m) => m.id).indexOf('fixture.opt')).toBeLessThan(
      resolved.modules.map((m) => m.id).indexOf('fixture.a'),
    );
  });

  it('loads a module without dependencies alone', async () => {
    expect((await resolveFixture('b-only')).modules.map((m) => m.id)).toEqual(['fixture.b']);
  });

  it('refuses a missing dependency and names the path', async () => {
    expect(await problemsOf('missing')).toEqual([
      'fixture.missing → fixture.b (not in profile "fixture-missing")',
    ]);
  });

  it('refuses a cycle and names the path', async () => {
    expect(await problemsOf('cycle')).toEqual([
      'dependency cycle: fixture.cycle-x → fixture.cycle-y → fixture.cycle-x',
    ]);
  });

  it('does not take a dependency from a manifest field', () => {
    const a = sources.find((s) => s.manifest.id === 'fixture.a')!;
    expect('dependsOn' in a.manifest).toBe(false);
  });
});

describe('resolveProfile problems', () => {
  const b = sources.find((s) => s.manifest.id === 'fixture.b')!;
  const profile = { name: 'p', modules: ['fixture.b'] };
  const resolve = (overrides: Partial<Parameters<typeof resolveProfile>[0]>) =>
    resolveProfile({
      profile,
      sources: [b],
      modulePackages: FIXTURE_MODULE_PACKAGES,
      ...overrides,
    });

  it('rejects a module listed twice', () => {
    expect(() =>
      resolve({ profile: { name: 'p', modules: ['fixture.b', 'fixture.b'] } }),
    ).toThrowError(/"fixture.b" is listed twice/);
  });

  it('rejects a module the build does not include', () => {
    expect(() => resolve({ sources: [] })).toThrowError(
      /"fixture.b" is in profile "p" but this build does not include it/,
    );
  });

  it('rejects a package whose name does not match the module id', () => {
    const renamed = { ...b, packageJson: { ...b.packageJson, name: '@scorpion/other' } };
    expect(() => resolve({ sources: [renamed] })).toThrowError(
      /fixture.b: package is named "@scorpion\/other", expected "@scorpion\/fixture-b"/,
    );
  });

  it('rejects an invalid manifest with the field that is wrong', () => {
    const broken = { ...b, manifest: { ...b.manifest, version: 'one' } };
    expect(() => resolve({ sources: [broken] })).toThrowError(
      /fixture.b: version: must be a semantic version/,
    );
  });
});
