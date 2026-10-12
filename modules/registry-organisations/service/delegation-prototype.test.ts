// Prototype of M6 sprint 3 (plan §0 item 8, §7 item 1), written before the state machine and before
// ADR-0034. Question: can a resource policy of `core.authz` carry delegation, with a per-permission
// answer, without a change in a scoped path? A fixture policy plays `organisation.member` over a
// resource type of its own (`proto-org`): an approved member may view, only a manager may decide or
// manage roles. It runs through the real authoriser over real Postgres, with an approval resource, a
// session and a token. The answer is recorded in ADR-0034; the real policy and its matrix are in
// `policy.test.ts`.
import { Forbidden, Unauthorized, type Actor, type UserActor } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { useOrganisations, type FixtureModule } from '../test/harness.ts';

const h = useOrganisations();

const VIEW = 'fixture.proto.membership.view';
const DECIDE = 'fixture.proto.membership.decide';
const ROLES = 'fixture.proto.membership.manage-roles';
const READ = 'fixture.proto.thing.read';

type Role = 'member' | 'manager';
/** What the fixture policy knows: organisation id, user id, approved role. */
const memberships: { organisationId: string; userId: string; role: Role }[] = [];

/** `organisation.member` in miniature: the answer depends on the permission asked. */
const policy = {
  resourceType: 'proto-org',
  allows: ({
    actor,
    permission,
    resource,
  }: {
    actor: UserActor;
    permission: string;
    resource: { id?: string };
  }) => {
    const row = memberships.find(
      (m) => m.organisationId === resource.id && m.userId === actor.userId,
    );
    if (!row) return false;
    if (permission === VIEW) return true; // any approved member
    return row.role === 'manager'; // decide, manage-roles
  },
};

const fixture: FixtureModule = {
  manifest: {
    id: 'fixture.proto',
    version: '0.1.0',
    permissions: {
      [READ]: { description: 'The plain permission every signed-in person holds.' },
      [VIEW]: { description: 'View members of one organisation.', scope: 'proto-org' },
      [DECIDE]: { description: 'Decide a request of one organisation.', scope: 'proto-org' },
      [ROLES]: { description: 'Change a role in one organisation.', scope: 'proto-org' },
    },
    contributes: { 'authz.resourcePolicy': [policy] },
  },
  packageJson: {
    name: '@scorpion/fixture-proto',
    version: '0.0.0',
    dependencies: { '@scorpion/core-authz': 'workspace:*' },
  },
};

async function setup() {
  memberships.length = 0;
  const s = await h.start({ extra: [fixture] });
  const org = '018f3b7e-0000-7000-8000-0000000000a1';
  const other = '018f3b7e-0000-7000-8000-0000000000b2';
  const admin = await s.actor('admin');
  const manager = await s.actor('user');
  const member = await s.actor('user');
  const outsider = await s.actor('user');
  memberships.push(
    { organisationId: org, userId: manager.userId, role: 'manager' },
    { organisationId: org, userId: member.userId, role: 'member' },
  );
  const resource = (id = org) => ({ type: 'proto-org', id });
  return { ...s, org, other, admin, manager, member, outsider, resource };
}

const token = (actor: UserActor, scopes: string[]): UserActor => ({
  ...actor,
  via: 'token',
  scopes,
});

describe('a resource policy with a per-permission answer carries delegation (prototype)', () => {
  it('answers per permission: a member views, only a manager decides and changes roles, an outsider nothing', async () => {
    const { authz, manager, member, outsider, resource } = await setup();
    const can = (actor: Actor, permission: string, id?: string) =>
      authz.can(actor, permission, resource(id));
    expect(await can(member, VIEW)).toBe(true);
    expect(await can(member, DECIDE)).toBe(false);
    expect(await can(member, ROLES)).toBe(false);
    expect(await can(manager, VIEW)).toBe(true);
    expect(await can(manager, DECIDE)).toBe(true);
    expect(await can(manager, ROLES)).toBe(true);
    for (const permission of [VIEW, DECIDE, ROLES]) {
      expect(await can(outsider, permission), permission).toBe(false);
    }
  });

  it('grants nothing on another organisation, and nothing without a resource', async () => {
    const { authz, manager, other, resource } = await setup();
    expect(await authz.can(manager, DECIDE, resource(other))).toBe(false);
    expect(await authz.can(manager, DECIDE)).toBe(false);
    await expect(authz.require(manager, DECIDE)).rejects.toBeInstanceOf(Forbidden);
  });

  it('lets Admin through globally, and the approval rule stops Admin and a manager on their own request', async () => {
    const { authz, admin, manager, member, org } = await setup();
    const decide = (requestedBy: string) => ({
      type: 'proto-org',
      id: org,
      approval: true,
      requestedBy,
    });
    // Admin holds it globally, with or without a membership.
    await expect(authz.require(admin, DECIDE, decide(member.userId))).resolves.toBeUndefined();
    // Somebody else's request: the manager passes through the policy.
    await expect(authz.require(manager, DECIDE, decide(member.userId))).resolves.toBeUndefined();
    // Their own: denied before roles and policies, whoever they are.
    await expect(authz.require(admin, DECIDE, decide(admin.userId))).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(authz.require(manager, DECIDE, decide(manager.userId))).rejects.toBeInstanceOf(
      Forbidden,
    );
    // Not a decision: an ordinary check, the own id means nothing.
    await expect(
      authz.require(manager, DECIDE, { type: 'proto-org', id: org, requestedBy: manager.userId }),
    ).resolves.toBeUndefined();
  });

  it('limits a token to its scopes before the policy is asked (scope ∩ owner), and a token cannot widen its owner', async () => {
    const { authz, manager, member, outsider, resource } = await setup();
    // The owner is a manager: only the scope the token names passes.
    expect(await authz.can(token(manager, [VIEW]), VIEW, resource())).toBe(true);
    expect(await authz.can(token(manager, [VIEW]), DECIDE, resource())).toBe(false);
    expect(await authz.can(token(manager, [DECIDE]), DECIDE, resource())).toBe(true);
    // A scope the owner does not hold through the policy grants nothing.
    expect(await authz.can(token(member, [DECIDE, ROLES]), DECIDE, resource())).toBe(false);
    expect(await authz.can(token(outsider, [VIEW, DECIDE, ROLES]), VIEW, resource())).toBe(false);
    // A session has no scope limit.
    expect(await authz.can(manager, DECIDE, resource())).toBe(true);
  });

  it('reads the membership on every call: a demotion takes effect on the next call', async () => {
    const { authz, manager, resource } = await setup();
    expect(await authz.can(manager, DECIDE, resource())).toBe(true);
    memberships.find((m) => m.userId === manager.userId)!.role = 'member';
    expect(await authz.can(manager, DECIDE, resource())).toBe(false);
    memberships.length = 0;
    expect(await authz.can(manager, VIEW, resource())).toBe(false);
  });

  it('answers 401 for an anonymous caller and 403 for a user who holds nothing', async () => {
    const { authz, outsider, resource } = await setup();
    await expect(authz.require({ kind: 'anonymous' }, VIEW, resource())).rejects.toBeInstanceOf(
      Unauthorized,
    );
    await expect(authz.require(outsider, VIEW, resource())).rejects.toBeInstanceOf(Forbidden);
  });
});
