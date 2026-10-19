// Defect 14 of FEATURES §5, KPI part of a service (M9 sprint 3): in the old application the additional KPIs of a service
// were add-only on the server (removals were ignored), a change of the category wrote the new KPIs next to the old ones,
// and an unknown category was a 500. Here, through the whole pipeline over real Postgres: an unknown set or indicator is
// a 422 that names the field, an extra can be removed, the change of the set replaces the old rows in one transaction
// (a failure keeps the old ones), and a person who is not a member of the provider is refused. Never weaken or delete it.
import {
  makeIndicator,
  makeKpiSet,
  makeMembership,
  makeOrganisation,
  makeService,
} from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
const as = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';
interface Problem {
  status: number;
  errors?: { path: string; message: string }[];
}
interface View {
  set: { id: string } | null;
  rows: { indicatorId: string; necessity: string; source: string }[];
  extras: { indicatorId: string }[];
  canEdit: boolean;
}

async function world() {
  const s = await app.start({ kpi: true });
  const pool = s.kernel.pool;
  const provider = await makeOrganisation(pool, { type: 'provider' });
  const other = await makeOrganisation(pool, { type: 'provider' });
  const service = await makeService(pool, { provider: provider.id });
  const admin = await s.signedIn('adminy', { roles: ['admin'] });
  const member = await s.signedIn('memmy');
  const plainMember = await s.signedIn('plainmem');
  const stranger = await s.signedIn('stranger');
  await makeMembership(pool, {
    organisationId: provider.id,
    userId: member.user.id,
    role: 'manager',
  });
  await makeMembership(pool, { organisationId: provider.id, userId: plainMember.user.id });
  await makeMembership(pool, {
    organisationId: other.id,
    userId: stranger.user.id,
    role: 'manager',
  });
  const [a, b, c, d] = await Promise.all([1, 2, 3, 4].map(() => makeIndicator(pool)));
  const first = await makeKpiSet(pool, {
    indicators: [
      { indicatorId: a!.id, necessity: 'mandatory' },
      { indicatorId: b!.id, necessity: 'optional' },
    ],
  });
  const second = await makeKpiSet(pool, {
    indicators: [{ indicatorId: c!.id, necessity: 'recommended' }],
  });
  const put = (who: typeof admin, body: unknown, id = service.id) =>
    s.call('PUT', `/kpi/services/${id}/kpis`, { ...as(who), body });
  const read = async (who = admin, id = service.id) =>
    (await s.get(`/kpi/services/${id}/kpis`, as(who))).body as View;
  const stored = async () => ({
    sets: (
      await pool.query<{ set_id: string }>(
        'select set_id from kpif_service_set where service_id = $1',
        [service.id],
      )
    ).rows.map((row) => row.set_id),
    extras: (
      await pool.query<{ indicator_id: string }>(
        'select indicator_id from kpif_service_extra_indicator where service_id = $1 order by indicator_id',
        [service.id],
      )
    ).rows.map((row) => row.indicator_id),
  });
  return {
    s,
    pool,
    service,
    admin,
    member,
    plainMember,
    stranger,
    a: a!,
    b: b!,
    c: c!,
    d: d!,
    first,
    second,
    put,
    read,
    stored,
  };
}

