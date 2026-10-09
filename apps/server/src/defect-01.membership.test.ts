// Defect 1 (FEATURES §5), the delegated part: a person who may decide membership requests, change
// roles and remove members of ONE organisation (M6 sprint 3, ADR-0034) must not be able to approve
// their own request, change their own role, remove themselves, remove another manager, or touch another
// organisation. The routes carry the plain `…organisation.read`, so these cases go through the
// pipeline and prove that the SERVICE refuses. Through the whole pipeline, real Postgres, the real
// authoriser; no test authoriser. The matrix rows of the routes are in
// defect-01.privilege-escalation.test.ts.
import { makeMembership, makeOrganisation } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
const start = () => app.start({ tokenCacheTtlMs: 0 });
type Started = Awaited<ReturnType<typeof start>>;
const as = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const SCOPE = {
  read: 'registry.organisations.organisation.read',
  request: 'registry.organisations.membership.request',
  decide: 'registry.organisations.membership.decide',
  roles: 'registry.organisations.membership.manage-roles',
  remove: 'registry.organisations.membership.remove',
};

async function world() {
  const s = await start();
  const pool = s.kernel.pool;
  const admin = await s.signedIn('adminy', { roles: ['admin'] });
  const org = await makeOrganisation(pool, { abbreviation: 'IPK' });
  const other = await makeOrganisation(pool, { abbreviation: 'DKFZ' });
  const join = async (
    who: { user: { id: string } },
    organisationId: string,
    state = 'approved',
    role = 'member',
  ) =>
    makeMembership(pool, {
      organisationId,
      userId: who.user.id,
      state: state as 'approved',
      role: role as 'member',
    });
  const manager = await s.signedIn('manny');
  await join(manager, org.id, 'approved', 'manager');
  const rowId = async (who: { user: { id: string } }, organisationId = org.id) =>
    (
      await pool.query<{ id: string }>(
        'select id from org_membership where user_id = $1 and organisation_id = $2',
        [who.user.id, organisationId],
      )
    ).rows[0]!.id;
  const state = async (who: { user: { id: string } }, organisationId = org.id) =>
    (
      await pool.query<{ state: string; role: string }>(
        'select state, role from org_membership where user_id = $1 and organisation_id = $2',
        [who.user.id, organisationId],
      )
    ).rows[0];
  const decide = (who: Parameters<typeof as>[0], id: string, decision = 'approved') =>
    s.post(`/memberships/${id}/decision`, { ...as(who), body: { decision } });
  const role = (who: Parameters<typeof as>[0], id: string, value: string) =>
    s.post(`/memberships/${id}/role`, { ...as(who), body: { role: value } });
  const remove = (who: Parameters<typeof as>[0], id: string) =>
    s.post(`/memberships/${id}/remove`, as(who));
  return { s, admin, org, other, join, manager, rowId, state, decide, role, remove };
}

describe('defect 1: nobody approves their own membership request', () => {
  it('refuses an Admin and a manager their own request, and lets somebody else decide it [ASVS-8.2.1]', async () => {
    const w = await world();
    // An Admin asks; 403 and not 409: the protection comes before anything is looked at.
    const asked = await w.s.post(`/organisations/${w.org.id}/membership`, as(w.admin));
    expect(asked.status).toBe(201);
    const own = (asked.body as { id: string }).id;
    expect((await w.decide(w.admin, own)).status).toBe(403);
    expect((await w.decide(w.admin, own, 'rejected')).status).toBe(403);
    expect(await w.state(w.admin)).toEqual({ state: 'requested', role: 'member' });
    // A manager of this organisation asks for another one and cannot approve that request either.
    const theirs = await w.s.post(`/organisations/${w.other.id}/membership`, as(w.manager));
    expect((await w.decide(w.manager, (theirs.body as { id: string }).id)).status).toBe(403);
    expect(await w.state(w.manager, w.other.id)).toEqual({ state: 'requested', role: 'member' });
    // A second Admin can decide the first one's request.
    const second = await w.s.signedIn('second', { roles: ['admin'] });
    expect((await w.decide(second, own)).status).toBe(200);
    expect(await w.state(w.admin)).toEqual({ state: 'approved', role: 'member' });
  });

  it('refuses an approver who holds the permission in a custom role their own request [ASVS-8.2.1]', async () => {
    const w = await world();
    const { makeRole } = await import('@scorpion/testing');
    const role = await makeRole(w.s.kernel.pool, {
      permissions: [SCOPE.read, SCOPE.request, SCOPE.decide],
    });
    const approver = await w.s.signedIn('approver', { roles: [role.key] });
    const asked = await w.s.post(`/organisations/${w.org.id}/membership`, as(approver));
    const own = (asked.body as { id: string }).id;
    // The custom role holds the permission globally; the approval rule still stops them.
    expect((await w.decide(approver, own)).status).toBe(403);
    // But they may decide somebody else's.
    const person = await w.s.signedIn('perry');
    const theirs = await w.s.post(`/organisations/${w.org.id}/membership`, as(person));
    expect((await w.decide(approver, (theirs.body as { id: string }).id)).status).toBe(200);
  });
});

