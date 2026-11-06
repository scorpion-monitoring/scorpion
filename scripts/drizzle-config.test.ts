import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import config, { SCHEMA_FILES } from '../drizzle.config.ts';

const root = resolve(import.meta.dirname, '..');

describe('drizzle.config.ts (Drizzle Studio)', () => {
  it('lists the kernel schema and the modules glob, so every module with a db/schema.ts is covered', () => {
    const modules = readdirSync(join(root, 'modules'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => {
        try {
          readFileSync(join(root, 'modules', name, 'db/schema.ts'));
          return true;
        } catch {
          return false;
        }
      });
    expect(modules.length).toBeGreaterThan(0);
    const patterns = SCHEMA_FILES.filter((entry) => entry.includes('*'));
    // The only wildcard is `modules/*/db/schema.ts`: it matches every module that has a schema file.
    expect(patterns).toEqual(['modules/*/db/schema.ts']);
    expect(SCHEMA_FILES).toContain('packages/kernel/src/db/schema.ts');
    expect(config.schema).toEqual(SCHEMA_FILES);
  });

  it('keeps a schema file under every listed literal path', () => {
    for (const file of SCHEMA_FILES.filter((entry) => !entry.includes('*'))) {
      expect(() => readFileSync(join(root, file))).not.toThrow();
    }
  });

  it('is development only: the studio script binds to 127.0.0.1 and no profile or image mentions it', () => {
    const script = readFileSync(join(root, 'scripts/db-studio.ts'), 'utf8');
    expect(script).toContain("'127.0.0.1'");
    expect(script).not.toContain("'0.0.0.0'");
    for (const file of ['docker/Dockerfile', 'scripts/build.ts']) {
      let text = '';
      try {
        text = readFileSync(join(root, file), 'utf8');
      } catch {
        continue;
      }
      expect(text).not.toContain('drizzle.config');
    }
  });
});
