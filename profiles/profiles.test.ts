import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = readdirSync(import.meta.dirname).filter(
  (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
);

describe('profiles', () => {
  it('has the profiles from the architecture (ADR-0030, ADR-0032)', () => {
    expect(files.sort()).toEqual(['core-only.ts', 'full.ts', 'registry.ts']);
  });

  it.each(files)('%s exports a profile named after its file', async (file) => {
    const { default: profile } = (await import(`./${file}`)) as {
      default: { name: string; modules: unknown[] };
    };
    expect(profile.name).toBe(file.replace(/\.ts$/, ''));
    expect(Array.isArray(profile.modules)).toBe(true);
  });
});

describe('the registry modules', () => {
  const modulesOf = async (name: string) =>
    ((await import(`./${name}.ts`)) as { default: { modules: string[] } }).default.modules;

  it('are in the registry and the full profile, in dependency order, and not in core-only', async () => {
    for (const name of ['registry', 'full']) {
      const modules = await modulesOf(name);
      expect(modules, name).toContain('registry.organisations');
      expect(modules, name).toContain('registry.services');
      expect(modules.indexOf('registry.organisations'), name).toBeLessThan(
        modules.indexOf('registry.services'),
      );
    }
    const core = await modulesOf('core-only');
    expect(core.filter((id) => id.startsWith('registry.'))).toEqual([]);
  });
});
