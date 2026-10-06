import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from './cli.ts';
import { PATHS } from './config.ts';
import { baseAssessment, makeRepo, naEntries, writeAssessment } from './fixtures.ts';
import { sha256 } from './source.ts';

const options = (root: string, extra: Record<string, boolean> = {}) => ({
  root,
  write: false,
  ci: false,
  release: false,
  ...extra,
});
const edit = (root: string, path: string, change: (text: string) => string) =>
  writeFileSync(join(root, path), change(readFileSync(join(root, path), 'utf8')));

describe('run, over a repository whose files are all generated', () => {
  it('finds nothing to complain about, and every chapter is in progress', () => {
    const outcome = run(options(makeRepo()));
    expect(outcome.problems).toEqual([]);
    expect([...outcome.statuses.values()]).toEqual([
      'in progress',
      'in progress',
      'in progress',
      'in progress',
    ]);
  });

  it('writes nothing on a second --write', () => {
    expect(run(options(makeRepo(), { write: true })).written).toEqual([]);
  });

  it('shows the four ASVS badges as in progress', () => {
    const readme = readFileSync(join(makeRepo(), PATHS.readme), 'utf8');
    expect(
      readme.match(/img\.shields\.io\/badge\/ASVS_5\.0_L2_[A-Za-z0-9_.]+-in_progress-yellow/g),
    ).toHaveLength(4);
    expect(readme).toContain('https://www.bestpractices.dev/projects/15237/badge');
  });
});

describe('rule 6: the generated files', () => {
  it('fails on a hand-edited badge', () => {
    const root = makeRepo();
    edit(root, PATHS.readme, (text) =>
      text.replace('in_progress-yellow', 'self--assessed-brightgreen'),
    );
    const problems = run(options(root)).problems;
    expect(problems).toEqual([expect.stringContaining('badge block')]);
  });

  it('fails on a hand-edited report', () => {
    const root = makeRepo();
    edit(root, 'docs/security/asvs/v6-authentication.md', (text) => text.replace('n/a', 'pass'));
    expect(run(options(root)).problems).toEqual([
      expect.stringContaining('v6-authentication.md is not what'),
    ]);
  });

  it('fails on a missing report', () => {
    const root = makeRepo();
    writeFileSync(join(root, 'docs/security/asvs/v8-authorization.md'), '');
    expect(run(options(root)).problems).toHaveLength(1);
  });

  it('fails when the README has no badge block', () => {
    const root = makeRepo();
    writeFileSync(join(root, PATHS.readme), '# Project\n');
    expect(run(options(root)).problems).toEqual([
      expect.stringContaining('no security-badges block'),
    ]);
  });

  it('--write repairs both', () => {
    const root = makeRepo();
    edit(root, PATHS.readme, (text) => text.replace('in_progress', 'x'));
    edit(root, 'docs/security/asvs/v6-authentication.md', () => 'edited');
    const outcome = run(options(root, { write: true }));
    expect(outcome.written.sort()).toEqual([
      'README.md',
      'docs/security/asvs/v6-authentication.md',
    ]);
    expect(run(options(root)).problems).toEqual([]);
  });

  it('escapes a backslash before a pipe, so that "\\|" in a note cannot close its table cell', () => {
    const root = makeRepo();
    writeAssessment(
      root,
      'V7',
      baseAssessment('V7', [{ id: 'v5.0.0-7.1.1', status: 'n/a', reason: 'a \\| b' }]),
    );
    run(options(root, { write: true }));
    const report = readFileSync(join(root, 'docs/security/asvs/v7-session-management.md'), 'utf8');
    expect(report).toContain('a \\\\\\| b');
  });

  it('puts the real requirement text, escaped, and "not yet assessed by a person" into the report', () => {
    const report = readFileSync(
      join(makeRepo(), 'docs/security/asvs/v6-authentication.md'),
      'utf8',
    );
    expect(report).toContain('not yet assessed by a person');
    expect(report).toContain('Verify requirement 6.1.1 \\| with a pipe');
    expect(report).not.toContain('6.1.3');
  });
});

describe('rule 1: the pinned source', () => {
  it('fails on a changed source file (hash mismatch)', () => {
    const root = makeRepo();
    edit(root, PATHS.source, (text) => text.replace('Section', 'Altered'));
    expect(run(options(root)).problems[0]).toMatch(/does not match its recorded SHA-256/);
  });

  it('fails on a missing id and on an unknown id in a chapter file', () => {
    const root = makeRepo();
    writeAssessment(root, 'V6', baseAssessment('V6', naEntries('V6').slice(1)));
    expect(run(options(root, { write: true })).problems).toEqual([
      expect.stringContaining('missing requirement v5.0.0-6.1.1'),
    ]);
    writeAssessment(
      root,
      'V6',
      baseAssessment('V6', [
        ...naEntries('V6'),
        { id: 'v5.0.0-6.7.7', status: 'n/a', reason: 'made up' },
      ]),
    );
    expect(run(options(root, { write: true })).problems).toEqual([
      expect.stringContaining('unknown requirement id'),
    ]);
  });

  it('fails on a fail without an issue link', () => {
    const root = makeRepo();
    writeAssessment(
      root,
      'V7',
      baseAssessment('V7', [{ id: 'v5.0.0-7.1.1', status: 'fail', note: 'later' }]),
    );
    expect(run(options(root, { write: true })).problems).toEqual([
      expect.stringContaining('fail needs a note that links to an issue'),
    ]);
  });
});

