// Helpers that load the fixture modules the way the generated profile file loads real ones.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModuleManifest, ModuleSource, Profile } from '@scorpion/kernel';

export const MODULES_DIR = join(import.meta.dirname, 'modules');

/** Module id → package name, in place of the generated WORKSPACE_MODULES. */
export const FIXTURE_MODULE_PACKAGES: Record<string, string> = {
  'fixture.a': '@scorpion/fixture-a',
  'fixture.b': '@scorpion/fixture-b',
  'fixture.opt': '@scorpion/fixture-opt',
  'fixture.cycle-x': '@scorpion/fixture-cycle-x',
  'fixture.cycle-y': '@scorpion/fixture-cycle-y',
  'fixture.missing': '@scorpion/fixture-missing',
  'fixture.foreign-contrib': '@scorpion/fixture-foreign-contrib',
  'fixture.dup': '@scorpion/fixture-dup',
  'fixture.dup.inner': '@scorpion/fixture-dup-inner',
};

/** Loads a fixture module by its directory name, for example `fixture-a`. */
export async function fixtureSource(directory: string): Promise<ModuleSource> {
  const dir = join(MODULES_DIR, directory);
  const packageJson = JSON.parse(
    await readFile(join(dir, 'package.json'), 'utf8'),
  ) as ModuleSource['packageJson'];
  const { default: manifest } = (await import(join(dir, 'module.ts'))) as {
    default: ModuleManifest;
  };
  return { manifest, packageJson };
}

export async function allFixtureSources(): Promise<ModuleSource[]> {
  const directories = Object.values(FIXTURE_MODULE_PACKAGES).map((name) =>
    name.replace('@scorpion/', ''),
  );
  return Promise.all(directories.map(fixtureSource));
}

export async function fixtureProfile(name: string): Promise<Profile> {
  const { default: profile } = (await import(
    join(import.meta.dirname, 'profiles', `${name}.ts`)
  )) as {
    default: Profile;
  };
  return profile;
}