describe('defect 1: nobody changes their own role, removes themselves, or removes a manager', () => {
  it('refuses a manager to promote or demote themselves, and an Admin who is a member to make themselves manager [ASVS-8.2.1]', async () => {
    const w = await world();
    const mine = await w.rowId(w.manager);
    expect((await w.role(w.manager, mine, 'member')).status).toBe(403);
    expect((await w.role(w.manager, mine, 'manager')).status).toBe(403);
    expect(await w.state(w.manager)).toEqual({ state: 'approved', role: 'manager' });
    // An Admin who is an ordinary member of the organisation.
    await w.join(w.admin, w.org.id);
    const adminRow = await w.rowId(w.admin);
    expect((await w.role(w.admin, adminRow, 'manager')).status).toBe(403);
    expect(await w.state(w.admin)).toEqual({ state: 'approved', role: 'member' });
    // Somebody else can: a manager promotes the Admin.
    expect((await w.role(w.manager, adminRow, 'manager')).status).toBe(200);
  });

  it('refuses a manager and an Admin to remove themselves (that is leave), and a manager to remove another manager [ASVS-8.2.1]', async () => {
    const w = await world();
    const peer = await w.s.signedIn('peer');
    await w.join(peer, w.org.id, 'approved', 'manager');
    expect((await w.remove(w.manager, await w.rowId(w.manager))).status).toBe(403);
    expect((await w.remove(w.manager, await w.rowId(peer))).status).toBe(403);
    await w.join(w.admin, w.org.id);
    expect((await w.remove(w.admin, await w.rowId(w.admin))).status).toBe(403);
    for (const who of [w.manager, peer, w.admin]) {
      expect((await w.state(who))!.state, who.user.username).toBe('approved');
    }
    // An Admin removes a manager; a manager removes a plain member.
    expect((await w.remove(w.admin, await w.rowId(peer))).status).toBe(200);
    const member = await w.s.signedIn('memmy');
    await w.join(member, w.org.id);
    expect((await w.remove(w.manager, await w.rowId(member))).status).toBe(200);
  });
});

describe('defect 1: a manager of one organisation has no right on another', () => {
  it('refuses a manager every action on a membership of another organisation, by id [ASVS-8.2.2]', async () => {
    const w = await world();
    const person = await w.s.signedIn('perry');
    const asked = await w.join(person, w.other.id, 'requested');
    const member = await w.s.signedIn('memmy');
    await w.join(member, w.other.id);
    const memberRow = await w.rowId(member, w.other.id);
    expect((await w.decide(w.manager, asked.id)).status).toBe(403);
    expect((await w.role(w.manager, memberRow, 'manager')).status).toBe(403);
    expect((await w.remove(w.manager, memberRow)).status).toBe(403);
    expect((await w.s.get(`/organisations/${w.other.id}/members`, as(w.manager))).status).toBe(403);
    expect((await w.s.get(`/memberships?organisationId=${w.other.id}`, as(w.manager))).status).toBe(
      403,
    );
    // The list shows only their own organisation.
    const listed = await w.s.get('/memberships', as(w.manager));
    expect(JSON.stringify(listed.body)).not.toContain(asked.id);
    expect(await w.state(person, w.other.id)).toEqual({ state: 'requested', role: 'member' });
    expect(await w.state(member, w.other.id)).toEqual({ state: 'approved', role: 'member' });
    expect(
      (
        await w.s.kernel.pool.query(
          "select 1 from kernel_outbox where name like 'registry.membership.%'",
        )
      ).rows,
    ).toEqual([]);
  });

  it('answers another person’s own-data routes as if the row did not exist [ASVS-8.2.2]', async () => {
    const w = await world();
    const member = await w.s.signedIn('memmy');
    await w.join(member, w.org.id);
    const nobody = await w.s.signedIn('nobody');
    // The routes name an organisation and act on the caller's own row only: there is nobody else's to reach.
    expect(
      (await w.s.call('DELETE', `/organisations/${w.org.id}/membership`, as(nobody))).status,
    ).toBe(404);
    expect(
      ((await w.s.get('/account/memberships', as(nobody))).body as { result: unknown[] }).result,
    ).toEqual([]);
    expect(await w.state(member)).toEqual({ state: 'approved', role: 'member' });
  });
});

