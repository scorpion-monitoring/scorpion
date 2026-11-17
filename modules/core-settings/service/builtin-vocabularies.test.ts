// The seed of the vocabularies the module declares: every term has its English label, and the terms of `aggregate` (shown on the impact table of
// kpi.impact in the person's language) carry a German one. A database that was seeded before keeps the labels it has: terms are inserted when they
// are missing and never overwritten, so an instance adds a German label in the vocabulary editor, and until then the page shows the English one.
import { describe, expect, it } from 'vitest';
import { BUILTIN_VOCABULARIES } from './builtin-vocabularies.ts';

const terms = (id: string) => BUILTIN_VOCABULARIES.find((entry) => entry.id === id)?.terms ?? [];

describe('the built-in vocabularies', () => {
  it('give every term an English label, the language every other falls back to', () => {
    for (const vocabulary of BUILTIN_VOCABULARIES)
      for (const term of vocabulary.terms ?? [])
        expect(term.labels.en, `${vocabulary.id} ${term.key}`).toBeTruthy();
  });

  it('give the four aggregates a German label', () => {
    expect(terms('aggregate').map((term) => [term.key, term.labels.de])).toEqual([
      ['sum', 'Summe'],
      ['avg', 'Durchschnitt'],
      ['min', 'Minimum'],
      ['max', 'Maximum'],
    ]);
  });
});