describe('rule 2: test evidence from the reports', () => {
  const passing = (root: string) =>
    writeAssessment(
      root,
      'V7',
      baseAssessment('V7', [
        { id: 'v5.0.0-7.1.1', status: 'pass', evidence: [{ test: 'ASVS-7.1.1' }] },
      ]),
    );
  const report = (root: string, file: string, body: string) => {
    mkdirSync(join(root, PATHS.reportsDir), { recursive: true });
    writeFileSync(join(root, file), `<testsuites>${body}</testsuites>`);
  };
  const ok = '<testcase name="a [ASVS-7.1.1]"/>';

  it('accepts a pass whose tag matches a passed test', () => {
    const root = makeRepo();
    passing(root);
    report(root, PATHS.vitestReport, ok);
    report(root, PATHS.playwrightReport, '<testcase name="other"/>');
    const outcome = run(options(root, { write: true, ci: true }));
    expect(outcome.problems).toEqual([]);
    expect(outcome.unverified).toEqual([]);
  });

  it('fails a pass whose tag matches no passed test', () => {
    const root = makeRepo();
    passing(root);
    report(root, PATHS.vitestReport, '<testcase name="a [ASVS-7.1.1]"><failure/></testcase>');
    report(root, PATHS.playwrightReport, '<testcase name="other"/>');
    expect(run(options(root, { write: true })).problems).toEqual([
      expect.stringContaining('ASVS-7.1.1'),
    ]);
  });

  it('without reports, lists the tags it could not check and passes locally', () => {
    const root = makeRepo();
    passing(root);
    const outcome = run(options(root, { write: true }));
    expect(outcome.problems).toEqual([]);
    expect(outcome.unverified).toEqual(['ASVS-7.1.1']);
  });

  it('without reports, fails in CI mode', () => {
    const root = makeRepo();
    passing(root);
    const problems = run(options(root, { write: true, ci: true })).problems;
    expect(problems.filter((p) => p.includes('JUnit report'))).toHaveLength(2);
  });

  it('fails in CI mode on an empty report', () => {
    const root = makeRepo();
    report(root, PATHS.vitestReport, '');
    report(root, PATHS.playwrightReport, ok);
    expect(run(options(root, { ci: true })).problems).toEqual([
      expect.stringContaining('holds no test case'),
    ]);
  });
});

describe('rule 5: stale, on a release branch', () => {
  function gitRepo(assessedCommit: boolean) {
    const root = makeRepo();
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.org');
    git('config', 'user.name', 't');
    mkdirSync(join(root, 'modules/core-authz'), { recursive: true });
    writeFileSync(join(root, 'modules/core-authz/a.ts'), '1');
    git('add', '-A');
    git('commit', '-q', '-m', 'one');
    const commit = git('rev-parse', 'HEAD');
    writeFileSync(join(root, 'modules/core-authz/a.ts'), '2');
    git('commit', '-q', '-am', 'two');
    writeAssessment(root, 'V8', {
      ...baseAssessment('V8'),
      assessed_commit: assessedCommit ? commit : null,
    });
    run(options(root, { write: true }));
    return root;
  }

  it('fails a chapter with an assessed_commit and a scoped change after it', () => {
    const outcome = run(options(gitRepo(true), { release: true, write: true }));
    expect(outcome.problems).toEqual([
      expect.stringContaining('V8: scoped paths changed after assessed_commit'),
    ]);
    expect(outcome.statuses.get('V8')).toBe('stale');
  });

  it('does not fail a chapter that has no assessed_commit', () => {
    const outcome = run(options(gitRepo(false), { release: true }));
    expect(outcome.problems).toEqual([]);
    expect(outcome.statuses.get('V8')).toBe('in progress');
  });

  it('does not look at git outside a release', () => {
    expect(run(options(gitRepo(true))).problems).toEqual([]);
  });
});

describe('the pinned file of the repository', () => {
  it('records a hash that matches', () => {
    const dir = new URL('../../docs/security/asvs/source/', import.meta.url);
    const raw = readFileSync(new URL('OWASP_ASVS_5.0.0_en.json', dir));
    expect(readFileSync(new URL('README.md', dir), 'utf8')).toContain(sha256(raw));
  });
});
