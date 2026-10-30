import { DemoSeedRefused } from '@scorpion/kernel';
import { describe, expect, it } from 'vitest';
import { DEMO_SERVICE_SLUGS, DEMO_SERVICES, createDemoSeed } from './demo-seed.ts';

describe('the demo services', () => {
  it('have unique slugs and names, and DEMO_SERVICE_SLUGS lists them in order', () => {
    expect(DEMO_SERVICE_SLUGS).toEqual(DEMO_SERVICES.map((item) => item.slug));
    expect(new Set(DEMO_SERVICE_SLUGS).size).toBe(DEMO_SERVICES.length);
    expect(new Set(DEMO_SERVICES.map((item) => item.name)).size).toBe(DEMO_SERVICES.length);
  });

  it.each(DEMO_SERVICES.map((item) => [item.slug, item] as const))(
    '%s has a valid slug, a stage of the stage vocabulary and an address on a reserved domain',
    (_slug, item) => {
      expect(item.slug).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/);
      expect(['DEV', 'DEMO', 'PROD', 'TERM']).toContain(item.stage);
      expect(new URL(item.url).hostname).toBe('example.org');
    },
  );

  it('makes some services public and some not, so both views have data', () => {
    expect(DEMO_SERVICES.some((item) => item.public)).toBe(true);
    expect(DEMO_SERVICES.some((item) => !item.public)).toBe(true);
  });
});

describe('the demo seed', () => {
  it('refuses when core.identity registered no demo account', async () => {
    const seed = createDemoSeed(() => {
      throw new Error('must not be reached');
    });
    await expect(
      seed(undefined, {
        actors: new Map(),
        password: undefined,
        allowProduction: false,
        out: () => {},
      }),
    ).rejects.toBeInstanceOf(DemoSeedRefused);
  });
});
