// The vocabularies this module itself declares: the lists that docs/FEATURES.md §3 names as
// enumerations of the legacy app and §4.6 asks to make configurable. They are registry entries like
// any module's: a module that gives them a usage check adds its own entry with the same id.
//
// Keys keep the values of the legacy API (`PROD`, `Bibliographic`, `mandatory`, `sum`), so the
// migration tool and old clients need no mapping. `TERM` is a proper stage (defect 9).
import type { VocabularyEntry } from './vocabularies.ts';

const term = (key: string, en: string, sortOrder: number) => ({
  key,
  labels: { en },
  sortOrder,
});

export const BUILTIN_VOCABULARIES: VocabularyEntry[] = [
  {
    id: 'stage',
    description: 'Lifecycle stage of a service',
    terms: [
      term('DEV', 'Development', 10),
      term('DEMO', 'Demonstrator', 20),
      term('PROD', 'Production', 30),
      term('TERM', 'Terminated', 40),
    ],
  },
  {
    id: 'thematic-category',
    description: 'Thematic category of an indicator',
    terms: [
      term('Bibliographic', 'Bibliographic', 10),
      term('Usage', 'Usage', 20),
      term('Technical', 'Technical', 30),
      term('Satisfaction', 'Satisfaction', 40),
    ],
  },
  {
    id: 'necessity',
    description: 'How strongly a KPI set asks for an indicator',
    terms: [
      term('mandatory', 'Mandatory', 10),
      term('recommended', 'Recommended', 20),
      term('optional', 'Optional', 30),
    ],
  },
  {
    id: 'sender-type',
    description: 'Who an announcement comes from',
    terms: [term('System', 'System', 10), term('Reviewer', 'Reviewer', 20)],
  },
  {
    id: 'aggregate',
    description: 'How the values of a period are combined into one',
    terms: [
      term('sum', 'Sum', 10),
      term('avg', 'Average', 20),
      term('min', 'Minimum', 30),
      term('max', 'Maximum', 40),
    ],
  },
];
