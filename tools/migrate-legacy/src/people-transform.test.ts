// The rules for users, roles and memberships (plan §3) as tables: usernames, addresses, subjects, roles and memberships.
import { describe, expect, it } from 'vitest';
import { emptyMapping, type Mapping } from './mapping.ts';
import { MAX_PENDING, transformPeople } from './people-transform.ts';
import { fitUsername, resolveTerm, uniqueUsername } from './rules.ts';
import { parseSubjects, SubjectsError } from './subjects.ts';

describe('fitUsername', () => {
  it.each([
    ['alice', 'alice', false],
    ['Alice', 'alice', true],
    ['alice.smith', 'alice-smith', true],
    ['alice@example.org', 'alice-example-org', true],
    ['Zoë Müller', 'zoe-muller', true],
    ['__a__', 'a00', true],
    ['ab', 'ab0', true],
    ['a', 'a00', true],
    ['', 'user', true],
    ['!!!', 'user', true],
    ['x'.repeat(40), 'x'.repeat(31), true],
    ['a-'.repeat(20), `${'a-'.repeat(15)}a`, true],
  ])('%j → %j (changed: %s)', (raw, value, changed) => {
    expect(fitUsername(raw)).toEqual({ value, changed });
    expect(value).toMatch(/^[a-z0-9_-]{3,31}$/);
  });
});

describe('uniqueUsername', () => {
  it.each([
    ['bob', [], 'bob'],
    ['bob', ['bob'], 'bob-2'],
    ['bob', ['bob', 'bob-2'], 'bob-3'],
    ['x'.repeat(31), ['x'.repeat(31)], `${'x'.repeat(29)}-2`],
  ])('%j with %j taken → %j', (name, taken, expected) => {
    expect(uniqueUsername(name, new Set(taken))).toBe(expected);
  });
});

describe('resolveTerm', () => {
  const terms = ['mandatory', 'optional'];
  it.each([
    ['mandatory', { ok: true, key: 'mandatory' }],
    ['Mandatory', { ok: true, key: 'mandatory', rule: 'respelled' }],
    ['required', { ok: false, rule: 'unknown' }],
    [null, { ok: true, key: 'mandatory', rule: 'missing-mapped' }],
    ['', { ok: true, key: 'mandatory', rule: 'missing-mapped' }],
  ])('%j', (spelling, expected) => {
    expect(resolveTerm(spelling, terms, {}, 'mandatory')).toEqual(expected);
  });
  it('uses the mapping for a spelling, and has no default when the default is not a term', () => {
    expect(resolveTerm('required', terms, { required: 'mandatory' }, null)).toEqual({
      ok: true,
      key: 'mandatory',
      rule: 'mapped',
    });
    expect(resolveTerm(null, terms, {}, 'nonsense')).toEqual({ ok: false, rule: 'missing' });
  });
});

describe('parseSubjects', () => {
  it('reads tab or comma separated pairs, ignores comments and blank lines, and finds ambiguous usernames', () => {
    const subjects = parseSubjects(
      '# header\n\nsub-1\tAlice\nsub-2,bob\nsub-3\tbob\nsub-1\tAlice\n',
    );
    expect([...subjects.byUsername]).toEqual([
      ['alice', 'sub-1'],
      ['bob', 'sub-2'],
    ]);
    expect([...subjects.ambiguous]).toEqual(['bob']);
    expect(subjects.lines).toBe(4);
  });
  it.each(['one-column', 'a\tb\tc', '\tname', `${'s'.repeat(256)}\tname`])('refuses %j', (line) => {
    expect(() => parseSubjects(line)).toThrow(SubjectsError);
  });
});

const user = (
  user_name: string,
  email: string,
  extra: { is_admin?: boolean; providers?: string[] } = {},
) => ({
  user_name,
  email,
  is_admin: extra.is_admin ?? false,
  providers: extra.providers ?? [],
});
const subjects = (...pairs: [string, string][]) =>
  parseSubjects(pairs.map(([s, u]) => `${s}\t${u}`).join('\n'));
const registry = {
  providers: [
    { kind: 'provider' as const, legacy: 'BioNet', abbreviation: 'BioNet', name: 'BioNet' },
  ],
};
const plan = (
  users: ReturnType<typeof user>[],
  known: ReturnType<typeof subjects>,
  options: {
    mapping?: Partial<Mapping>;
    provider?: string | null;
    requests?: { id: string; mail: string; username: string; provider: string }[];
  } = {},
) =>
  transformPeople(
    { users, membershipRequests: options.requests ?? [], providers: [] },
    known,
    { ...emptyMapping(), ...options.mapping },
    options.provider === undefined ? 'ls-login' : options.provider,
    registry,
  );
const rules = (p: ReturnType<typeof plan>) => p.findings.map((f) => `${f.legacy}:${f.rule}`).sort();

