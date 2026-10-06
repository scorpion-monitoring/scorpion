import { describe, expect, it } from 'vitest';
import {
  deriveStatus,
  parseAssessment,
  validate,
  type Assessment,
  type Entry,
  type ValidationContext,
} from './assessment.ts';
import { CHAPTERS } from './config.ts';
import { baseAssessment, miniSource, naEntries, requirementId } from './fixtures.ts';
import { readChapter } from './source.ts';

const config = CHAPTERS[0]!;
const chapter = readChapter(miniSource(), config);
const tags = (passed: string[] = [], failed: string[] = []) => ({
  passed: new Set(passed),
  failed: new Set(failed),
});
const context = (overrides: Partial<ValidationContext> = {}): ValidationContext => ({
  tags: tags(),
  exists: (path) => path === 'README.md',
  anchors: (path) => (path === 'docs/m4b-sprint-plan.md' ? ['4-sprint-1-sessions'] : undefined),
  ...overrides,
});

const entries = (...overrides: Partial<Entry>[]): Entry[] => [
  { ...naEntries('V6')[0]!, ...overrides[0] },
  { ...naEntries('V6')[1]!, ...overrides[1] },
];
const check = (requirements: Entry[], extra: Partial<Assessment> = {}, ctx = context()) =>
  validate({ ...baseAssessment('V6', requirements), ...extra }, config, chapter, ctx);

describe('rule 1: every requirement exactly once', () => {
  it('accepts a complete file', () => {
    expect(check(naEntries('V6')).problems).toEqual([]);
  });

  it('fails on a missing id', () => {
    expect(check(naEntries('V6').slice(0, 1)).problems).toEqual([
      'V6: missing requirement v5.0.0-6.1.2',
    ]);
  });

  it('fails on an unknown id', () => {
    const problems = check([
      ...naEntries('V6'),
      { id: 'v5.0.0-6.9.9', status: 'n/a', reason: 'invented' },
    ]).problems;
    expect(problems).toEqual([expect.stringMatching(/unknown requirement id v5.0.0-6.9.9/)]);
  });

  it('treats a Level 3 requirement as unknown', () => {
    const problems = check([
      ...naEntries('V6'),
      { id: 'v5.0.0-6.1.3', status: 'n/a', reason: 'level 3' },
    ]).problems;
    expect(problems).toEqual([expect.stringMatching(/unknown requirement id v5.0.0-6.1.3/)]);
  });

  it('fails on a duplicate', () => {
    const problems = check([
      ...naEntries('V6'),
      { id: 'v5.0.0-6.1.1', status: 'n/a', reason: 'again' },
    ]).problems;
    expect(problems).toEqual(['V6: v5.0.0-6.1.1 appears more than once']);
  });

  it('fails on a wrong version, level or chapter', () => {
    const problems = check(naEntries('V6'), {
      asvs_version: '4.0.3',
      level: 3,
      chapter: 'V7',
    }).problems;
    expect(problems).toHaveLength(3);
  });
});

describe('rule 2: pass needs evidence that exists and runs', () => {
  const pass = (evidence?: Entry['evidence']): Entry[] =>
    entries({ status: 'pass', evidence, reason: undefined });

  it('fails without evidence', () => {
    expect(check(pass()).problems).toEqual([
      'v5.0.0-6.1.1: pass needs at least one piece of evidence',
    ]);
  });

  it('accepts a tag that a passed test carries', () => {
    expect(
      check(pass([{ test: 'ASVS-6.1.1' }]), {}, context({ tags: tags(['6.1.1']) })).problems,
    ).toEqual([]);
  });

  it('fails on a tag that matches no passed test', () => {
    expect(
      check(pass([{ test: 'ASVS-6.1.1' }]), {}, context({ tags: tags(['6.1.2']) })).problems,
    ).toEqual(['v5.0.0-6.1.1: no test tagged [ASVS-6.1.1] passed in this run']);
  });

  it('fails when a test with the tag failed, even if another passed', () => {
    const ctx = context({ tags: tags(['6.1.1'], ['6.1.1']) });
    expect(check(pass([{ test: 'ASVS-6.1.1' }]), {}, ctx).problems).toEqual([
      'v5.0.0-6.1.1: a test tagged [ASVS-6.1.1] failed in this run',
    ]);
  });

  it('fails on the tag of another requirement', () => {
    const ctx = context({ tags: tags(['6.1.2']) });
    expect(check(pass([{ test: 'ASVS-6.1.2' }]), {}, ctx).problems[0]).toMatch(
      /must be the tag "ASVS-6.1.1"/,
    );
  });

  it('without reports it lists the tag as unverified and does not fail', () => {
    const result = check(pass([{ test: 'ASVS-6.1.1' }]), {}, context({ tags: undefined }));
    expect(result.problems).toEqual([]);
    expect(result.unverified).toEqual(['6.1.1']);
  });

  it('accepts code and doc paths that exist', () => {
    expect(check(pass([{ code: 'README.md' }, { doc: 'README.md' }])).problems).toEqual([]);
  });

  it.each([
    [{ code: 'missing.ts' }, /does not exist/],
    [{ doc: '../outside.md' }, /relative and inside the repository/],
    [{ code: '/etc/passwd' }, /relative and inside the repository/],
    [{ code: 'README.md', test: 'ASVS-6.1.1' }, /exactly one/],
    [{}, /exactly one/],
  ])('fails on the evidence %j', (item, message) => {
    expect(check(pass([item])).problems[0]).toMatch(message);
  });
});

