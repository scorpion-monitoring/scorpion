// The policy `organisation.member` through the real authoriser of core.authz over real Postgres: the
// answer for every kind of reader and every scoped permission (plan §7 item 6), the token gate, the
// approval rule that the policy cannot undo, and "read at every call". The prototype that decided the
// shape is delegation-prototype.test.ts.
import { Forbidden, Unauthorized, type Actor, type UserActor } from '@scorpion/contracts';
import { makeMembership, makeOrganisation } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useOrganisations } from '../test/harness.ts';
import {
  PERMISSION_DECIDE,
  PERMISSION_EDIT,
  PERMISSION_MANAGE_ROLES,
  PERMISSION_READ_CONTACT,
  PERMISSION_REMOVE,
  PERMISSION_VIEW_MEMBERS,
} from './permissions.ts';

const h = useOrganisations();

const ALL = [
  PERMISSION_VIEW_MEMBERS,
  PERMISSION_DECIDE,
  PERMISSION_MANAGE_ROLES,
  PERMISSION_REMOVE,
  PERMISSION_READ_CONTACT,
  PERMISSION_EDIT,
] as const;

async function setup() {
  const s = await h.start();
  const org = await makeOrganisation(s.pool);
  const other = await makeOrganisation(s.pool);
  const admin = await s.actor('admin');
  const people = {
    manager: await s.actor('user'),
    member: await s.actor('user'),
    requested: await s.actor('user'),
    rejected: await s.actor('user'),
    left: await s.actor('user'),
    managerElsewhere: await s.actor('user'),
    nobody: await s.actor('user'),
  };
  const row = (who: UserActor, organisationId: string, state: string, role = 'member') =>
    makeMembership(s.pool, {
      organisationId,
      userId: who.userId,
      state: state as 'approved',
      role: role as 'member',
    });
  await row(people.manager, org.id, 'approved', 'manager');
  await row(people.member, org.id, 'approved');
  await row(people.requested, org.id, 'requested');
  await row(people.rejected, org.id, 'rejected');
  await row(people.left, org.id, 'left');
  await row(people.managerElsewhere, other.id, 'approved', 'manager');
  const resource = (id = org.id) => ({ type: 'organisation', id });
  const answers = async (actor: Actor, id = org.id) =>
    Object.fromEntries(
      await Promise.all(
        ALL.map(async (permission) => [
          permission,
          await s.authz.can(actor, permission, resource(id)),
        ]),
      ),
    ) as Record<(typeof ALL)[number], boolean>;
  return { ...s, org, other, admin, people, row, resource, answers };
}

const only = (...granted: (typeof ALL)[number][]) =>
  Object.fromEntries(ALL.map((permission) => [permission, granted.includes(permission)]));
const none = only();

describe('the policy organisation.member: who holds which scoped permission on one organisation', () => {
  it('gives an approved manager every one of the six', async () => {
    const { answers, people } = await setup();
    expect(await answers(people.manager)).toEqual(only(...ALL));
  });

  it('gives an approved member the member list and nothing else, while membersVisibleToMembers is on', async () => {
    const { answers, people } = await setup();
    expect(await answers(people.member)).toEqual(only(PERMISSION_VIEW_MEMBERS));
  });

  it('gives an approved member nothing when membersVisibleToMembers is off, and a manager still everything', async () => {
    const { answers, people, configure } = await setup();
    await configure({ membership: { membersVisibleToMembers: false } });
    expect(await answers(people.member)).toEqual(none);
    expect(await answers(people.manager)).toEqual(only(...ALL));
  });

  it.each(['requested', 'rejected', 'left'] as const)('gives a %s row nothing', async (state) => {
    const { answers, people } = await setup();
    expect(await answers(people[state])).toEqual(none);
  });

  it('gives nothing to a person with no row, and nothing on an organisation the manager does not manage', async () => {
    const { answers, people, org, other } = await setup();
    expect(await answers(people.nobody)).toEqual(none);
    expect(await answers(people.managerElsewhere, org.id)).toEqual(none);
    expect(await answers(people.managerElsewhere, other.id)).toEqual(only(...ALL));
    expect(await answers(people.manager, other.id)).toEqual(none);
  });

  it('holds for Admin globally, with or without a membership, on any organisation', async () => {
    const { answers, admin, org, other } = await setup();
    expect(await answers(admin, org.id)).toEqual(only(...ALL));
    expect(await answers(admin, other.id)).toEqual(only(...ALL));
  });

  it('answers 401 for an anonymous caller and 403 for a person with no right, and false from can', async () => {
    const { authz, people, resource } = await setup();
    const anonymous: Actor = { kind: 'anonymous' };
    for (const permission of ALL) {
      expect(await authz.can(anonymous, permission, resource()), permission).toBe(false);
      await expect(authz.require(anonymous, permission, resource())).rejects.toBeInstanceOf(
        Unauthorized,
      );
      await expect(authz.require(people.nobody, permission, resource())).rejects.toBeInstanceOf(
        Forbidden,
      );
    }
  });

  it('grants nothing without a resource, for a resource that is no uuid, and for an unknown organisation', async () => {
    const { authz, people } = await setup();
    for (const permission of ALL) {
      expect(await authz.can(people.manager, permission), permission).toBe(false);
      expect(
        await authz.can(people.manager, permission, { type: 'organisation' }),
        permission,
      ).toBe(false);
      expect(
        await authz.can(people.manager, permission, { type: 'organisation', id: 'not-a-uuid' }),
        permission,
      ).toBe(false);
      expect(
        await authz.can(people.manager, permission, {
          type: 'organisation',
          id: '018f3b7e-0000-7000-8000-000000000000',
        }),
        permission,
      ).toBe(false);
    }
  });
});