describe('defect 1: the route alone lets everybody through, so the service is the guard', () => {
  it('turns a plain member, a person who asked and a plain User away at the service though the route accepted them [ASVS-8.3.1]', async () => {
    const w = await world();
    const person = await w.s.signedIn('perry');
    const asked = await w.join(person, w.org.id, 'requested');
    const member = await w.s.signedIn('memmy');
    await w.join(member, w.org.id);
    const plain = await w.s.signedIn('plain');
    const target = await w.s.signedIn('target');
    await w.join(target, w.org.id);
    for (const who of [member, person, plain]) {
      expect((await w.decide(who, asked.id)).status, who.user.username).toBe(403);
      expect((await w.role(who, await w.rowId(target), 'manager')).status).toBe(403);
      expect((await w.remove(who, await w.rowId(target))).status).toBe(403);
      expect((await w.s.get('/memberships', as(who))).status).toBe(403);
    }
    // A plain User cannot read the members; a member can (the setting is on).
    expect((await w.s.get(`/organisations/${w.org.id}/members`, as(plain))).status).toBe(403);
    expect((await w.s.get(`/organisations/${w.org.id}/members`, as(member))).status).toBe(200);
    expect(await w.state(person)).toEqual({ state: 'requested', role: 'member' });
    expect(await w.state(target)).toEqual({ state: 'approved', role: 'member' });
  });
});