describe('rule 3: n/a needs a reason, fail needs an issue', () => {
  it('fails on n/a without a reason', () => {
    expect(check(entries({ reason: ' ' })).problems).toEqual(['v5.0.0-6.1.1: n/a needs a reason']);
  });

  it('fails on one reason copied to two requirements', () => {
    const problems = check(entries({ reason: 'Same text' }, { reason: 'Same  text' })).problems;
    expect(problems).toEqual([expect.stringMatching(/same text as v5.0.0-6.1.1/)]);
  });

  it.each([[undefined], [''], ['no issue yet'], ['see issue 12'], ['see #']])(
    'fails on a fail with the note %j',
    (note) => {
      expect(check(entries({ status: 'fail', note })).problems).toEqual([
        'v5.0.0-6.1.1: fail needs a note that links to an issue (#123 or its URL) or to a sprint plan section (docs/<plan>.md#<heading>)',
      ]);
    },
  );

  it.each([
    ['Tracked in #12'],
    ['#12'],
    ['https://github.com/scorpion-monitoring/scorpion/issues/12'],
  ])('accepts a fail with the note %j', (note) => {
    expect(check(entries({ status: 'fail', note })).problems).toEqual([]);
  });

  it('accepts a fail whose note links a heading of a sprint plan', () => {
    const note = 'Fix planned in docs/m4b-sprint-plan.md#4-sprint-1-sessions.';
    expect(check(entries({ status: 'fail', note })).problems).toEqual([]);
  });

  it.each([
    [
      'docs/m4b-sprint-plan.md#9-no-such-heading',
      /has no heading with the anchor #9-no-such-heading/,
    ],
    ['docs/m9-sprint-plan.md#4-sprint-1-sessions', /plan docs\/m9-sprint-plan.md does not exist/],
  ])('refuses a plan link to %s', (link, message) => {
    expect(check(entries({ status: 'fail', note: `Planned: ${link}` })).problems[0]).toMatch(
      message,
    );
  });

  it('does not take a plain file link or a link outside docs as a plan section', () => {
    expect(
      check(entries({ status: 'fail', note: 'See docs/backlog.md#later' })).problems,
    ).toHaveLength(1);
    expect(
      check(entries({ status: 'fail', note: 'See ../x/m4b-sprint-plan.md#a' })).problems,
    ).toHaveLength(1);
  });

  it('does not take an issue of another repository', () => {
    expect(
      check(entries({ status: 'fail', note: 'https://github.com/other/repo/issues/12' })).problems,
    ).toHaveLength(1);
  });

  it('fails on a status that is not pass, fail or n/a', () => {
    expect(check(entries({ status: 'accepted-risk' as never })).problems[0]).toMatch(
      /status must be pass, fail or n\/a/,
    );
  });

  it('counts the statuses', () => {
    const result = check(entries({ status: 'fail', note: '#1' }));
    expect(result.counts).toEqual({ pass: 0, fail: 1, 'n/a': 1 });
  });
});

