// Transform for users, roles and memberships (M13 plan §3, sprint 2). Pure: what the target already holds is the load
// step's concern (a username taken by someone else gets a suffix there). The rules:
//   - a user is migrated as an account its owner claims at the first sign-in at the provider (decision 3), by the
//     verified address and the legacy username (ADR-0053); no OIDC subject is needed;
//   - the username is made to fit `^[a-z0-9_-]{3,31}$` and a collision between two legacy users gets a suffix (reported);
//   - an address that is not an address, or that two users share, is reported and the user is not migrated;
//   - the role is `user` for everyone: a legacy administrator is reported, and an administrator of the instance grants
//     Admin by hand after the claim (ADR-0053; decision 4 as amended);
//   - an approved legacy membership is a request by the user decided by the migration account; a pending one stays a
//     request; a user has at most 10 pending requests (the rest are reported).
import type { Mapping } from './mapping.ts';
import type { Snapshot } from './snapshot.ts';
import { fitUsername, isEmailAddress, isProviderId, uniqueUsername } from './rules.ts';
import type { Finding, RegistryPlan } from './transform.ts';

/** `MAX_PENDING_PER_USER` of registry.organisations (`membership.maxPendingPerUser`'s default). */
export const MAX_PENDING = 10;

export interface UserOp {
  /** The legacy username (the key of its findings). */
  legacy: string;
  username: string;
  email: string;
  /** The provider id the account is claimed at. */
  provider: string;
  /** The `preferred_username` the provider must send at the claim: the legacy username. */
  claimUsername: string;
  /** Always the default role (ADR-0053). */
  role: 'user';
  /** An administrator in the legacy data: reported, to be granted Admin by hand after the claim. */
  legacyAdmin: boolean;
}

export interface MembershipOp {
  /** `<legacy username> @ <legacy provider>`. */
  legacy: string;
  /** The legacy username. */
  user: string;
  /** The new abbreviation of the provider. */
  provider: string;
  state: 'approved' | 'requested';
}