describe('defect 1: a token decides nothing beyond its scopes', () => {
  async function tokenOf(
    s: Started,
    owner: Parameters<typeof as>[0],
    name: string,
    scopes: string[],
  ) {
    const made = await s.post('/tokens', { ...as(owner), body: { name, scopes } });
    expect(made.status).toBe(201);
    return (made.body as { token: string }).token;
  }
  const withToken = (s: Started, token: string, path: string, body?: unknown) =>
    s.call('POST', path, { headers: bearer(token), body });

  it('limits a token of an Admin and of a manager to the scopes it names [ASVS-8.2.1]', async () => {
    const w = await world();
    const person = await w.s.signedIn('perry');
    const asked = await w.join(person, w.org.id, 'requested');
    const member = await w.s.signedIn('memmy');
    await w.join(member, w.org.id);
    const memberRow = await w.rowId(member);
    for (const owner of [w.admin, w.manager]) {
      const name = owner.user.username;
      const readOnly = await tokenOf(w.s, owner, `${name}-read`, [SCOPE.read]);
      const decideOnly = await tokenOf(w.s, owner, `${name}-decide`, [SCOPE.read, SCOPE.decide]);
      // Without the scope it grants nothing, though the owner holds the right.
      expect(
        (
          await withToken(w.s, readOnly, `/memberships/${asked.id}/decision`, {
            decision: 'approved',
          })
        ).status,
      ).toBe(403);
      expect(
        (await withToken(w.s, decideOnly, `/memberships/${memberRow}/role`, { role: 'manager' }))
          .status,
      ).toBe(403);
      expect((await withToken(w.s, decideOnly, `/memberships/${memberRow}/remove`)).status).toBe(
        403,
      );
      expect((await w.s.call('GET', '/memberships', { headers: bearer(readOnly) })).status).toBe(
        403,
      );
    }
    expect(await w.state(person)).toEqual({ state: 'requested', role: 'member' });
    expect(await w.state(member)).toEqual({ state: 'approved', role: 'member' });
    // With the scope the manager's token decides, and only that.
    const token = await tokenOf(w.s, w.manager, 'can-decide', [SCOPE.read, SCOPE.decide]);
    expect(
      (await withToken(w.s, token, `/memberships/${asked.id}/decision`, { decision: 'approved' }))
        .status,
    ).toBe(200);
    expect(await w.state(person)).toEqual({ state: 'approved', role: 'member' });
  });

  it('gives a token nothing the owner lacks: a plain User, or a member, cannot widen themselves with a scope [ASVS-8.2.1]', async () => {
    const w = await world();
    const person = await w.s.signedIn('perry');
    const asked = await w.join(person, w.org.id, 'requested');
    const member = await w.s.signedIn('memmy');
    await w.join(member, w.org.id);
    const target = await w.s.signedIn('target');
    await w.join(target, w.org.id);
    for (const owner of [member, await w.s.signedIn('plain')]) {
      const token = await tokenOf(w.s, owner, 'wide', [SCOPE.read, SCOPE.decide, SCOPE.roles]);
      const other = await tokenOf(w.s, owner, 'wide2', [SCOPE.remove]);
      expect(
        (await withToken(w.s, token, `/memberships/${asked.id}/decision`, { decision: 'approved' }))
          .status,
      ).toBe(403);
      expect(
        (
          await withToken(w.s, token, `/memberships/${await w.rowId(target)}/role`, {
            role: 'manager',
          })
        ).status,
      ).toBe(403);
      expect(
        (await withToken(w.s, other, `/memberships/${await w.rowId(target)}/remove`)).status,
      ).toBe(403);
    }
    expect(await w.state(person)).toEqual({ state: 'requested', role: 'member' });
    expect(await w.state(target)).toEqual({ state: 'approved', role: 'member' });
  });

  it('refuses an Admin’s token its own request and its own role even with every scope [ASVS-8.2.1]', async () => {
    const w = await world();
    const asked = await w.s.post(`/organisations/${w.org.id}/membership`, as(w.admin));
    const own = (asked.body as { id: string }).id;
    await w.join(w.admin, w.other.id);
    const token = await tokenOf(w.s, w.admin, 'all', [
      SCOPE.read,
      SCOPE.request,
      SCOPE.decide,
      SCOPE.roles,
      SCOPE.remove,
    ]);
    expect(
      (await withToken(w.s, token, `/memberships/${own}/decision`, { decision: 'approved' }))
        .status,
    ).toBe(403);
    const mine = await w.rowId(w.admin, w.other.id);
    expect(
      (await withToken(w.s, token, `/memberships/${mine}/role`, { role: 'manager' })).status,
    ).toBe(403);
    expect((await withToken(w.s, token, `/memberships/${mine}/remove`)).status).toBe(403);
    expect(await w.state(w.admin)).toEqual({ state: 'requested', role: 'member' });
    expect(await w.state(w.admin, w.other.id)).toEqual({ state: 'approved', role: 'member' });
  });
});

describe('defect 1: a plain User leaves no trace on the delegated routes', () => {
  it('changes nothing in the tables, the outbox or the mail queue', async () => {
    const w = await world();
    const person = await w.s.signedIn('perry');
    const asked = await w.join(person, w.org.id, 'requested');
    const plain = await w.s.signedIn('plain');
    const pool = w.s.kernel.pool;
    const snapshot = async () =>
      JSON.stringify([
        (await pool.query('select * from org_membership order by id')).rows,
        (
          await pool.query(
            "select name from kernel_outbox where name like 'registry.%' order by id",
          )
        ).rows,
        (await pool.query('select 1 from notify_delivery')).rows,
        (await pool.query('select 1 from notify_inbox_item')).rows,
      ]);
    const before = await snapshot();
    await w.decide(plain, asked.id);
    await w.role(plain, asked.id, 'manager');
    await w.remove(plain, asked.id);
    await w.s.get('/memberships', as(plain));
    await w.s.get(`/organisations/${w.org.id}/members`, as(plain));
    expect(await snapshot()).toBe(before);
  });
});