describe('transformPeople', () => {
  it('migrates a user with the identity, the fitted username and the role', () => {
    const p = plan(
      [
        user('Alice.Smith', 'alice@example.org', { is_admin: true }),
        user('bob', 'bob@example.org'),
      ],
      subjects(['s-a', 'alice.smith'], ['s-b', 'bob']),
    );
    expect(p.users).toEqual([
      {
        legacy: 'Alice.Smith',
        username: 'alice-smith',
        email: 'alice@example.org',
        provider: 'ls-login',
        subject: 's-a',
        role: 'admin',
      },
      {
        legacy: 'bob',
        username: 'bob',
        email: 'bob@example.org',
        provider: 'ls-login',
        subject: 's-b',
        role: 'user',
      },
    ]);
    expect(rules(p)).toEqual(['Alice.Smith:user.admin', 'Alice.Smith:user.username-fitted']);
  });

  it('gives a username that two legacy users end up with a suffix, in the order of the legacy names', () => {
    const p = plan(
      [user('bob.x', 'b1@example.org'), user('bob-x', 'b2@example.org')],
      subjects(['s-1', 'bob.x'], ['s-2', 'bob-x']),
    );
    // "bob-x" sorts before "bob.x" in code-unit order, so it keeps the name.
    expect(p.users.map((u) => [u.legacy, u.username])).toEqual([
      ['bob-x', 'bob-x'],
      ['bob.x', 'bob-x-2'],
    ]);
  });

  it.each([
    [
      'an address used twice: neither is migrated',
      [user('ann', 'x@example.org'), user('ben', 'X@Example.org')],
      ['ann:user.email-duplicate', 'ben:user.email-duplicate'],
    ],
    ['an address that is not one', [user('ann', 'not an address')], ['ann:user.email-invalid']],
    [
      'no subject',
      [user('ann', 'a@example.org'), user('nosub', 'n@example.org')],
      ['nosub:user.subject-missing'],
    ],
  ])('%s', (_name, users, expected) => {
    const p = plan(users, subjects(['s-a', 'ann'], ['s-b', 'ben']));
    expect(rules(p).filter((r) => !r.includes('username-fitted'))).toEqual(expected);
  });

  it('refuses a subject two usernames share, and a username the file gives two subjects for', () => {
    const shared = plan(
      [user('ann', 'a@example.org'), user('ben', 'b@example.org')],
      subjects(['s', 'ann'], ['s', 'ben']),
    );
    expect(rules(shared)).toEqual(['ben:user.subject-duplicate']);
    const ambiguous = plan([user('ann', 'a@example.org')], parseSubjects('s1\tann\ns2\tann'));
    expect(rules(ambiguous)).toEqual(['ann:user.subject-ambiguous']);
  });

  it('migrates no one without a provider id, and says where to give one', () => {
    const p = plan([user('ann', 'a@example.org')], subjects(['s', 'ann']), { provider: null });
    expect(p.users).toEqual([]);
    expect(p.findings[0]).toMatchObject({ rule: 'user.provider-open', gap: 'oidcProvider' });
    const bad = plan([user('ann', 'a@example.org')], subjects(['s', 'ann']), { provider: 'Local' });
    expect(bad.findings[0]).toMatchObject({ rule: 'user.provider-open' });
  });

  it('lets the mapping give an address, a username or drop a user', () => {
    const p = plan(
      [
        user('ann', 'dup@example.org'),
        user('ben', 'dup@example.org'),
        user('cat', 'c@example.org'),
      ],
      subjects(['s-a', 'ann'], ['s-b', 'ben'], ['s-c', 'cat']),
      {
        mapping: {
          users: {
            ann: { email: 'a@example.org', username: 'alpha' },
            ben: { email: 'b@example.org' },
            cat: { drop: true },
          },
        },
      },
    );
    expect(p.users.map((u) => [u.legacy, u.username, u.email])).toEqual([
      ['ann', 'alpha', 'a@example.org'],
      ['ben', 'ben', 'b@example.org'],
    ]);
    expect(rules(p)).toContain('cat:user.dropped-by-mapping');
  });

  describe('memberships', () => {
    const base = [user('ann', 'a@example.org', { providers: ['BioNet', 'Gone'] })];
    it('is approved for the user list and requested for a pending request, approved ones first', () => {
      const p = plan(
        [...base, user('ben', 'b@example.org')],
        subjects(['s-a', 'ann'], ['s-b', 'ben']),
        { requests: [{ id: 'x', mail: 'b@example.org', username: 'ben', provider: 'BioNet' }] },
      );
      expect(p.memberships.map((m) => [m.legacy, m.provider, m.state])).toEqual([
        ['ann @ BioNet', 'BioNet', 'approved'],
        ['ben @ BioNet', 'BioNet', 'requested'],
      ]);
      expect(rules(p)).toEqual(['ann @ Gone:membership.provider-not-migrated']);
    });
    it('drops the memberships of a user who is not migrated, and a request that repeats an approval', () => {
      const p = plan(
        [
          user('ann', 'a@example.org', { providers: ['BioNet'] }),
          user('lost', 'l@example.org', { providers: ['BioNet'] }),
        ],
        subjects(['s-a', 'ann']),
        { requests: [{ id: 'x', mail: 'a@example.org', username: 'ann', provider: 'BioNet' }] },
      );
      expect(p.memberships.map((m) => m.legacy)).toEqual(['ann @ BioNet']);
      expect(rules(p)).toContain('lost @ BioNet:membership.user-not-migrated');
    });
    it(`keeps at most ${MAX_PENDING} pending requests for one user and reports the rest`, () => {
      const requests = Array.from({ length: 12 }, (_, n) => ({
        id: String(n),
        mail: 'a@example.org',
        username: 'ann',
        provider: `P${String(n).padStart(2, '0')}`,
      }));
      const p = transformPeople(
        { users: [user('ann', 'a@example.org')], membershipRequests: requests, providers: [] },
        subjects(['s-a', 'ann']),
        emptyMapping(),
        'ls-login',
        {
          providers: requests.map((r) => ({
            kind: 'provider' as const,
            legacy: r.provider,
            abbreviation: r.provider,
            name: r.provider,
          })),
        },
      );
      expect(p.memberships).toHaveLength(MAX_PENDING);
      expect(p.findings.filter((f) => f.rule === 'membership.too-many-pending')).toHaveLength(2);
    });
  });
});