describe('defect 14: the KPIs of a service', () => {
  it('answers 422 naming the field, never 500, for an unknown set, an unknown indicator and a malformed id, and writes nothing', async () => {
    const { admin, member, service, first, put, stored } = await world();
    for (const who of [admin, member]) {
      const reply = await put(who, { setId: ABSENT, extras: [ABSENT] });
      expect(reply.status).toBe(422);
      expect((reply.body as Problem).errors?.map((e) => e.path).sort()).toEqual([
        'extras[0]',
        'setId',
      ]);
    }
    for (const body of [
      { setId: 'not-an-id', extras: [] },
      { setId: first.id, extras: ['nope'] },
      { setId: first.id },
      { extras: [] },
      { setId: null, extras: [], unknown: 1 },
    ])
      expect((await put(admin, body)).status, JSON.stringify(body)).toBe(422);
    expect((await put(admin, { setId: null, extras: [] }, 'not-a-uuid')).status).toBe(422);
    expect((await put(admin, { setId: null, extras: [] }, ABSENT)).status).toBe(404);
    expect(await stored()).toEqual({ sets: [], extras: [] });
    void service;
  });

  it('removes an extra: what was ignored in the old application works, and the list answers without it', async () => {
    const { admin, member, first, b, d, put, read, stored } = await world();
    expect((await put(member, { setId: first.id, extras: [d.id] })).status).toBe(200);
    expect((await stored()).extras).toEqual([d.id]);
    const removed = await put(member, { setId: first.id, extras: [] });
    expect(removed.status).toBe(200);
    expect((await stored()).extras).toEqual([]);
    expect((await read(admin)).extras).toEqual([]);
    // An extra that the set contains is dropped, not stored twice.
    const dropped = await put(admin, { setId: first.id, extras: [b.id, d.id] });
    expect(dropped.status).toBe(200);
    expect((await stored()).extras).toEqual([d.id]);
  });

  it('replaces the KPIs of the old set when the set changes, in one transaction', async () => {
    const { admin, first, second, a, c, put, read, stored } = await world();
    await put(admin, { setId: first.id, extras: [c.id] });
    const changed = await put(admin, { setId: second.id, extras: [a.id] });
    expect(changed.status).toBe(200);
    const view = await read(admin);
    expect(view.set?.id).toBe(second.id);
    // Not the old set's rows next to the new one's: `c` is the new set's row, `a` an extra of the service.
    expect(view.rows.map((row) => `${row.indicatorId}:${row.necessity}:${row.source}`)).toEqual([
      `${c.id}:recommended:set`,
      `${a.id}:optional:extra`,
    ]);
    expect(await stored()).toEqual({ sets: [second.id], extras: [a.id] });
  });

  it('keeps the old KPIs when the change fails half way (the event cannot be stored)', async () => {
    const { s, pool, admin, first, second, a, c, put, stored } = await world();
    await put(admin, { setId: first.id, extras: [c.id] });
    await pool.query(`
      create or replace function test_break_outbox() returns trigger as $$
      begin raise exception 'outbox is broken for this test'; end $$ language plpgsql;
      create trigger test_break_outbox before insert on kernel_outbox
        for each row execute function test_break_outbox();`);
    const failed = await put(admin, { setId: second.id, extras: [a.id] });
    await pool.query('drop trigger test_break_outbox on kernel_outbox');
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(await stored()).toEqual({ sets: [first.id], extras: [c.id] });
    void s;
  });

  it('is for the managers of the provider and Admin: a plain member, a manager of another provider and a person with no membership get 403 [ASVS-8.2.1] [ASVS-8.3.1]', async () => {
    const { s, admin, member, plainMember, stranger, first, put, read, stored } = await world();
    expect((await put(stranger, { setId: first.id, extras: [] })).status).toBe(403);
    expect((await put(plainMember, { setId: first.id, extras: [] })).status).toBe(403);
    const nobody = await s.signedIn('nobody-kpi');
    expect((await put(nobody, { setId: first.id, extras: [] })).status).toBe(403);
    expect(await stored()).toEqual({ sets: [], extras: [] });
    expect((await put(member, { setId: first.id, extras: [] })).status).toBe(200);
    // Everybody who is signed in may read; only those who may change are told so.
    expect((await read(stranger)).canEdit).toBe(false);
    expect((await read(plainMember)).canEdit).toBe(false);
    expect((await read(member)).canEdit).toBe(true);
    expect((await read(admin)).canEdit).toBe(true);
  });

  it('is refused without a session, and a read needs one too', async () => {
    const { s, service } = await world();
    expect(
      (
        await s.call('PUT', `/kpi/services/${service.id}/kpis`, {
          body: { setId: null, extras: [] },
        })
      ).status,
    ).toBe(401);
    expect((await s.get(`/kpi/services/${service.id}/kpis`, {})).status).toBe(401);
  });
});
