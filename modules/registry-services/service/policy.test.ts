// The policy service.member through the real authoriser of core.authz over real Postgres: the answer for every
// kind of reader and every scoped permission (plan §6), the token gate, "read at every call" and the
// separation between services. The prototype that decided the shape is access-prototype.test.ts.
import { Forbidden, Unauthorized, type Actor, type UserActor } from '@scorpion/contracts';
import { makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useServices } from '../test/harness.ts';
import { anonymous, world } from '../test/world.ts';
import {
  PERMISSION_EDIT,
  PERMISSION_EDIT_IDENTITY,
  PERMISSION_READ_CONTACT,
} from './permissions.ts';

const h = useServices();

const ALL = [PERMISSION_EDIT, PERMISSION_EDIT_IDENTITY, PERMISSION_READ_CONTACT] as const;
const only = (...granted: (typeof ALL)[number][]) =>
  Object.fromEntries(ALL.map((permission) => [permission, granted.includes(permission)]));
const none = only();

async function setup() {
  const w = await world(h);
  const answers = async (actor: Actor, id = w.svc.id) =>
    Object.fromEntries(
      await Promise.all(
        ALL.map(async (permission) => [
          permission,
          await w.authz.can(actor, permission, w.resource(id)),
        ]),
      ),
    ) as Record<(typeof ALL)[number], boolean>;
  return { ...w, answers };
}

describe('the policy service.member: who holds which scoped permission on one service', () => {
  it('gives an approved manager of the provider all three [ASVS-8.2.2]', async () => {
    const { answers, people } = await setup();
    expect(await answers(people.manager)).toEqual(only(...ALL));
  });

  it('gives an approved member edit and the contact point, and not the identity [ASVS-8.2.2]', async () => {
    const { answers, people } = await setup();
    expect(await answers(people.member)).toEqual(only(PERMISSION_EDIT, PERMISSION_READ_CONTACT));
  });

  it.each(['requested', 'rejected', 'left'] as const)('gives a %s row nothing', async (state) => {
    const { answers, people } = await setup();
    expect(await answers(people[state])).toEqual(none);
  });

  it('gives nothing to a person with no row, a Reviewer, or a manager of another organisation', async () => {
    const { answers, people } = await setup();
    expect(await answers(people.plain)).toEqual(none);
    expect(await answers(people.reviewer)).toEqual(none);
    expect(await answers(people.managerElsewhere)).toEqual(none);
  });

  it('holds for Admin globally, on any service, with or without a membership', async () => {
    const { answers, people, pool, other } = await setup();
    const elsewhere = await makeService(pool, { provider: other.id });
    expect(await answers(people.admin)).toEqual(only(...ALL));
    expect(await answers(people.admin, elsewhere.id)).toEqual(only(...ALL));
  });

  it('answers per service: the manager of one provider holds nothing on a service of another [ASVS-8.2.2]', async () => {
    const { answers, people, pool, other } = await setup();
    const elsewhere = await makeService(pool, { provider: other.id });
    expect(await answers(people.managerElsewhere, elsewhere.id)).toEqual(only(...ALL));
    expect(await answers(people.manager, elsewhere.id)).toEqual(none);
    expect(await answers(people.member, elsewhere.id)).toEqual(none);
  });

  it('is not given by a consortium: only the provider counts', async () => {
    const { answers, actor, consortium, svc, join } = await setup();
    const net = await actor('user');
    await join(net, consortium.id, 'approved', 'manager');
    expect(await answers(net, svc.id)).toEqual(none);
  });

  it('answers 401 for an anonymous caller and 403 for a person with no right, and false from can', async () => {
    const { authz, people, resource } = await setup();
    for (const permission of ALL) {
      expect(await authz.can(anonymous, permission, resource()), permission).toBe(false);
      await expect(authz.require(anonymous, permission, resource())).rejects.toBeInstanceOf(
        Unauthorized,
      );
      await expect(authz.require(people.plain, permission, resource())).rejects.toBeInstanceOf(
        Forbidden,
      );
    }
  });

  it('grants nothing without a resource, for a bad id and for an unknown service', async () => {
    const { authz, people, resource } = await setup();
    for (const permission of ALL) {
      expect(await authz.can(people.manager, permission), permission).toBe(false);
      expect(await authz.can(people.manager, permission, { type: 'service' }), permission).toBe(
        false,
      );
      expect(await authz.can(people.manager, permission, resource('not-a-uuid')), permission).toBe(
        false,
      );
      expect(
        await authz.can(
          people.manager,
          permission,
          resource('018f3b7e-0000-7000-8000-000000000000'),
        ),
        permission,
      ).toBe(false);
    }
  });

  it('limits a token to the scopes it names, and a token cannot widen its owner [ASVS-8.2.1]', async () => {
    const { authz, people, resource } = await setup();
    const token = (actor: UserActor, scopes: string[]): UserActor => ({
      ...actor,
      via: 'token',
      scopes,
    });
    // The owner is a manager: only the scope the token names passes.
    expect(
      await authz.can(token(people.manager, [PERMISSION_EDIT]), PERMISSION_EDIT, resource()),
    ).toBe(true);
    expect(
      await authz.can(
        token(people.manager, [PERMISSION_EDIT]),
        PERMISSION_EDIT_IDENTITY,
        resource(),
      ),
    ).toBe(false);
    expect(await authz.can(token(people.manager, []), PERMISSION_EDIT, resource())).toBe(false);
    // The owner is a member, an Admin's token without the scope, a plain User naming every scope: nothing.
    expect(
      await authz.can(token(people.member, [...ALL]), PERMISSION_EDIT_IDENTITY, resource()),
    ).toBe(false);
    expect(
      await authz.can(token(people.admin, [PERMISSION_EDIT]), PERMISSION_EDIT_IDENTITY, resource()),
    ).toBe(false);
    expect(await authz.can(token(people.plain, [...ALL]), PERMISSION_EDIT, resource())).toBe(false);
  });

  it('reads the membership at every call: a demotion, a removal and a move take effect on the next call [ASVS-8.2.1]', async () => {
    const { authz, pool, people, resource, provider, other, svc } = await setup();
    expect(await authz.can(people.manager, PERMISSION_EDIT_IDENTITY, resource())).toBe(true);
    await pool.query(
      "update org_membership set role = 'member' where organisation_id = $1 and user_id = $2",
      [provider.id, people.manager.userId],
    );
    expect(await authz.can(people.manager, PERMISSION_EDIT_IDENTITY, resource())).toBe(false);
    expect(await authz.can(people.manager, PERMISSION_EDIT, resource())).toBe(true);
    await pool.query(
      "update org_membership set state = 'left' where organisation_id = $1 and user_id = $2",
      [provider.id, people.manager.userId],
    );
    expect(await authz.can(people.manager, PERMISSION_EDIT, resource())).toBe(false);
    // The service moves to another provider: the old provider's member loses it, the new one's gains it.
    expect(await authz.can(people.member, PERMISSION_EDIT, resource())).toBe(true);
    await pool.query(
      "update svc_service_organisation set organisation_id = $1 where service_id = $2 and role = 'provider'",
      [other.id, svc.id],
    );
    expect(await authz.can(people.member, PERMISSION_EDIT, resource())).toBe(false);
    expect(await authz.can(people.managerElsewhere, PERMISSION_EDIT_IDENTITY, resource())).toBe(
      true,
    );
  });
});
