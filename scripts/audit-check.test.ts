import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  evaluate,
  parseAudit,
  validateAllowlist,
  type Advisory,
  type AllowEntry,
} from './audit-check.ts';

const advisory = (id: string, severity: string): Advisory => ({
  id,
  package: 'left-pad',
  severity,
  title: 'x',
  url: 'https://github.com/advisories/' + id,
});
const entry = (id: string, expires: string): AllowEntry => ({
  id,
  package: 'left-pad',
  reason: 'Not reachable: we never call the vulnerable parser.',
  expires,
});
const A = 'GHSA-aaaa-bbbb-cccc';
const B = 'GHSA-cccc-dddd-fffc';

describe('the allow-list file of the repository', () => {
  it('is valid', () => {
    const doc: unknown = JSON.parse(readFileSync('.github/audit-allowlist.json', 'utf8'));
    expect(validateAllowlist(doc)).toEqual([]);
  });
});

describe('validateAllowlist', () => {
  it('accepts entries with a reason and an expiry', () => {
    expect(validateAllowlist({ entries: [entry(A, '2026-12-31')] })).toEqual([]);
    expect(validateAllowlist({ entries: [] })).toEqual([]);
  });

  it.each([
    ['no entries array', {}, 'entries'],
    ['not an object', { entries: [null] }, 'not an object'],
    ['a bad id', { entries: [{ ...entry(A, '2026-12-31'), id: 'CVE-2026-1' }] }, 'advisory id'],
    ['no reason', { entries: [{ ...entry(A, '2026-12-31'), reason: '' }] }, 'reason'],
    ['a short reason', { entries: [{ ...entry(A, '2026-12-31'), reason: 'later' }] }, 'reason'],
    ['no expiry', { entries: [{ ...entry(A, '2026-12-31'), expires: undefined }] }, 'expires'],
    ['a malformed expiry', { entries: [entry(A, '31.12.2026')] }, 'expires'],
    ['an impossible date', { entries: [entry(A, '2026-13-45')] }, 'expires'],
    ['a duplicate id', { entries: [entry(A, '2026-12-31'), entry(A, '2026-12-31')] }, 'twice'],
    ['an unknown field', { entries: [{ ...entry(A, '2026-12-31'), why: 'x' }] }, 'unknown fields'],
  ])('rejects %s', (_name, doc, message) => {
    expect(validateAllowlist(doc).join('\n')).toContain(message);
  });
});

describe('evaluate', () => {
  const today = '2026-10-05';

  it('blocks high and critical advisories that are not allowed', () => {
    const r = evaluate([advisory(A, 'high'), advisory(B, 'critical')], [], today);
    expect(r.blocking.map((a) => a.id)).toEqual([A, B]);
  });

  it('reports moderate and low advisories without blocking', () => {
    const r = evaluate([advisory(A, 'moderate'), advisory(B, 'low')], [], today);
    expect(r.blocking).toEqual([]);
    expect(r.reported).toHaveLength(2);
  });

  it('lets a valid entry through, also on its last day', () => {
    for (const expires of ['2026-10-05', '2027-01-01']) {
      const r = evaluate([advisory(A, 'high')], [entry(A, expires)], today);
      expect(r.blocking).toEqual([]);
      expect(r.allowed.map((a) => a.id)).toEqual([A]);
    }
  });

  it('blocks an advisory whose entry has expired, and lists the entry', () => {
    const r = evaluate([advisory(A, 'high')], [entry(A, '2026-10-04')], today);
    expect(r.blocking.map((a) => a.id)).toEqual([A]);
    expect(r.expired.map((e) => e.id)).toEqual([A]);
  });

  it('flags an expired entry even when the advisory is gone', () => {
    expect(evaluate([], [entry(A, '2026-01-01')], today).expired).toHaveLength(1);
  });

  it('does not let an entry cover another advisory', () => {
    const r = evaluate([advisory(B, 'high')], [entry(A, '2027-01-01')], today);
    expect(r.blocking.map((a) => a.id)).toEqual([B]);
    expect(r.unused.map((e) => e.id)).toEqual([A]);
  });
});

describe('parseAudit', () => {
  it('reads advisories from pnpm audit output', () => {
    const json = JSON.stringify({
      advisories: {
        '1': {
          id: 1,
          github_advisory_id: A,
          module_name: 'x',
          severity: 'high',
          title: 't',
          url: 'u',
        },
      },
    });
    expect(parseAudit(json)).toEqual([
      { id: A, package: 'x', severity: 'high', title: 't', url: 'u' },
    ]);
  });

  it('reads an empty audit', () => {
    expect(parseAudit('{"advisories":{}}')).toEqual([]);
  });

  it.each(['', 'not json', '{}', '{"error":{"code":"ENOTFOUND"}}', 'null'])(
    'throws on %j, so a broken audit never passes',
    (text) => {
      expect(() => parseAudit(text)).toThrow();
    },
  );
});
