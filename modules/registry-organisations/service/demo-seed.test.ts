import { DemoSeedRefused } from '@scorpion/kernel';
import { describe, expect, it } from 'vitest';
import { DEMO_ORGANISATIONS, createDemoSeed } from './demo-seed.ts';
import { createOrganisationSchema } from './input.ts';

describe('the demo organisations', () => {
  it.each(DEMO_ORGANISATIONS.map((item) => [item.abbreviation, item] as const))(
    '%s passes the rules of a create',
    (_abbreviation, input) => {
      expect(createOrganisationSchema.safeParse(input).success).toBe(true);
    },
  );

  it('have one abbreviation each, fictional names and only reserved domains', () => {
    const abbreviations = DEMO_ORGANISATIONS.map((item) => item.abbreviation);
    expect(new Set(abbreviations).size).toBe(abbreviations.length);
    const text = JSON.stringify(DEMO_ORGANISATIONS);
    for (const [, host] of text.matchAll(/https?:\/\/([^/"]+)/g)) expect(host).toBe('example.org');
    for (const [, host] of text.matchAll(/@([\w.-]+)/g)) expect(host).toMatch(/\.example\.org$/);
    // No ROR id and no link to a register: nothing here can point at a real institution.
    expect(text).not.toMatch(/ror/i);
  });

  it('has a provider, so that services have one, and a consortium', () => {
    expect(
      DEMO_ORGANISATIONS.filter((item) => item.type === 'provider').length,
    ).toBeGreaterThanOrEqual(2);
    expect(DEMO_ORGANISATIONS.some((item) => item.type === 'consortium')).toBe(true);
  });
});

describe('the demo seed', () => {
  it('refuses, before it touches a service, when core.identity registered no demo account', async () => {
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
