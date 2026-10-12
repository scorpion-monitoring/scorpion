// Prototype of M7 sprint 2 (plan §0 item 4, §6), written before the field rules and ADR-0036. Question: can the
// policy `service.member` carry three groups on one record through the real authoriser, with a session and a
// token, reading the provider's membership at every call, and can a delegated `update` carry only the plain
// `…service.read` and still refuse a caller who may not edit? Answered with no change in a scoped path; the
// record is ADR-0036. The full matrix is `policy.test.ts`; the route is `defect-01.service-routes-prototype`.
import { Forbidden, Unauthorized, type Actor, type UserActor } from '@scorpion/contracts';
import { makeMembership, makeOrganisation, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useServices } from '../test/harness.ts';
import {
  PERMISSION_EDIT,
  PERMISSION_EDIT_IDENTITY,
  PERMISSION_READ_CONTACT,
} from './permissions.ts';

const h = useServices();

async function setup() {
  const s = await h.start();
  const provider = await makeOrganisation(s.pool, { type: 'provider' });
  const svc = await makeService(s.pool, { provider: provider.id });
  const manager = await s.actor('user');
  const member = await s.actor('user');
  const outsider = await s.actor('user');
  const approved = (who: UserActor, role: 'member' | 'manager') =>
    makeMembership(s.pool, {
      organisationId: provider.id,
      userId: who.userId,
      state: 'approved',
      role,
    });
  await approved(manager, 'manager');
  await approved(member, 'member');
  const resource = { type: 'service', id: svc.id };
  return { ...s, provider, svc, manager, member, outsider, resource, approved };
}
const token = (actor: UserActor, scopes: string[]): UserActor => ({
  ...actor,
  via: 'token',
  scopes,
});

describe('the policy service.member through the real authoriser (prototype)', () => {
  it('answers per permission: a member edits, only a manager changes the identity, an outsider nothing', async () => {
    const { authz, manager, member, outsider, resource } = await setup();
    const can = (actor: Actor, permission: string) => authz.can(actor, permission, resource);
    expect(await can(member, PERMISSION_EDIT)).toBe(true);
    expect(await can(member, PERMISSION_READ_CONTACT)).toBe(true);
    expect(await can(member, PERMISSION_EDIT_IDENTITY)).toBe(false);
    expect(await can(manager, PERMISSION_EDIT_IDENTITY)).toBe(true);
    expect(await can(manager, PERMISSION_EDIT)).toBe(true);
    for (const permission of [PERMISSION_EDIT, PERMISSION_EDIT_IDENTITY, PERMISSION_READ_CONTACT]) {
      expect(await can(outsider, permission), permission).toBe(false);
    }
  });

  it('limits a token to its scopes before the policy is asked, and a token cannot widen its owner', async () => {
    const { authz, manager, member, resource } = await setup();
    expect(await authz.can(token(manager, [PERMISSION_EDIT]), PERMISSION_EDIT, resource)).toBe(
      true,
    );
    expect(
      await authz.can(token(manager, [PERMISSION_EDIT]), PERMISSION_EDIT_IDENTITY, resource),
    ).toBe(false);
    expect(
      await authz.can(
        token(member, [PERMISSION_EDIT, PERMISSION_EDIT_IDENTITY]),
        PERMISSION_EDIT_IDENTITY,
        resource,
      ),
    ).toBe(false);
  });

  it('reads the membership at every call: a demotion and a removal take effect on the next call', async () => {
    const { authz, pool, manager, resource, provider } = await setup();
    expect(await authz.can(manager, PERMISSION_EDIT_IDENTITY, resource)).toBe(true);
    await pool.query(
      "update org_membership set role = 'member' where organisation_id = $1 and user_id = $2",
      [provider.id, manager.userId],
    );
    expect(await authz.can(manager, PERMISSION_EDIT_IDENTITY, resource)).toBe(false);
    expect(await authz.can(manager, PERMISSION_EDIT, resource)).toBe(true);
    await pool.query(
      "update org_membership set state = 'left' where organisation_id = $1 and user_id = $2",
      [provider.id, manager.userId],
    );
    expect(await authz.can(manager, PERMISSION_EDIT, resource)).toBe(false);
  });

  it('answers 401 for an anonymous caller and 403 for a person who holds nothing', async () => {
    const { authz, outsider, resource } = await setup();
    await expect(
      authz.require({ kind: 'anonymous' }, PERMISSION_EDIT, resource),
    ).rejects.toBeInstanceOf(Unauthorized);
    await expect(authz.require(outsider, PERMISSION_EDIT, resource)).rejects.toBeInstanceOf(
      Forbidden,
    );
  });

  it('lets a delegated update through the plain read and refuses a plain User from the SERVICE', async () => {
    const { services, svc, manager, outsider } = await setup();
    // The plain User holds `…service.read` (the route would let them through) and is refused by the service.
    await expect(services.update(outsider, svc.id, { description: 'x' })).rejects.toBeInstanceOf(
      Forbidden,
    );
    // The manager passes the same entry point, with the scoped permissions from the policy.
    await expect(services.update(manager, svc.id, { description: 'x' })).resolves.toMatchObject({
      description: 'x',
    });
  });
});
