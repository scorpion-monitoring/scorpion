// The two trusted reads that sit on the policy `service.member` for other modules' scoped permissions:
// `isProviderManagerAsSystem` and its sibling `isProviderMemberAsSystem` (M10 sprint 1, for `kpi.ingestion`).
// Real Postgres, the real policy. Neither read caches: every change below is seen by the next call.
import { makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useServices } from '../test/harness.ts';
import { world } from '../test/world.ts';

const h = useServices();
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';

describe('isProviderMemberAsSystem', () => {
  it('is true for an approved member and for an approved manager, false for every other kind of person', async () => {
    const { services, people, svc } = await world(h);
    const asked = async (userId: string) => services.isProviderMemberAsSystem(userId, svc.id);
    expect(await asked(people.member.userId)).toBe(true);
    expect(await asked(people.manager.userId)).toBe(true);
    for (const who of ['requested', 'rejected', 'left', 'managerElsewhere', 'plain'] as const)
      expect(await asked(people[who].userId), who).toBe(false);
    // The role admin is a role, not a membership: the read answers about the provider only.
    expect(await asked(people.admin.userId)).toBe(false);
  });

  it('is false for an unknown service, a bad id and an unknown user, and never throws', async () => {
    const { services, people } = await world(h);
    expect(await services.isProviderMemberAsSystem(people.member.userId, ABSENT)).toBe(false);
    expect(await services.isProviderMemberAsSystem(people.member.userId, 'not-a-uuid')).toBe(false);
    expect(await services.isProviderMemberAsSystem(ABSENT, ABSENT)).toBe(false);
  });

  it('answers per service: a member of one provider is no member of another provider’s service', async () => {
    const { services, people, pool, other } = await world(h);
    const elsewhere = await makeService(pool, { provider: other.id });
    expect(await services.isProviderMemberAsSystem(people.member.userId, elsewhere.id)).toBe(false);
    expect(
      await services.isProviderMemberAsSystem(people.managerElsewhere.userId, elsewhere.id),
    ).toBe(true);
  });

  it('is not given by a consortium: only the provider counts', async () => {
    const { services, actor, consortium, svc, join } = await world(h);
    const net = await actor('user');
    await join(net, consortium.id, 'approved');
    expect(await services.isProviderMemberAsSystem(net.userId, svc.id)).toBe(false);
  });

  it('reads the membership at every call: a leave, a demotion and a move of the service are seen at once', async () => {
    const { services, pool, people, provider, other, svc } = await world(h);
    const asked = (who: 'member' | 'manager') =>
      services.isProviderMemberAsSystem(people[who].userId, svc.id);
    expect(await asked('member')).toBe(true);
    // A demotion of a manager keeps them a member.
    await pool.query(
      "update org_membership set role = 'member' where organisation_id = $1 and user_id = $2",
      [provider.id, people.manager.userId],
    );
    expect(await asked('manager')).toBe(true);
    await pool.query(
      "update org_membership set state = 'left' where organisation_id = $1 and user_id = $2",
      [provider.id, people.member.userId],
    );
    expect(await asked('member')).toBe(false);
    await pool.query(
      "update svc_service_organisation set organisation_id = $1 where service_id = $2 and role = 'provider'",
      [other.id, svc.id],
    );
    expect(await asked('manager')).toBe(false);
  });
});

describe('isProviderManagerAsSystem (the sibling that exists)', () => {
  it('is true for an approved manager only, and is told apart from the member read', async () => {
    const { services, people, svc } = await world(h);
    expect(await services.isProviderManagerAsSystem(people.manager.userId, svc.id)).toBe(true);
    for (const who of [
      'member',
      'requested',
      'rejected',
      'left',
      'managerElsewhere',
      'plain',
    ] as const)
      expect(await services.isProviderManagerAsSystem(people[who].userId, svc.id), who).toBe(false);
  });
});
