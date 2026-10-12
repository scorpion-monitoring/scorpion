// The membership routes through the whole pipeline (session, CSRF, permission, validation, error
// mapping) over real Postgres. Each answer is parsed with the response schema of its route, so the
// generated OpenAPI document and the real answer cannot differ. The denied cases of every route are in
// defect-01.privilege-escalation.test.ts (the matrix) and defect-01.membership.test.ts (the self
// cases); the service rules are in modules/registry-organisations/service/memberships.*.test.ts.
import { generateOpenApiDocument, type AppRoute } from '@scorpion/contracts';
import { makeMembership, makeOrganisation } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { SURFACE_PREFIX } from './app.ts';
import { useIdentityApp, type Reply } from './testing/identity-app.ts';

const app = useIdentityApp();
const start = (options: Parameters<typeof app.start>[0] = {}) => app.start(options);
type Started = Awaited<ReturnType<typeof start>>;
const as = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
interface Page<T> {
  metadata: { currentPage: number; pageSize: number; totalCount: number; totalPages: number };
  result: T[];
}
interface Problem {
  type?: string;
  status: number;
  detail?: string;
  errors?: { in?: string; path: string; message: string }[];
}

/** Parses a reply with the response schema its route declares for the status (the OpenAPI contract). */
function conforms(s: Started, reply: Reply, method: string, path: string) {
  const found = s.kernel.routes.find(
    ({ route }) => route.method.toUpperCase() === method && route.path === path,
  );
  expect(found, `${method} ${path} is registered`).toBeDefined();
  const schema = (
    found!.route.responses as Record<
      number,
      { content?: Record<string, { schema?: { safeParse(v: unknown): { success: boolean } } }> }
    >
  )[reply.status]?.content?.['application/json']?.schema;
  expect(schema, `${method} ${path} declares a ${reply.status} answer`).toBeDefined();
  const parsed = schema!.safeParse(reply.body);
  expect(parsed.success, JSON.stringify(reply.body)).toBe(true);
}

/** An Admin, a manager and a member of one organisation, and a plain person. */
async function world() {
  const s = await start();
  const admin = await s.signedIn('adminy', { roles: ['admin'] });
  const org = await makeOrganisation(s.kernel.pool, { abbreviation: 'IPK', name: 'Leibniz IPK' });
  const manager = await s.signedIn('manny');
  await makeMembership(s.kernel.pool, {
    organisationId: org.id,
    userId: manager.user.id,
    role: 'manager',
  });
  const member = await s.signedIn('memmy');
  await makeMembership(s.kernel.pool, { organisationId: org.id, userId: member.user.id });
  const person = await s.signedIn('perry');
  return { s, admin, org, manager, member, person };
}

