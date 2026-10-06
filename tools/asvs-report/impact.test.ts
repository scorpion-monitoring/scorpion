import { describe, expect, it } from 'vitest';
import { checkImpact, noImpactReason } from './impact.ts';

const scoped = 'modules/core-authz/service/authz.ts';
const yaml = 'docs/security/asvs/v8-authorization.yaml';
const label = ['asvs-no-impact'];
const reason = 'ASVS impact: none because only a comment changed';

describe('checkImpact', () => {
  it('passes when no scoped path changed', () => {
    const result = checkImpact({
      changedFiles: ['modules/kpi-ingestion/a.ts', 'README.md'],
      labels: [],
      description: '',
    });
    expect(result).toMatchObject({ ok: true, impacted: [], missing: [] });
  });

  it('fails on a scoped change without the chapter file', () => {
    const result = checkImpact({ changedFiles: [scoped], labels: [], description: '' });
    expect(result).toMatchObject({ ok: false, impacted: ['V8'], missing: ['V8'] });
    expect(result.message).toContain('docs/security/asvs/v8-authorization.yaml');
  });

  it('fails when the chapter file of another chapter changed', () => {
    const result = checkImpact({
      changedFiles: [scoped, 'docs/security/asvs/v6-authentication.yaml'],
      labels: [],
      description: '',
    });
    expect(result.ok).toBe(false);
  });

  it('fails when only the generated report changed', () => {
    const result = checkImpact({
      changedFiles: [scoped, 'docs/security/asvs/v8-authorization.md'],
      labels: [],
      description: '',
    });
    expect(result.ok).toBe(false);
  });

  it('passes a scoped change with the chapter YAML', () => {
    expect(
      checkImpact({ changedFiles: [scoped, yaml], labels: [], description: '' }),
    ).toMatchObject({ ok: true, missing: [] });
  });

  it('asks only for the chapters the change affects', () => {
    const result = checkImpact({
      changedFiles: ['modules/core-identity/a.ts', 'docs/security/asvs/v6-authentication.yaml'],
      labels: [],
      description: '',
    });
    expect(result).toMatchObject({ ok: false, missing: ['V7', 'V10'] });
  });

  it('passes with the label and a reason', () => {
    const result = checkImpact({
      changedFiles: [scoped],
      labels: label,
      description: `Text\n\n${reason}\n`,
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('only a comment changed');
  });

  it('fails with the label and no reason', () => {
    const result = checkImpact({
      changedFiles: [scoped],
      labels: label,
      description: 'No line here',
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('has no line');
  });

  it('fails with the reason and no label', () => {
    expect(checkImpact({ changedFiles: [scoped], labels: ['other'], description: reason }).ok).toBe(
      false,
    );
  });

  it('fails with the placeholder of the pull request template', () => {
    expect(
      checkImpact({
        changedFiles: [scoped],
        labels: label,
        description: 'ASVS impact: none because …',
      }).ok,
    ).toBe(false);
  });

  it('treats a description that tries shell injection as text', () => {
    const injection = '"; touch /tmp/pwned; echo "$(id)" `id` ${{ github.token }}';
    const without = checkImpact({
      changedFiles: [scoped],
      labels: [injection],
      description: injection,
    });
    expect(without.ok).toBe(false);
    const withReason = checkImpact({
      changedFiles: [scoped],
      labels: label,
      description: `ASVS impact: none because ${injection}`,
    });
    // It is a reason like any other: accepted as data, and only ever printed.
    expect(withReason.ok).toBe(true);
    expect(withReason.message).toContain(injection);
  });
});

describe('noImpactReason', () => {
  it.each([
    [reason, 'only a comment changed'],
    ['  ASVS impact: none because   a rename  ', 'a rename'],
    ['asvs impact: none because the docs changed', 'the docs changed'],
    ['text\nASVS impact: none because a rename\nmore', 'a rename'],
  ])('reads %j', (text, expected) => {
    expect(noImpactReason(text)).toBe(expected);
  });

  it.each([
    [''],
    ['ASVS impact: none because'],
    ['ASVS impact: none because …'],
    ['ASVS impact: none because ...'],
    ['ASVS impact: none because <reason>'],
    ['ASVS impact: none because ok'],
    ['The ASVS impact: none because a rename, mid-line'],
  ])('finds no reason in %j', (text) => {
    expect(noImpactReason(text)).toBeUndefined();
  });
});
