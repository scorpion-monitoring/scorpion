// Load for users, roles and memberships, through the public services of core.identity, core.authz and
// registry.organisations. A user is found by the address (the natural key), created active with no way to sign in and an
// open claim (ADR-0053: the owner's first sign-in at the provider, with that verified address and the legacy username, adds
// the identity) and given the role `user` in one transaction; an address that another account holds is reported, a
// username someone else holds gets a suffix. A membership
// is requested **as the user** and decided **as the migration account** (the state machine lets `request` be made by the
// person only, and nobody decides their own); a legacy pending request stays a request. An existing row is never reopened:
// one that was rejected or ended after the first run stays so, and is reported.
//
// Mail: the membership service queues its mails and inbox items as for any request (a request mails the managers and the
// administrators, a decision mails the user). The tool starts no worker, so they stay queued until the instance's worker runs;
// the runbook says to keep the mail transport at `none` until the announcement.
import type { UserActor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { IdentityService } from '@scorpion/core-identity/public';
import type { OrganisationsPublic } from '@scorpion/registry-organisations/public';
import { attemptWith, type Outcome, type RecordResult } from './load.ts';
import type { MembershipOp, PeoplePlan, UserOp } from './people-transform.ts';
import { uniqueUsername } from './rules.ts';
import { actorOf } from './target.ts';
import type { Finding } from './transform.ts';

type Tx = Parameters<AuthzService['assignRoleAsSystem']>[0];

export interface PeoplePorts {
  identity: Pick<IdentityService, 'users'>;
  authz: Pick<AuthzService, 'assignRoleAsSystem'>;
  organisations: Pick<
    OrganisationsPublic,
    'findByAbbreviationAsSystem' | 'request' | 'decide' | 'listOwn'
  >;
  db: { tx<T>(work: (tx: Tx) => Promise<T>): Promise<T> };
}

export interface PeopleLoad {
  results: RecordResult[];
  findings: Finding[];
  /** The id of each migrated user, by legacy username, and what became of the record. */
  users: Map<string, { id: string | undefined; username: string; outcome: Outcome }>;
  /** The migrated accounts by the state of their claim (ADR-0053); a dry run counts the ones it would create as open. */
  claims: { open: number; claimed: number; expired: number };
}

const quote = (value: string) => JSON.stringify(value);
const PAGE = 100;

/**
 * Whether the account that holds a user's address is the one this migration created for them: it holds the claim the user
 * would get, or, once claimed (the claim is gone), it has the username the migration gave it.
 */
export function isMigratedAccount(
  found: { username: string },
  claim: { provider: string; username: string } | undefined,
  op: Pick<UserOp, 'provider' | 'claimUsername' | 'username'>,
): boolean {
  return claim
    ? claim.provider === op.provider && claim.username === op.claimUsername.toLowerCase()
    : found.username === op.username;
}

export async function loadUsers(
  plan: Pick<PeoplePlan, 'users'>,
  ports: PeoplePorts,
  options: {
    dryRun: boolean;
    now: Date;
    /** When an account created by this run can no longer be claimed (now plus the mapping's `claimDays`). */
    claimUntil: Date;
  },
): Promise<PeopleLoad> {
  const results: RecordResult[] = [];
  const findings: Finding[] = [];
  const attempt = attemptWith(results, findings);
  const users: PeopleLoad['users'] = new Map();
  const { dryRun } = options;
  const taken = new Set<string>();
  const claims = { open: 0, claimed: 0, expired: 0 };

  const assignRole = (userId: string, role: string) =>
    ports.db.tx((tx) => ports.authz.assignRoleAsSystem(tx, { userId, roleKey: role }));

  for (const op of plan.users) {
    const refuse = (rule: string, detail: string) => {
      findings.push({ kind: 'user', legacy: op.legacy, rule, effect: 'dropped', detail });
      results.push({ kind: 'user', legacy: op.legacy, target: op.username, outcome: 'dropped' });
      users.set(op.legacy, { id: undefined, username: op.username, outcome: 'dropped' });
    };
    // The natural key is the address.
    const existing = await ports.identity.users.findByEmail(op.email);
    if (existing) {
      const claim = await ports.identity.users.claimOfAsSystem(existing.id);
      if (!isMigratedAccount(existing, claim, op)) {
        refuse('user.email-taken', 'another account of the target already has this address');
        continue;
      }
      if (!claim) claims.claimed += 1;
      else if (claim.expiresAt.getTime() <= options.now.getTime()) claims.expired += 1;
      else claims.open += 1;
      let changed = false;
      if (!dryRun) {
        const done = await attempt('user', op.legacy, existing.username, async () =>
          assignRole(existing.id, op.role),
        );
        if (!done.ok) {
          users.set(op.legacy, {
            id: existing.id,
            username: existing.username,
            outcome: 'dropped',
          });
          continue;
        }
        changed = done.value;
      }
      users.set(op.legacy, {
        id: existing.id,
        username: existing.username,
        outcome: changed ? 'changed' : 'kept',
      });
      results.push({
        kind: 'user',
        legacy: op.legacy,
        target: existing.username,
        outcome: changed ? 'changed' : 'kept',
        ...(changed ? { fields: ['role'] } : {}),
      });
      continue;
    }
    // A username someone else holds (an account of the target with another address) gets a suffix.
    let username = op.username;
    for (let tries = 0; tries < 100; tries += 1) {
      if (taken.has(username) || (await ports.identity.users.findByUsername(username))) {
        taken.add(username);
        username = uniqueUsername(username, taken);
      } else break;
    }
    if (username !== op.username) {
      findings.push({
        kind: 'user',
        legacy: op.legacy,
        rule: 'user.username-taken',
        effect: 'adjusted',
        detail: `${quote(op.username)} is taken in the target → ${quote(username)}`,
      });
    }
    taken.add(username);
    if (dryRun) {
      claims.open += 1;
      users.set(op.legacy, { id: undefined, username, outcome: 'created' });
      results.push({ kind: 'user', legacy: op.legacy, target: username, outcome: 'created' });
      continue;
    }
    const created = await attempt('user', op.legacy, username, () =>
      ports.db.tx(async (tx) => {
        const created = await ports.identity.users.createClaimableAsSystem({
          username,
          email: op.email,
          claim: {
            provider: op.provider,
            username: op.claimUsername,
            expiresAt: options.claimUntil,
          },
        });
        await ports.authz.assignRoleAsSystem(tx, { userId: created.id, roleKey: op.role });
        return created;
      }),
    );
    if (!created.ok) {
      users.set(op.legacy, { id: undefined, username: op.username, outcome: 'dropped' });
      continue;
    }
    claims.open += 1;
    users.set(op.legacy, { id: created.value.id, username, outcome: 'created' });
    results.push({ kind: 'user', legacy: op.legacy, target: username, outcome: 'created' });
  }
  return { results, findings, users, claims };
}

export async function loadMemberships(
  plan: Pick<PeoplePlan, 'memberships'>,
  ports: Pick<PeoplePorts, 'organisations' | 'identity'>,
  options: {
    dryRun: boolean;
    /** The migration account (undefined in a dry run before it exists). */
    actor: UserActor | undefined;
    users: ReadonlyMap<string, { id: string | undefined; username: string; outcome: Outcome }>;
    /** The abbreviations of providers the registry stage refused. */
    refusedProviders: ReadonlySet<string>;
  },
): Promise<{ results: RecordResult[]; findings: Finding[] }> {
  const results: RecordResult[] = [];
  const findings: Finding[] = [];
  const attempt = attemptWith(results, findings);
  const { dryRun, actor } = options;
  const own = new Map<string, Map<string, { id: string; state: string }>>();

  async function rowsOf(userId: string, username: string) {
    const cached = own.get(userId);
    if (cached) return cached;
    const rows = new Map<string, { id: string; state: string }>();
    const user = actorOf({ id: userId, username });
    for (let page = 0; ; page += 1) {
      const got = await ports.organisations.listOwn(user, { page, pageSize: PAGE });
      for (const row of got.items) rows.set(row.organisation.id, { id: row.id, state: row.state });
      if (got.items.length === 0 || (page + 1) * PAGE >= got.total) break;
    }
    own.set(userId, rows);
    return rows;
  }

  const drop = (op: MembershipOp, rule: string, detail: string) => {
    findings.push({ kind: 'membership', legacy: op.legacy, rule, effect: 'dropped', detail });
    results.push({
      kind: 'membership',
      legacy: op.legacy,
      target: op.provider,
      outcome: 'dropped',
    });
  };
  const done = (op: MembershipOp, outcome: Outcome, fields?: string[]) =>
    results.push({
      kind: 'membership',
      legacy: op.legacy,
      target: op.provider,
      outcome,
      ...(fields ? { fields } : {}),
    });

  for (const op of plan.memberships) {
    const user = options.users.get(op.user);
    if (!user || user.outcome === 'dropped') {
      drop(op, 'membership.user-refused', `the user ${quote(op.user)} was refused by the services`);
      continue;
    }
    const org = await ports.organisations.findByAbbreviationAsSystem('provider', op.provider);
    if (!org && (!dryRun || options.refusedProviders.has(op.provider))) {
      drop(
        op,
        'membership.provider-refused',
        `the provider ${quote(op.provider)} was refused by the services`,
      );
      continue;
    }
    const existing =
      user.id && org ? (await rowsOf(user.id, user.username)).get(org.id) : undefined;
    if (existing) {
      if (existing.state === 'requested' && op.state === 'approved') {
        const ok = await attempt('membership', op.legacy, op.provider, async () => {
          if (!dryRun) await ports.organisations.decide(actor!, existing.id, 'approved');
        });
        if (ok.ok) done(op, 'changed', ['state']);
        continue;
      }
      if (existing.state !== 'requested' && existing.state !== 'approved') {
        findings.push({
          kind: 'membership',
          legacy: op.legacy,
          rule: 'membership.exists-other-state',
          effect: 'adjusted',
          detail: `the membership is ${quote(existing.state)} in the target; left as it is`,
        });
      }
      done(op, 'kept');
      continue;
    }
    if (dryRun) {
      done(op, 'created');
      continue;
    }
    const written = await attempt('membership', op.legacy, op.provider, async () => {
      const { membership } = await ports.organisations.request(
        actorOf({ id: user.id!, username: user.username }),
        org!.id,
      );
      if (op.state === 'approved')
        await ports.organisations.decide(actor!, membership.id, 'approved');
    });
    if (written.ok) done(op, 'created');
  }
  return { results, findings };
}

export type { UserOp };