describe('the membership journey through the routes', () => {
  it('asks, is decided by a manager, is mailed, becomes manager, is removed by an Admin, and can ask again', async () => {
    const { s, admin, org, manager, member, person } = await world();
    // 1. The person asks: 201 with the row, then 200 for the same request again.
    const asked = await s.post(`/organisations/${org.id}/membership`, as(person));
    expect(asked.status).toBe(201);
    conforms(s, asked, 'POST', '/organisations/{id}/membership');
    const row = asked.body as { id: string; state: string; role: string };
    expect(row).toMatchObject({ state: 'requested', role: 'member' });
    const again = await s.post(`/organisations/${org.id}/membership`, as(person));
    expect(again.status).toBe(200);
    conforms(s, again, 'POST', '/organisations/{id}/membership');
    expect((again.body as { id: string }).id).toBe(row.id);

    // 2. The manager sees it, with the buttons to draw; the Admin sees it too; a member does not.
    const list = await s.get('/memberships?state=requested', as(manager));
    expect(list.status).toBe(200);
    conforms(s, list, 'GET', '/memberships');
    const found = (list.body as Page<Record<string, unknown>>).result;
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      id: row.id,
      username: 'perry',
      state: 'requested',
      allowedActions: ['approve', 'reject'],
    });
    expect((await s.get('/memberships', as(admin))).status).toBe(200);
    expect((await s.get('/memberships', as(member))).status).toBe(403);
    expect((await s.get('/memberships/summary', as(manager))).body).toEqual({
      pending: 1,
      manages: true,
    });
    expect((await s.get('/memberships/summary', as(person))).body).toEqual({
      pending: 0,
      manages: false,
    });

    // 3. The manager approves; the person is mailed (read from the queue) and sees the row.
    const approved = await s.post(`/memberships/${row.id}/decision`, {
      ...as(manager),
      body: { decision: 'approved' },
    });
    expect(approved.status).toBe(200);
    conforms(s, approved, 'POST', '/memberships/{id}/decision');
    expect(approved.body).toMatchObject({ state: 'approved' });
    const mail = (await s.mail.all()).find((m) => m.template === 'registry.membership-decided');
    expect(mail?.to).toBe('perry@example.org');
    expect(mail?.subject).toBe('Your membership of Leibniz IPK was approved');
    const own = await s.get('/account/memberships', as(person));
    expect(own.status).toBe(200);
    conforms(s, own, 'GET', '/account/memberships');
    expect((own.body as Page<{ state: string }>).result.map((r) => r.state)).toEqual(['approved']);

    // 4. A member sees the other members: usernames and dates, no address, no state.
    const members = await s.get(`/organisations/${org.id}/members`, as(person));
    expect(members.status).toBe(200);
    conforms(s, members, 'GET', '/organisations/{id}/members');
    expect(
      (members.body as Page<{ username: string }>).result.map((m) => m.username).sort(),
    ).toEqual(['manny', 'memmy', 'perry']);

    // 5. The manager promotes the person (idempotent the second time); an inbox item, no mail.
    const promoted = await s.post(`/memberships/${row.id}/role`, {
      ...as(manager),
      body: { role: 'manager' },
    });
    expect(promoted.status).toBe(200);
    conforms(s, promoted, 'POST', '/memberships/{id}/role');
    expect(promoted.body).toMatchObject({ role: 'manager' });
    expect(
      (await s.post(`/memberships/${row.id}/role`, { ...as(manager), body: { role: 'manager' } }))
        .status,
    ).toBe(200);
    expect(
      (await s.mail.all()).filter((m) => m.template === 'registry.membership-role-changed'),
    ).toEqual([]);

    // 6. A manager cannot remove a manager; the Admin can.
    expect((await s.post(`/memberships/${row.id}/remove`, as(manager))).status).toBe(403);
    const removed = await s.post(`/memberships/${row.id}/remove`, as(admin));
    expect(removed.status).toBe(200);
    conforms(s, removed, 'POST', '/memberships/{id}/remove');
    expect(removed.body).toMatchObject({ state: 'left', role: 'member' });

    // 7. The person has nothing to leave, and may ask again.
    expect((await s.call('DELETE', `/organisations/${org.id}/membership`, as(person))).status).toBe(
      404,
    );
    expect((await s.post(`/organisations/${org.id}/membership`, as(person))).status).toBe(201);
    const withdrawn = await s.call('DELETE', `/organisations/${org.id}/membership`, as(person));
    expect(withdrawn.status).toBe(200);
    conforms(s, withdrawn, 'DELETE', '/organisations/{id}/membership');
    expect(withdrawn.body).toMatchObject({ state: 'left' });
  });

  it('never puts an email address in an answer', async () => {
    const { s, admin, org, manager, member, person } = await world();
    const asked = await s.post(`/organisations/${org.id}/membership`, as(person));
    const id = (asked.body as { id: string }).id;
    const replies: Reply[] = [
      asked,
      await s.get('/memberships', as(admin)),
      await s.get('/memberships', as(manager)),
      await s.get(`/organisations/${org.id}/members`, as(member)),
      await s.get('/account/memberships', as(person)),
      await s.get('/organisations', as(person)),
      await s.get(`/organisations/${org.id}`, as(person)),
      await s.post(`/memberships/${id}/decision`, { ...as(admin), body: { decision: 'approved' } }),
      await s.post(`/memberships/${id}/role`, { ...as(admin), body: { role: 'manager' } }),
      await s.post(`/memberships/${id}/remove`, as(admin)),
    ];
    for (const reply of replies) {
      expect(reply.status).toBeLessThan(300);
      expect(JSON.stringify(reply.body)).not.toMatch(/@example\.org/);
    }
  });
});

