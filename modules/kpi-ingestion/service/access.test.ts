// Who may submit measurements for a service (ADR-0041 Decision 4): Admin, and the approved members of the service's provider
// through the policy of this module, read from the database at every call. The route of sprint 2 will name a plain
// permission, so this method is the authorization: every caller class below is turned away here, before anything is
// looked up or written. Real Postgres and the real authoriser.
import { randomUUID } from 'node:crypto';
import { Forbidden, Unauthorized, type Actor, type UserActor } from '@scorpion/contracts';
import { makeMembership, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useKpi } from '../test/harness.ts';
import { count, ingestionWorld, payloads, rejection, stored } from '../test/world.ts';
import { PERMISSION_SUBMIT } from './permissions.ts';
import { submitPolicy } from './policy.ts';

const h = useKpi();
const world = async () => ingestionWorld(await h.start());
const anonymous: Actor = { kind: 'anonymous' };
const EVENT = 'measurement.recorded@1';

describe('who may submit measurements for a service', () => {
  it('refuses an anonymous caller (401), and a plain user, a Reviewer, a requested, rejected or left member and a member of another provider (403) [ASVS-8.2.1] [ASVS-8.3.1]', async () => {
    const w = await world();
    const rows = [w.row(w.ind.downloads, '2026-01', 1)];
    const call = (who: Actor, dryRun?: boolean) =>
      w.ingestion.measurements.upsertBatch(who, w.svc.id, rows, { source: 'test', dryRun });
    await expect(call(anonymous)).rejects.toBeInstanceOf(Unauthorized);
    await expect(call(anonymous, true)).rejects.toBeInstanceOf(Unauthorized);
    const denied = ['plain', 'reviewer', 'requested', 'rejected', 'left', 'elsewhere'] as const;
    for (const who of denied) {
      await expect(call(w.people[who]), who).rejects.toBeInstanceOf(Forbidden);
      // a dry run is no softer: it reads the stored values, so it needs the same right
      await expect(call(w.people[who], true), `${who} dry run`).rejects.toBeInstanceOf(Forbidden);
    }
    expect(await count(w.pool, 'kpii_measurement')).toBe(0);
    expect(await payloads(w.pool, EVENT)).toEqual([]);
  });

  it('lets Admin, an approved manager and an approved member of the provider through [ASVS-8.2.1]', async () => {
    const w = await world();
    for (const [i, who] of (['admin', 'manager', 'member'] as const).entries()) {
      const result = await w.submit([w.row(w.ind.downloads, `2026-0${i + 1}`, i)], w.people[who]);
      expect(result.inserted, who).toBe(1);
    }
    expect(await stored(w.pool, w.svc.id)).toHaveLength(3);
  });

  it('answers per service: a member of one provider submits for the provider’s services only [ASVS-8.2.1]', async () => {
    const w = await world();
    const rows = [w.row(w.ind.downloads, '2026-01', 1)];
    // The member of the other provider is refused on this service ...
    await expect(
      w.ingestion.measurements.upsertBatch(w.people.elsewhere, w.svc.id, rows, { source: 'test' }),
    ).rejects.toBeInstanceOf(Forbidden);
    // ... and is let through on their own: the request then fails on what it asks (that service has no such KPI), not on the right.
    const own = await rejection(
      w.ingestion.measurements.upsertBatch(w.people.elsewhere, w.elsewhereSvc.id, rows, {
        source: 'test',
      }),
    );
    expect(own.status).toBe(422);
    // and a member of this provider gets 403 on the other provider's service
    await expect(
      w.ingestion.measurements.upsertBatch(w.people.member, w.elsewhereSvc.id, rows, {
        source: 'test',
      }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it('is not given by a consortium or by a second service of the same people [ASVS-8.2.1]', async () => {
    const w = await world();
    const net = await w.actor('user');
    const consortiumOnly = await makeService(w.pool, {
      provider: w.other.id,
      consortia: [w.provider.id],
    });
    await w.join(net, w.provider.id, 'approved');
    // `net` is a member of the first provider, and the service below names it only as a consortium
    await expect(
      w.ingestion.measurements.upsertBatch(
        net,
        consortiumOnly.id,
        [w.row(w.ind.downloads, '2026-01', 1)],
        {
          source: 'test',
        },
      ),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it('answers 403 to a stranger whether or not the service exists, so ids cannot be probed; Admin learns 404 [ASVS-8.2.1]', async () => {
    const w = await world();
    const rows = [w.row(w.ind.downloads, '2026-01', 1)];
    const ask = (who: Actor, id: string) =>
      w.ingestion.measurements.upsertBatch(who, id, rows, { source: 'test' });
    const unknown = randomUUID();
    await expect(ask(w.people.plain, unknown)).rejects.toBeInstanceOf(Forbidden);
    await expect(ask(w.people.plain, w.svc.id)).rejects.toBeInstanceOf(Forbidden);
    await expect(ask(w.people.plain, 'not-an-id')).rejects.toBeInstanceOf(Forbidden);
    await expect(ask(anonymous, unknown)).rejects.toBeInstanceOf(Unauthorized);
    expect((await rejection(ask(w.people.admin, unknown))).status).toBe(404);
    // a member asking about a service of their provider that does not exist is refused like a stranger
    await expect(ask(w.people.member, unknown)).rejects.toBeInstanceOf(Forbidden);
  });

  it('turns a token away unless it names the scope, and never lets it do more than its owner [ASVS-8.2.1] [ASVS-8.3.1]', async () => {
    const w = await world();
    const rows = [w.row(w.ind.downloads, '2026-01', 1)];
    const token = (owner: UserActor, scopes: string[]): UserActor => ({
      ...owner,
      via: 'token',
      scopes,
    });
    const call = (who: Actor) =>
      w.ingestion.measurements.upsertBatch(who, w.svc.id, rows, { source: 'test' });
    // the owner is a member: the scope decides. A token needs `submit` and nothing of kpi.framework's reads (ADR-0041,
    // "Amended in sprint 2"): the KPIs and bounds are read through a trusted read after the scoped check.
    await expect(call(token(w.people.member, []))).rejects.toBeInstanceOf(Forbidden);
    await expect(
      call(token(w.people.member, ['kpi.framework.set.read', 'kpi.framework.indicator.read'])),
    ).rejects.toBeInstanceOf(Forbidden);
    expect((await call(token(w.people.member, [PERMISSION_SUBMIT]))).inserted).toBe(1);
    // an Admin's token without the scope, and a plain user's token that names it, are both refused
    await expect(call(token(w.people.admin, []))).rejects.toBeInstanceOf(Forbidden);
    await expect(call(token(w.people.plain, [PERMISSION_SUBMIT]))).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(call(token(w.people.elsewhere, [PERMISSION_SUBMIT]))).rejects.toBeInstanceOf(
      Forbidden,
    );
  });
});

describe('the policy reads the provider’s membership at every call [ASVS-8.2.1]', () => {
  it('refuses a member who left, and a member whose row was removed, at the very next call', async () => {
    const w = await world();
    const rows = (n: number) => [w.row(w.ind.downloads, '2026-01', n)];
    const asMember = (n: number) => w.submit(rows(n), w.people.member);
    expect((await asMember(1)).inserted).toBe(1);
    await w.pool.query(
      "update org_membership set state = 'left' where organisation_id = $1 and user_id = $2",
      [w.provider.id, w.people.member.userId],
    );
    await expect(asMember(2)).rejects.toBeInstanceOf(Forbidden);
    await w.pool.query(
      "update org_membership set state = 'approved' where organisation_id = $1 and user_id = $2",
      [w.provider.id, w.people.member.userId],
    );
    expect((await asMember(3)).updated).toBe(1);
    await w.pool.query('delete from org_membership where organisation_id = $1 and user_id = $2', [
      w.provider.id,
      w.people.member.userId,
    ]);
    await expect(asMember(4)).rejects.toBeInstanceOf(Forbidden);
    expect((await stored(w.pool, w.svc.id))[0]!.value_numeric).toBe('3');
  });

  it('keeps a demoted manager a member, and lets a requested person in as soon as they are approved', async () => {
    const w = await world();
    const submit = (who: UserActor, n: number) =>
      w.submit([w.row(w.ind.downloads, '2026-02', n)], who);
    await w.pool.query(
      "update org_membership set role = 'member' where organisation_id = $1 and user_id = $2",
      [w.provider.id, w.people.manager.userId],
    );
    expect((await submit(w.people.manager, 1)).inserted).toBe(1);
    await expect(submit(w.people.requested, 2)).rejects.toBeInstanceOf(Forbidden);
    await w.pool.query(
      "update org_membership set state = 'approved' where organisation_id = $1 and user_id = $2",
      [w.provider.id, w.people.requested.userId],
    );
    expect((await submit(w.people.requested, 3)).updated).toBe(1);
  });

  it('follows the service when its provider changes: the old provider’s member loses the right, the new one’s gains it', async () => {
    const w = await world();
    const submit = (who: UserActor) => w.submit([w.row(w.ind.downloads, '2026-03', 1)], who);
    expect((await submit(w.people.member)).inserted).toBe(1);
    await w.pool.query(
      "update svc_service_organisation set organisation_id = $1 where service_id = $2 and role = 'provider'",
      [w.other.id, w.svc.id],
    );
    await expect(submit(w.people.member)).rejects.toBeInstanceOf(Forbidden);
    expect((await submit(w.people.elsewhere)).unchanged).toBe(1);
  });

  it('asks the database for every call and keeps no answer', async () => {
    const w = await world();
    // a member of the provider of two services, then one membership per call: five alternations, five different answers
    const a = w.people.member;
    const answers: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      const state = i % 2 === 0 ? 'left' : 'approved';
      await w.pool.query(
        'update org_membership set state = $3 where organisation_id = $1 and user_id = $2',
        [w.provider.id, a.userId, state],
      );
      answers.push(
        await w
          .submit([w.row(w.ind.downloads, '2026-04', i)], a)
          .then(() => true)
          .catch(() => false),
      );
    }
    expect(answers).toEqual([false, true, false, true, false]);
  });
});

describe('the policy of the scoped permission, on its own', () => {
  const policy = submitPolicy({ isProviderMember: () => () => Promise.resolve(true) });
  const request = (permission: string, resource: { type: string; id?: string }) => ({
    actor: { userId: randomUUID() },
    permission,
    resource,
  });

  it('answers for the resource type service, and for no other permission of any module', async () => {
    expect(policy.resourceType).toBe('service');
    const id = randomUUID();
    expect(await policy.allows(request(PERMISSION_SUBMIT, { type: 'service', id }))).toBe(true);
    for (const other of [
      'kpi.framework.service.kpis.edit',
      'registry.services.service.edit',
      'registry.services.service.edit-identity',
      'kpi.ingestion.measurement.read',
      'kpi.ingestion.v1.write',
      '',
    ])
      expect(await policy.allows(request(other, { type: 'service', id })), other).toBe(false);
  });

  it('grants nothing without a resource id, with a bad id, and asks the read only for a real id', async () => {
    const asked: string[] = [];
    const checked = submitPolicy({
      isProviderMember: () => (_user, service) => {
        asked.push(service);
        return Promise.resolve(true);
      },
    });
    for (const resource of [
      { type: 'service' },
      { type: 'service', id: '' },
      { type: 'service', id: 'x' },
    ])
      expect(await checked.allows(request(PERMISSION_SUBMIT, resource))).toBe(false);
    expect(asked).toEqual([]);
  });

  it('passes the answer of the read through, yes and no', async () => {
    const no = submitPolicy({ isProviderMember: () => () => Promise.resolve(false) });
    expect(await no.allows(request(PERMISSION_SUBMIT, { type: 'service', id: randomUUID() }))).toBe(
      false,
    );
  });
});

describe('a member of the provider is not thereby anything else', () => {
  it('does not give the member the right to change the KPIs of the service, or to change the service’s identity', async () => {
    const w = await world();
    const resource = { type: 'service', id: w.svc.id };
    const authz = w.kernel.services.get('core.authz') as {
      can(actor: Actor, permission: string, resource?: unknown): Promise<boolean>;
    };
    expect(await authz.can(w.people.member, PERMISSION_SUBMIT, resource)).toBe(true);
    expect(await authz.can(w.people.member, 'kpi.framework.service.kpis.edit', resource)).toBe(
      false,
    );
    expect(
      await authz.can(w.people.member, 'registry.services.service.edit-identity', resource),
    ).toBe(false);
    // and the permission is nobody's by role: no resource, no right (the member holds it on one service only)
    expect(await authz.can(w.people.member, PERMISSION_SUBMIT)).toBe(false);
    expect(await authz.can(w.people.member, PERMISSION_SUBMIT, { type: 'service' })).toBe(false);
    expect(await authz.can(w.people.admin, PERMISSION_SUBMIT)).toBe(true);
  });

  it('is nobody’s own approval: nobody approves their own membership by submitting', async () => {
    const w = await world();
    const member = await w.actor('user');
    await makeMembership(w.pool, {
      organisationId: w.provider.id,
      userId: member.userId,
      state: 'requested',
    });
    await expect(w.submit([w.row(w.ind.downloads, '2026-05', 1)], member)).rejects.toBeInstanceOf(
      Forbidden,
    );
  });
});

describe('the services a person may submit for (the picker of the Data Submission page)', () => {
  it('lists the provider’s services for a member and a manager, every service of the search for Admin, and none for anybody else [ASVS-8.2.1] [ASVS-8.3.1]', async () => {
    const w = await world();
    const ids = async (who: Actor, q?: string) =>
      (await w.ingestion.ingestion.submittableServices(who, { q })).map((row) => row.id);
    for (const who of ['member', 'manager'] as const) {
      expect(await ids(w.people[who]), who).toContain(w.svc.id);
      expect(await ids(w.people[who]), who).not.toContain(w.elsewhereSvc.id);
    }
    // the member of the other provider sees theirs and not this one
    expect(await ids(w.people.elsewhere)).toContain(w.elsewhereSvc.id);
    expect(await ids(w.people.elsewhere)).not.toContain(w.svc.id);
    const everything = await ids(w.people.admin);
    expect(everything).toEqual(expect.arrayContaining([w.svc.id, w.elsewhereSvc.id]));
    for (const who of ['plain', 'requested', 'rejected', 'left'] as const)
      expect(await ids(w.people[who]), who).toEqual([]);
    // a Reviewer holds no role `user` here, so the plain permission of the page is missing: 403, not an empty list
    await expect(ids(w.people.reviewer)).rejects.toBeInstanceOf(Forbidden);
  });

  it('is turned away for an anonymous caller (401), and a search narrows the list without ever widening it [ASVS-8.2.1]', async () => {
    const w = await world();
    await expect(w.ingestion.ingestion.submittableServices(anonymous, {})).rejects.toBeInstanceOf(
      Unauthorized,
    );
    const all = await w.ingestion.ingestion.submittableServices(w.people.admin, {});
    const one = all[0]!;
    const hit = await w.ingestion.ingestion.submittableServices(w.people.admin, { q: one.slug });
    expect(hit.map((row) => row.id)).toContain(one.id);
    // a member who searches for the other provider's service by its exact abbreviation still gets nothing
    expect(
      await w.ingestion.ingestion
        .submittableServices(w.people.member, {
          q: (all.find((row) => row.id === w.elsewhereSvc.id) ?? one).slug,
        })
        .then((rows) => rows.map((row) => row.id)),
    ).not.toContain(w.elsewhereSvc.id);
  });

  it('reads the membership at every call: a member who leaves no longer sees the service at once [ASVS-8.2.1]', async () => {
    const w = await world();
    const before = await w.ingestion.ingestion.submittableServices(w.people.member, {});
    expect(before.map((row) => row.id)).toContain(w.svc.id);
    await w.pool.query(
      "update org_membership set state = 'left' where organisation_id = $1 and user_id = $2",
      [w.provider.id, w.people.member.userId],
    );
    expect(await w.ingestion.ingestion.submittableServices(w.people.member, {})).toEqual([]);
  });
});
