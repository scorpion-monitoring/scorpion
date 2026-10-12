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
