import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KernelStartupError } from '@scorpion/kernel';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateProfile } from './profile-generate.ts';

const FIXTURES = join(import.meta.dirname, '../../../packages/kernel/test/fixtures');

let root: string;

/** A minimal repository: the server package, a profile file and the fixture modules. */
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'scorpion-generate-'));
  mkdirSync(join(root, 'apps/server'), { recursive: true });
  writeFileSync(
    join(root, 'apps/server/package.json'),
    JSON.stringify({ name: '@scorpion/server', dependencies: { hono: '^4' } }, null, 2),
  );
  mkdirSync(join(root, 'modules'));
  for (const dir of ['fixture-a', 'fixture-b', 'fixture-opt']) {
    mkdirSync(join(root, 'modules', dir));
    cpSync(
      join(FIXTURES, 'modules', dir, 'package.json'),
      join(root, 'modules', dir, 'package.json'),
    );
  }
  mkdirSync(join(root, 'profiles'));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const profileFile = (name: string, modules: string[]) =>
  writeFileSync(
    join(root, 'profiles', `${name}.ts`),
    `export default { name: '${name}', modules: ${JSON.stringify(modules)} };\n`,
  );
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const serverDeps = () =>
  (JSON.parse(read('apps/server/package.json')) as { dependencies: object }).dependencies;

describe('generateProfile', () => {
  it('writes static imports for the profile and makes the server depend on exactly its modules', async () => {
    profileFile('ab', ['fixture.a', 'fixture.b']);
    const result = await generateProfile({ profileName: 'ab', root });

    expect(result.packageNames).toEqual(['@scorpion/fixture-a', '@scorpion/fixture-b']);
    const generated = read('apps/server/src/generated/profile.ts');
    expect(generated).toContain("import module0 from '@scorpion/fixture-a/module';");
    expect(generated).toContain("import module1 from '@scorpion/fixture-b/module';");
    expect(generated).not.toContain('fixture-opt');
    expect(serverDeps()).toEqual({
      '@scorpion/fixture-a': 'workspace:*',
      '@scorpion/fixture-b': 'workspace:*',
      hono: '^4',
    });
  });

  it('removes modules of an earlier profile from the server dependencies', async () => {
    profileFile('ab', ['fixture.a', 'fixture.b']);
    profileFile('b', ['fixture.b']);
    await generateProfile({ profileName: 'ab', root });
    await generateProfile({ profileName: 'b', root });

    expect(serverDeps()).toEqual({ '@scorpion/fixture-b': 'workspace:*', hono: '^4' });
    expect(read('apps/server/src/generated/profile.ts')).not.toContain('fixture-a');
  });

  it('is idempotent and, with check, reports a file that is out of date without writing', async () => {
    profileFile('ab', ['fixture.a', 'fixture.b']);
    expect((await generateProfile({ profileName: 'ab', root })).changed).toHaveLength(2);
    expect((await generateProfile({ profileName: 'ab', root })).changed).toEqual([]);

    profileFile('b', ['fixture.b']);
    const before = read('apps/server/src/generated/profile.ts');
    const checked = await generateProfile({ profileName: 'b', root, check: true });
    expect(checked.changed).toEqual([
      'apps/server/src/generated/profile.ts',
      'apps/server/package.json',
    ]);
    expect(read('apps/server/src/generated/profile.ts')).toBe(before);
  });

  it('refuses a profile that lacks a required dependency', async () => {
    profileFile('a', ['fixture.a']);
    await expect(generateProfile({ profileName: 'a', root })).rejects.toThrowError(
      /@scorpion\/fixture-a → @scorpion\/fixture-b \(not in profile "a"\)/,
    );
  });

  it('refuses a module without a package', async () => {
    profileFile('x', ['fixture.nothing']);
    await expect(generateProfile({ profileName: 'x', root })).rejects.toThrowError(
      /module "fixture.nothing" has no package "@scorpion\/fixture-nothing"/,
    );
  });

  it('refuses an unknown profile and a file whose name differs', async () => {
    await expect(generateProfile({ profileName: 'nope', root })).rejects.toBeInstanceOf(
      KernelStartupError,
    );
    profileFile('ab', ['fixture.b']);
    writeFileSync(join(root, 'profiles/other.ts'), read('profiles/ab.ts'));
    await expect(generateProfile({ profileName: 'other', root })).rejects.toThrowError(
      /Invalid profile file/,
    );
  });

  it('reads a profile file and module roots given explicitly', async () => {
    const result = await generateProfile({
      profileName: 'fixture-b-only',
      root,
      profileFile: join(FIXTURES, 'profiles/b-only.ts'),
      moduleRoots: ['modules'],
    });
    expect(result.packageNames).toEqual(['@scorpion/fixture-b']);
  });
});
