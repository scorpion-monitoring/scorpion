import { matchesGlob } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const config = readFileSync(join(root, 'drizzle.config.ts'), 'utf8');

/** The quoted entries of `SCHEMA_FILES` in the config. */
const listed = (() => {
  const body = /SCHEMA_FILES = \[([^\]]*)\]/.exec(config)?.[1] ?? '';
  return [...body.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
})();

const schemas = (dir: string, file: string) =>
  readdirSync(join(root, dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${dir}/${entry.name}/${file}`)
    .filter((path) => {
      try {
        readFileSync(join(root, path));
        return true;
      } catch {
        return false;
      }
    });

describe('drizzle.config.ts (Drizzle Studio)', () => {
  it('lists the schema of the kernel and every module that has a db/schema.ts', () => {
    const expected = [...schemas('modules', 'db/schema.ts'), 'packages/kernel/src/db/schema.ts'];
    expect(expected.length).toBeGreaterThan(5);
    for (const file of expected) {
      expect(
        listed.some((pattern) => matchesGlob(file, pattern)),
        file,
      ).toBe(true);
    }
  });

  it('lists nothing that is not a schema file of a module or of the kernel', () => {
    for (const pattern of listed) {
      expect(
        pattern === 'packages/kernel/src/db/schema.ts' || pattern === 'modules/*/db/schema.ts',
        pattern,
      ).toBe(true);
    }
  });

  it('is development only: the studio script binds to 127.0.0.1 and no profile or image mentions it', () => {
    const script = readFileSync(join(root, 'scripts/db-studio.ts'), 'utf8');
    expect(script).toContain("'127.0.0.1'");
    expect(script).not.toContain("'0.0.0.0'");
    for (const file of ['docker/Dockerfile', 'scripts/build.ts']) {
      expect(readFileSync(join(root, file), 'utf8')).not.toContain('drizzle.config');
    }
  });
});