describe('problems', () => {
  it('answers 409 with the problem types too-many-pending, membership-state and too-many-managers, and 404 for unknown ids', async () => {
    const { s, admin, org, manager, member, person } = await world();
    const other = await makeOrganisation(s.kernel.pool);
    // too-many-pending
    const saved = await s.get('/settings/registry.organisations', as(admin));
    await s.call('PUT', '/settings/registry.organisations', {
      ...as(admin),
      body: {
        version: (saved.body as { version: number }).version,
        values: { membership: { maxPendingPerUser: 1, maxManagersPerOrganisation: 2 } },
      },
    });
    expect((await s.post(`/organisations/${org.id}/membership`, as(person))).status).toBe(201);
    const capped = await s.post(`/organisations/${other.id}/membership`, as(person));
    expect(capped.status).toBe(409);
    expect((capped.body as Problem).type).toBe('too-many-pending');
    // membership-state
    const pending = await s.get('/memberships?state=requested', as(admin));
    const id = (pending.body as Page<{ id: string }>).result[0]!.id;
    await s.post(`/memberships/${id}/decision`, { ...as(manager), body: { decision: 'approved' } });
    const late = await s.post(`/memberships/${id}/decision`, {
      ...as(admin),
      body: { decision: 'rejected' },
    });
    expect(late.status).toBe(409);
    expect((late.body as Problem).type).toBe('membership-state');
    // too-many-managers (limit 2: the manager is one, the promoted person the second, the member a third)
    await s.post(`/memberships/${id}/role`, { ...as(manager), body: { role: 'manager' } });
    const memberRow = (
      await s.kernel.pool.query<{ id: string }>(
        'select id from org_membership where user_id = $1',
        [member.user.id],
      )
    ).rows[0]!.id;
    const over = await s.post(`/memberships/${memberRow}/role`, {
      ...as(admin),
      body: { role: 'manager' },
    });
    expect(over.status).toBe(409);
    expect((over.body as Problem).type).toBe('too-many-managers');
    // unknown ids
    const absent = '018f3b7e-0000-7000-8000-000000000000';
    for (const path of ['decision', 'role', 'remove']) {
      const reply = await s.post(`/memberships/${absent}/${path}`, {
        ...as(admin),
        body:
          path === 'decision'
            ? { decision: 'approved' }
            : path === 'role'
              ? { role: 'member' }
              : undefined,
      });
      expect(reply.status, path).toBe(404);
    }
    expect((await s.post(`/organisations/${absent}/membership`, as(person))).status).toBe(404);
    expect((await s.get(`/organisations/${absent}/members`, as(admin))).status).toBe(404);
  });

  it('answers 422, never 500, for a malformed id, an unknown field, a bad value and a bad query', async () => {
    const { s, admin, manager, org } = await world();
    const attempts: [string, string, unknown][] = [
      ['POST', '/organisations/not-a-uuid/membership', undefined],
      ['DELETE', '/organisations/not-a-uuid/membership', undefined],
      ['GET', '/organisations/not-a-uuid/members', undefined],
      ['POST', '/memberships/not-a-uuid/decision', { decision: 'approved' }],
      ['POST', `/memberships/${org.id}/decision`, { decision: 'maybe' }],
      ['POST', `/memberships/${org.id}/decision`, { decision: 'approved', role: 'manager' }],
      ['POST', `/memberships/${org.id}/decision`, {}],
      ['POST', `/memberships/${org.id}/role`, { role: 'owner' }],
      ['POST', `/memberships/${org.id}/role`, { role: 'manager', userId: org.id }],
      ['POST', '/memberships/not-a-uuid/remove', undefined],
      ['GET', '/memberships?state=pending', undefined],
      ['GET', '/memberships?organisationId=nope', undefined],
      ['GET', '/memberships?pageSize=101', undefined],
      ['GET', '/memberships?colour=red', undefined],
      ['GET', '/account/memberships?page=-1', undefined],
    ];
    for (const who of [admin, manager]) {
      for (const [method, path, body] of attempts) {
        const reply = await s.call(method, path, { ...as(who), body });
        expect(reply.status, `${method} ${path} ${JSON.stringify(body)}`).toBe(422);
        expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
      }
    }
  });

  it('answers 401 to an anonymous caller on every membership route', async () => {
    const { s, org } = await world();
    const id = org.id;
    for (const [method, path, body] of [
      ['POST', `/organisations/${id}/membership`, undefined],
      ['DELETE', `/organisations/${id}/membership`, undefined],
      ['GET', '/account/memberships', undefined],
      ['GET', `/organisations/${id}/members`, undefined],
      ['GET', '/memberships', undefined],
      ['GET', '/memberships/summary', undefined],
      ['POST', `/memberships/${id}/decision`, { decision: 'approved' }],
      ['POST', `/memberships/${id}/role`, { role: 'manager' }],
      ['POST', `/memberships/${id}/remove`, undefined],
    ] as const) {
      expect((await s.call(method, path, { body })).status, `${method} ${path}`).toBe(401);
    }
  });
});