describe('rule 4: the human fields', () => {
  const sha = 'a'.repeat(40);

  it('fails on a second pass less than 7 days after the assessment', () => {
    const problems = check(naEntries('V6'), {
      assessed_on: '2026-11-20',
      second_pass: { by: 'x', on: '2026-11-26' },
    }).problems;
    expect(problems).toEqual(['V6: second_pass.on must be at least 7 days after assessed_on']);
  });

  it('accepts a second pass exactly 7 days later', () => {
    expect(
      check(naEntries('V6'), {
        assessed_on: '2026-11-20',
        second_pass: { by: 'x', on: '2026-11-27' },
      }).problems,
    ).toEqual([]);
  });

  it('fails on a second pass without an assessment date', () => {
    expect(
      check(naEntries('V6'), { second_pass: { by: 'x', on: '2026-11-27' } }).problems[0],
    ).toMatch(/assessed_on is not/);
  });

  it.each(['peer', 'external'] as const)(
    'needs a reviewer for %s, different from the assessor',
    (type) => {
      expect(check(naEntries('V6'), { assessment_type: type, assessor: 'a' }).problems[0]).toMatch(
        /needs a reviewer/,
      );
      expect(
        check(naEntries('V6'), { assessment_type: type, assessor: 'a', reviewer: 'a' }).problems[0],
      ).toMatch(/must differ/);
      expect(
        check(naEntries('V6'), { assessment_type: type, assessor: 'a', reviewer: 'b' }).problems,
      ).toEqual([]);
    },
  );

  it('fails on an unknown type, a short commit and a badly written date', () => {
    const problems = check(naEntries('V6'), {
      assessment_type: 'audit' as never,
      assessed_commit: 'abc123',
      assessed_on: '20.11.2026',
    }).problems;
    expect(problems).toHaveLength(3);
    expect(check(naEntries('V6'), { assessed_commit: sha }).problems).toEqual([]);
  });
});

describe('rule 5: the derived status', () => {
  const complete: Partial<Assessment> = {
    assessment_type: 'self',
    assessor: 'a',
    assessed_commit: 'a'.repeat(40),
    assessed_on: '2026-11-20',
    second_pass: { by: 'a', on: '2026-11-27' },
  };
  const derive = (extra: Partial<Assessment>, requirements = naEntries('V6'), stale?: boolean) => {
    const assessment = { ...baseAssessment('V6', requirements), ...extra };
    return deriveStatus({
      assessment,
      validation: validate(assessment, config, chapter, context()),
      staleSinceAssessment: stale,
    });
  };

  it('is in progress while the human fields are empty, however complete the entries are', () => {
    expect(derive({})).toBe('in progress');
  });

  it('is in progress with any fail', () => {
    expect(derive(complete, entries({ status: 'fail', note: '#1' }))).toBe('in progress');
  });

  it('is in progress when rules 1 to 4 are not met', () => {
    expect(derive(complete, naEntries('V6').slice(0, 1))).toBe('in progress');
    expect(derive({ ...complete, second_pass: { by: 'a', on: '2026-11-21' } })).toBe('in progress');
  });

  it.each([
    ['self', 'self-assessed', {}],
    ['peer', 'peer-reviewed', { reviewer: 'b' }],
    ['external', 'externally verified', { reviewer: 'b' }],
  ] as const)('is derived for %s', (type, status, extra) => {
    expect(derive({ ...complete, assessment_type: type, ...extra })).toBe(status);
  });

  it('is stale for a chapter with an assessed_commit and a scoped change after it', () => {
    expect(derive(complete, undefined, true)).toBe('stale');
  });

  it('is never stale for a chapter without an assessed_commit (Decision 6)', () => {
    expect(derive({}, undefined, true)).toBe('in progress');
  });
});

describe('parseAssessment', () => {
  it('reads the file format of docs/implementation.md §8.2', () => {
    const parsed = parseAssessment(`
asvs_version: 5.0.0
level: 2
chapter: V6
assessment_type: null
assessed_commit: null
assessed_on: null
assessor: null
second_pass: null
reviewer: null
requirements:
  - id: ${requirementId('6.1.1')}
    status: pass
    evidence:
      - test: ASVS-6.1.1
    note: text
`);
    expect(parsed.asvs_version).toBe('5.0.0');
    expect(parsed.requirements[0]?.evidence).toEqual([{ test: 'ASVS-6.1.1' }]);
    expect(parsed.assessed_on).toBeNull();
  });

  it('keeps a date as written', () => {
    expect(parseAssessment('assessed_on: 2026-11-20').assessed_on).toBe('2026-11-20');
  });

  it('refuses a file that is not a mapping', () => {
    expect(() => parseAssessment('- a\n- b')).toThrow(/not a YAML mapping/);
  });
});
