// What `plan` suggests for the legacy workaround of consortia (decision 15) and for the category it lived in, and how a run
// recognises the account it created for a user (ADR-0053).
import { describe, expect, it } from 'vitest';
import { workaroundSuggestions } from './commands.ts';
import { isMigratedAccount } from './load-people.ts';
import type { Snapshot } from './snapshot.ts';

const row = (abbreviation: string, provider: string, category: string) => ({
  abbreviation,
  name: abbreviation,
  category,
  provider,
  license: null,
  consortia: [],
  stage: null,
});

describe('workaroundSuggestions', () => {
  it('drops a service named like its provider, makes the provider a consortium, and drops a category that holds only those', () => {
    const snapshot = {
      services: [
        row('GeneFlow', 'BioNet', 'Tools'),
        row('PlantHub', 'PlantHub', 'Consortia'),
        row('SeedHub', 'SeedHub', 'Consortia'),
      ],
    } as unknown as Snapshot;
    const { mapping, open } = workaroundSuggestions(snapshot);
    expect(mapping.services).toEqual({ PlantHub: { drop: true }, SeedHub: { drop: true } });
    expect(mapping.providers).toEqual({
      PlantHub: { type: 'consortium' },
      SeedHub: { type: 'consortium' },
    });
    expect(mapping.kpiSets).toEqual({ Consortia: { drop: true } });
    expect(open.filter((line) => line.startsWith('kpiSets'))).toHaveLength(1);
  });

  it('keeps a category that also holds a real service', () => {
    const snapshot = {
      services: [row('PlantHub', 'PlantHub', 'Mixed'), row('GeneFlow', 'BioNet', 'Mixed')],
    } as unknown as Snapshot;
    expect(workaroundSuggestions(snapshot).mapping.kpiSets).toEqual({});
  });
});

describe('isMigratedAccount', () => {
  const op = { provider: 'ls-login', claimUsername: 'Ann.Legacy', username: 'ann-legacy' };
  it.each([
    [
      'the claim this user would get',
      { username: 'x' },
      { provider: 'ls-login', username: 'ann.legacy' },
      true,
    ],
    [
      'a claim at another provider',
      { username: 'ann-legacy' },
      { provider: 'other', username: 'ann.legacy' },
      false,
    ],
    [
      'a claim for another name',
      { username: 'ann-legacy' },
      { provider: 'ls-login', username: 'ann' },
      false,
    ],
    [
      'claimed, with the username the migration gave it',
      { username: 'ann-legacy' },
      undefined,
      true,
    ],
    [
      'no claim and another username (someone else holds the address)',
      { username: 'someone' },
      undefined,
      false,
    ],
  ])('%s → %s', (_name, found, claim, expected) => {
    expect(isMigratedAccount(found, claim, op)).toBe(expected);
  });
});
