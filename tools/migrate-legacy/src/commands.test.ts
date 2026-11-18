// What `plan` suggests for the legacy workaround of consortia (decision 15) and for the category it lived in.
import { describe, expect, it } from 'vitest';
import { workaroundSuggestions } from './commands.ts';
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