describe('what the trail keeps', () => {
  it('writes an audit entry for a decision, a role change and a removal, also when a plain user was turned away, and one event each', async () => {
    const { s, admin, org, manager, person, member } = await world();
    const asked = await s.post(`/organisations/${org.id}/membership`, as(person));
    const id = (asked.body as { id: string }).id;
    // A plain member tries all three first: 403 each, and the trail says so.
    await s.post(`/memberships/${id}/decision`, { ...as(member), body: { decision: 'approved' } });
    await s.post(`/memberships/${id}/role`, { ...as(member), body: { role: 'manager' } });
    await s.post(`/memberships/${id}/remove`, as(member));
    await s.post(`/memberships/${id}/decision`, { ...as(manager), body: { decision: 'approved' } });
    await s.post(`/memberships/${id}/role`, { ...as(admin), body: { role: 'manager' } });
    await s.post(`/memberships/${id}/remove`, as(admin));
    while ((await s.kernel.dispatcher.dispatchOnce()) > 0) {
      // run until the outbox is quiet
    }
    const { rows } = await s.kernel.pool.query<{
      action: string;
      path: string | null;
      outcome: string;
      source: string;
      body: unknown;
    }>(
      `select action, path, outcome, source, body from audit_event
        where path like '/api/internal/memberships%' or action like 'registry.membership.%' order by occurred_at, id`,
    );
    const api = rows.filter((r) => r.source === 'api');
    expect(api.map((r) => `${r.action} ${r.path} ${r.outcome}`)).toEqual([
      'api.POST /api/internal/memberships/{id}/decision denied',
      'api.POST /api/internal/memberships/{id}/role denied',
      'api.POST /api/internal/memberships/{id}/remove denied',
      'api.POST /api/internal/memberships/{id}/decision ok',
      'api.POST /api/internal/memberships/{id}/role ok',
      'api.POST /api/internal/memberships/{id}/remove ok',
    ]);
    expect(api.every((r) => r.body === null)).toBe(true);
    const events = rows.filter((r) => r.source === 'event').map((r) => r.action);
    expect(events).toEqual([
      'registry.membership.requested@1',
      'registry.membership.decided@1',
      'registry.membership.roleChanged@1',
      'registry.membership.left@1',
    ]);
  });

  it('keeps the audit entry of a decision, a role change and an ended membership even when channels.admin is off (critical)', async () => {
    const { s, admin, org, manager, person } = await world();
    const saved = await s.get('/settings/core.audit', as(admin));
    await s.call('PUT', '/settings/core.audit', {
      ...as(admin),
      body: {
        version: (saved.body as { version: number }).version,
        values: { channels: { admin: false, api: true } },
      },
    });
    const asked = await s.post(`/organisations/${org.id}/membership`, as(person));
    const id = (asked.body as { id: string }).id;
    await s.post(`/memberships/${id}/decision`, { ...as(manager), body: { decision: 'approved' } });
    await s.post(`/memberships/${id}/role`, { ...as(manager), body: { role: 'manager' } });
    await s.post(`/memberships/${id}/remove`, as(admin));
    // The person asks again and leaves: ordinary, so with the channel off nothing is logged.
    await s.post(`/organisations/${org.id}/membership`, as(person));
    await s.call('DELETE', `/organisations/${org.id}/membership`, as(person));
    while ((await s.kernel.dispatcher.dispatchOnce()) > 0) {
      // run until the outbox is quiet
    }
    const { rows } = await s.kernel.pool.query<{ action: string }>(
      "select action from audit_event where action like 'registry.membership.%' order by occurred_at, id",
    );
    expect(rows.map((r) => r.action)).toEqual([
      'registry.membership.decided@1',
      'registry.membership.roleChanged@1',
      'registry.membership.left@1', // by: admin is critical
    ]);
  });
});

describe('the OpenAPI document', () => {
  it('names the plain permission on every delegated route and the scoped ones on none (ADR-0034)', async () => {
    const s = await start();
    const routes: AppRoute[] = s.kernel.routes
      .filter(({ module }) => module === 'registry.organisations')
      .map(({ route, surface }) => ({ ...route, path: `${SURFACE_PREFIX[surface]}${route.path}` }));
    const document = generateOpenApiDocument(routes, { title: 'Organisations', version: '1' });
    const permissions = Object.values(document.paths ?? {}).flatMap((item) =>
      Object.values(item ?? {}).flatMap((op) => {
        const permission = (op as { 'x-permission'?: string })?.['x-permission'];
        return permission ? [permission] : [];
      }),
    );
    expect(permissions.length).toBe(18);
    const scoped = [
      'registry.organisations.membership.decide',
      'registry.organisations.membership.manage-roles',
      'registry.organisations.membership.remove',
      'registry.organisations.membership.view-members',
      'registry.organisations.organisation.edit',
      'registry.organisations.organisation.read-contact',
    ];
    for (const permission of permissions) expect(scoped).not.toContain(permission);
    expect(document.paths?.['/api/internal/memberships/{id}/decision']?.post).toMatchObject({
      'x-permission': 'registry.organisations.organisation.read',
    });
    expect(document.paths?.['/api/internal/organisations/{id}/membership']?.post).toMatchObject({
      'x-permission': 'registry.organisations.membership.request',
    });
  });
});
