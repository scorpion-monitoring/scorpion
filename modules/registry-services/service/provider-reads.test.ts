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

describe('listForPickerAsSystem', () => {
  it('lists the services of the providers the user is an approved member of, and none for any other kind of person', async () => {
    const { services, people, pool, other, svc } = await world(h);
    const elsewhere = await makeService(pool, { provider: other.id });
    const ids = async (userId: string) =>
      (await services.listForPickerAsSystem({ memberOf: userId, limit: 50 })).map((row) => row.id);
    expect(await ids(people.member.userId)).toContain(svc.id);
    expect(await ids(people.member.userId)).not.toContain(elsewhere.id);
    expect(await ids(people.manager.userId)).toContain(svc.id);
    expect(await ids(people.managerElsewhere.userId)).toContain(elsewhere.id);
    expect(await ids(people.managerElsewhere.userId)).not.toContain(svc.id);
    for (const who of ['requested', 'rejected', 'left', 'plain'] as const)
      expect(await ids(people[who].userId), who).toEqual([]);
    expect(await ids('not-a-uuid')).toEqual([]);
  });

  it('is not given by a consortium, only by the provider', async () => {
    const { services, actor, consortium, svc, join } = await world(h);
    const net = await actor('user');
    await join(net, consortium.id, 'approved');
    expect(await services.listForPickerAsSystem({ memberOf: net.userId, limit: 50 })).toEqual([]);
    expect(svc.id).toBeTruthy();
  });

  it('without memberOf lists every service; q matches name or abbreviation without case and takes % and _ literally; the order is name, then id, and limit caps it', async () => {
    const { services, pool, provider } = await world(h);
    const a = await makeService(pool, {
      provider: provider.id,
      name: 'Zeta 100% picker',
      slug: 'zeta-picker',
    });
    const b = await makeService(pool, {
      provider: provider.id,
      name: 'alpha picker',
      slug: 'alpha-picker',
    });
    const hits = await services.listForPickerAsSystem({ q: 'PICKER', limit: 50 });
    expect(hits.map((row) => row.id)).toEqual([b.id, a.id]);
    expect(hits[0]).toEqual({ id: b.id, slug: 'alpha-picker', name: 'alpha picker' });
    expect(
      (await services.listForPickerAsSystem({ q: '100%', limit: 50 })).map((r) => r.id),
    ).toEqual([a.id]);
    expect(await services.listForPickerAsSystem({ q: '%', limit: 50 })).toHaveLength(1);
    expect(await services.listForPickerAsSystem({ q: 'picker', limit: 1 })).toHaveLength(1);
  });
});