describe('the edit row of the policy (Decision 14)', () => {
  it('is held by Admin and by an approved manager of that organisation, and by nobody else [ASVS-8.2.1]', async () => {
    const { authz, people, admin, org, other } = await setup();
    const may = (actor: Actor, id = org.id) =>
      authz.can(actor, PERMISSION_EDIT, { type: 'organisation', id });
    expect(await may(admin)).toBe(true);
    expect(await may(admin, other.id)).toBe(true);
    expect(await may(people.manager)).toBe(true);
    expect(await may(people.manager, other.id)).toBe(false);
    expect(await may(people.managerElsewhere)).toBe(false);
    expect(await may(people.member)).toBe(false);
    for (const state of ['requested', 'rejected', 'left'] as const) {
      expect(await may(people[state]), state).toBe(false);
    }
    expect(await may(people.nobody)).toBe(false);
    expect(await may({ kind: 'anonymous' })).toBe(false);
  });

  it('is limited by token scopes, and never gives a member a manager token’s edit [ASVS-8.2.1]', async () => {
    const { authz, people, admin, org } = await setup();
    const resource = { type: 'organisation', id: org.id };
    const asToken = (actor: UserActor, scopes: string[]): UserActor => ({
      ...actor,
      via: 'token',
      scopes,
    });
    expect(
      await authz.can(
        asToken(people.manager, ['core.identity.me.read']),
        PERMISSION_EDIT,
        resource,
      ),
    ).toBe(false);
    expect(
      await authz.can(asToken(people.manager, [PERMISSION_EDIT]), PERMISSION_EDIT, resource),
    ).toBe(true);
    expect(
      await authz.can(asToken(people.member, [PERMISSION_EDIT]), PERMISSION_EDIT, resource),
    ).toBe(false);
    expect(
      await authz.can(asToken(admin, ['core.identity.me.read']), PERMISSION_EDIT, resource),
    ).toBe(false);
  });

  it('is denied as 401 for an anonymous caller and 403 for a person with no right', async () => {
    const { authz, people, org } = await setup();
    const resource = { type: 'organisation', id: org.id };
    await expect(
      authz.require({ kind: 'anonymous' }, PERMISSION_EDIT, resource),
    ).rejects.toBeInstanceOf(Unauthorized);
    await expect(authz.require(people.member, PERMISSION_EDIT, resource)).rejects.toBeInstanceOf(
      Forbidden,
    );
  });
});

describe('the policy and the rest of core.authz', () => {
  const asToken = (actor: UserActor, scopes: string[]): UserActor => ({
    ...actor,
    via: 'token',
    scopes,
  });

  it('limits a token to the scopes it names, before the policy is asked [ASVS-8.2.1]', async () => {
    const { answers, people, admin } = await setup();
    // A manager's token without the scope grants nothing; with one scope it grants that one.
    expect(await answers(asToken(people.manager, ['core.identity.me.read']))).toEqual(none);
    expect(await answers(asToken(people.manager, [PERMISSION_DECIDE]))).toEqual(
      only(PERMISSION_DECIDE),
    );
    expect(await answers(asToken(people.manager, [...ALL]))).toEqual(only(...ALL));
    // A member's token cannot reach a manager's right by naming its scope.
    expect(await answers(asToken(people.member, [...ALL]))).toEqual(only(PERMISSION_VIEW_MEMBERS));
    // An Admin's token is limited to its scopes too.
    expect(await answers(asToken(admin, [PERMISSION_VIEW_MEMBERS]))).toEqual(
      only(PERMISSION_VIEW_MEMBERS),
    );
  });

  it('cannot undo the approval rule: nobody decides on their own request, a manager and Admin included [ASVS-8.2.1]', async () => {
    const { authz, people, admin, org } = await setup();
    const own = (actor: UserActor) => ({
      type: 'organisation',
      id: org.id,
      approval: true,
      requestedBy: actor.userId,
    });
    await expect(
      authz.require(people.manager, PERMISSION_DECIDE, own(people.manager)),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(authz.require(admin, PERMISSION_DECIDE, own(admin))).rejects.toBeInstanceOf(
      Forbidden,
    );
    // The same manager decides somebody else's request.
    await expect(
      authz.require(people.manager, PERMISSION_DECIDE, {
        type: 'organisation',
        id: org.id,
        approval: true,
        requestedBy: people.requested.userId,
      }),
    ).resolves.toBeUndefined();
  });

  it('reads the membership at every call: a demotion, a removal and a deleted row are seen at once', async () => {
    const { answers, people, pool, org } = await setup();
    expect((await answers(people.manager))[PERMISSION_DECIDE]).toBe(true);
    await pool.query(
      "update org_membership set role = 'member' where organisation_id = $1 and user_id = $2",
      [org.id, people.manager.userId],
    );
    expect(await answers(people.manager)).toEqual(only(PERMISSION_VIEW_MEMBERS));
    await pool.query(
      "update org_membership set state = 'left' where organisation_id = $1 and user_id = $2",
      [org.id, people.manager.userId],
    );
    expect(await answers(people.manager)).toEqual(none);
    await pool.query('delete from org_membership where organisation_id = $1 and user_id = $2', [
      org.id,
      people.member.userId,
    ]);
    expect(await answers(people.member)).toEqual(none);
  });

  it('is not asked for a permission that has no scope, or a resource of another type', async () => {
    const { authz, people, org } = await setup();
    // `organisation.read` is plain: a resource changes nothing for it.
    expect(
      await authz.can(people.nobody, 'registry.organisations.organisation.manage', {
        type: 'organisation',
        id: org.id,
      }),
    ).toBe(false);
    expect(
      await authz.can(people.manager, PERMISSION_DECIDE, { type: 'service', id: org.id }),
    ).toBe(false);
  });
});