export interface PeoplePlan {
  read: { user: number; membership: number };
  users: UserOp[];
  memberships: MembershipOp[];
  findings: Finding[];
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const quote = (value: string) => JSON.stringify(value);

export function transformPeople(
  snapshot: Pick<Snapshot, 'users' | 'membershipRequests' | 'providers'>,
  mapping: Mapping,
  /** The provider id: the mapping's, else the only one the target has; `null` is a gap. */
  provider: string | null,
  registry: Pick<RegistryPlan, 'providers'>,
): PeoplePlan {
  const findings: Finding[] = [];
  const providerOf = new Map(registry.providers.map((op) => [op.legacy, op.abbreviation] as const));
  const legacyUsers = [...snapshot.users].sort((a, b) => byCode(a.user_name, b.user_name));

  const providerGap =
    provider === null
      ? 'no OIDC provider: the mapping gives no oidcProvider and the target has not exactly one configured'
      : !isProviderId(provider)
        ? `${quote(provider)} is not a provider id (lower-case letters, digits and "-", not "local")`
        : undefined;

  // Addresses used by more than one user are not migrated (§3).
  const emailOwners = new Map<string, string[]>();
  for (const user of legacyUsers) {
    const decided = mapping.users[user.user_name];
    const email = (decided?.email ?? user.email).trim().toLowerCase();
    emailOwners.set(email, [...(emailOwners.get(email) ?? []), user.user_name]);
  }

  const users: UserOp[] = [];
  const taken = new Set<string>();
  const migrated = new Map<string, UserOp>(); // lower-cased legacy username → op
  for (const user of legacyUsers) {
    const legacy = user.user_name;
    const decided = mapping.users[legacy];
    const at = `users[${quote(legacy)}]`;
    const drop = (rule: string, detail: string, gap?: string) =>
      findings.push({
        kind: 'user',
        legacy,
        rule,
        effect: 'dropped',
        detail,
        ...(gap ? { gap } : {}),
      });
    if (decided?.drop) {
      drop('user.dropped-by-mapping', 'the mapping drops it');
      continue;
    }
    if (providerGap !== undefined || provider === null) {
      drop('user.provider-open', providerGap ?? 'no OIDC provider', 'oidcProvider');
      continue;
    }
    const key = legacy.toLowerCase();
    const email = (decided?.email ?? user.email).trim();
    if (!isEmailAddress(email)) {
      drop(
        'user.email-invalid',
        'the legacy data has no valid address for this user',
        `${at}.email`,
      );
      continue;
    }
    const sharing = emailOwners.get(email.toLowerCase()) ?? [];
    if (sharing.length > 1) {
      drop(
        'user.email-duplicate',
        `the address is also used by ${sharing
          .filter((name) => name !== legacy)
          .map(quote)
          .join(', ')}`,
        `${at}.email`,
      );
      continue;
    }
    const fitted = fitUsername(decided?.username ?? legacy);
    if (decided?.username !== undefined && fitted.value !== decided.username) {
      drop(
        'user.username-invalid',
        `the mapping's username ${quote(decided.username)} breaks the rule`,
        `${at}.username`,
      );
      continue;
    }
    const username = uniqueUsername(fitted.value, taken);
    if (fitted.changed && decided?.username === undefined) {
      findings.push({
        kind: 'user',
        legacy,
        rule: 'user.username-fitted',
        effect: 'adjusted',
        detail: `${quote(legacy)} → ${quote(fitted.value)}`,
      });
    }
    if (username !== fitted.value) {
      findings.push({
        kind: 'user',
        legacy,
        rule: 'user.username-suffixed',
        effect: 'adjusted',
        detail: `${quote(fitted.value)} is taken by another legacy user → ${quote(username)}`,
      });
    }
    taken.add(username);
    const op: UserOp = {
      legacy,
      username,
      email,
      provider,
      claimUsername: legacy,
      role: 'user',
      legacyAdmin: user.is_admin === true,
    };
    if (op.legacyAdmin) {
      findings.push({
        kind: 'user',
        legacy,
        rule: 'user.admin-by-hand',
        effect: 'adjusted',
        detail:
          'an administrator in the legacy data gets the role user; an administrator grants Admin by hand after the account is claimed (ADR-0053)',
      });
    }
    users.push(op);
    migrated.set(key, op);
  }

  // Memberships: the approved ones from the user list, the pending ones from the requests.
  const memberships: MembershipOp[] = [];
  const wanted = new Map<
    string,
    { user: string; legacyProvider: string; state: 'approved' | 'requested' }
  >();
  for (const user of legacyUsers) {
    for (const legacyProvider of user.providers) {
      wanted.set(`${user.user_name.toLowerCase()}\u0000${legacyProvider}`, {
        user: user.user_name,
        legacyProvider,
        state: 'approved',
      });
    }
  }
  for (const request of [...snapshot.membershipRequests].sort((a, b) =>
    byCode(`${a.username}\u0000${a.provider}`, `${b.username}\u0000${b.provider}`),
  )) {
    const k = `${request.username.toLowerCase()}\u0000${request.provider}`;
    if (!wanted.has(k)) {
      wanted.set(k, {
        user: request.username,
        legacyProvider: request.provider,
        state: 'requested',
      });
    }
  }
  const pending = new Map<string, number>();
  for (const [, entry] of [...wanted].sort(([a], [b]) => byCode(a, b))) {
    const legacy = `${entry.user} @ ${entry.legacyProvider}`;
    const drop = (rule: string, detail: string) =>
      findings.push({ kind: 'membership', legacy, rule, effect: 'dropped', detail });
    const op = migrated.get(entry.user.toLowerCase());
    if (op === undefined) {
      drop('membership.user-not-migrated', `the user ${quote(entry.user)} is not migrated`);
      continue;
    }
    const target = providerOf.get(entry.legacyProvider);
    if (target === undefined) {
      drop(
        'membership.provider-not-migrated',
        `the provider ${quote(entry.legacyProvider)} is not migrated as a provider`,
      );
      continue;
    }
    if (entry.state === 'requested') {
      const n = pending.get(op.legacy) ?? 0;
      if (n >= MAX_PENDING) {
        drop('membership.too-many-pending', `a user has at most ${MAX_PENDING} pending requests`);
        continue;
      }
      pending.set(op.legacy, n + 1);
    }
    memberships.push({ legacy, user: op.legacy, provider: target, state: entry.state });
  }
  // Approved ones first: they pass through `requested` one at a time and never pile up.
  memberships.sort((a, b) =>
    a.state === b.state ? byCode(a.legacy, b.legacy) : a.state === 'approved' ? -1 : 1,
  );

  return {
    read: { user: legacyUsers.length, membership: wanted.size },
    users,
    memberships,
    findings,
  };
}
