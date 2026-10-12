// Editing an organisation through the whole pipeline (session, CSRF, permission, validation, error mapping,
// audit) over real Postgres: an Admin edits every field and creates and deletes; a manager of the
// organisation edits the descriptive fields and the logo (M6 sprint 4, Decision 14). `PATCH` and the logo
// routes carry the plain `…organisation.read` (ADR-0034), so the service is what refuses; every refusal
// here is the service's. The service rules are in modules/registry-organisations/service/editing.test.ts,
// the denied cases of every route in defect-01.privilege-escalation.test.ts and
// defect-01.organisation-editing.test.ts.
import { makeMembership, makeOrganisation, makePng } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentityApp, type Reply } from './testing/identity-app.ts';

const app = useIdentityApp();
const start = () => app.start({ tokenCacheTtlMs: 0 });
type Started = Awaited<ReturnType<typeof start>>;
const as = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
interface Problem {
  type?: string;
  status: number;
  detail?: string;
  errors?: { path: string; message: string }[];
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
  expect(schema!.safeParse(reply.body).success, JSON.stringify(reply.body)).toBe(true);
}

async function world() {
  const s = await start();
  const pool = s.kernel.pool;
  const admin = await s.signedIn('adminy', { roles: ['admin'] });
  const org = await makeOrganisation(pool, {
    abbreviation: 'IPK',
    name: 'Leibniz IPK',
    description: 'old',
    contactEmail: 'old@example.org',
    contactType: 'support',
  });
  const other = await makeOrganisation(pool, { abbreviation: 'DKFZ', name: 'DKFZ Heidelberg' });
  const manager = await s.signedIn('manny');
  await makeMembership(pool, { organisationId: org.id, userId: manager.user.id, role: 'manager' });
  const managerElsewhere = await s.signedIn('elsa');
  await makeMembership(pool, {
    organisationId: other.id,
    userId: managerElsewhere.user.id,
    role: 'manager',
  });
  const member = await s.signedIn('memmy');
  await makeMembership(pool, { organisationId: org.id, userId: member.user.id });
  const person = await s.signedIn('perry');
  const row = async (id = org.id) =>
    (await pool.query('select * from org_organisation where id = $1', [id])).rows[0] as Record<
      string,
      unknown
    >;
  const patch = (who: Parameters<typeof as>[0], body: unknown, id = org.id) =>
    s.call('PATCH', `/organisations/${id}`, { ...as(who), body });
  const blobs = async () =>
    (await pool.query<{ n: number }>('select count(*)::int as n from blob_blob')).rows[0]!.n;
  const settle = async () => {
    while ((await s.kernel.dispatcher.dispatchOnce()) > 0) {
      // run until the outbox is quiet
    }
  };
  return {
    s,
    admin,
    org,
    other,
    manager,
    managerElsewhere,
    member,
    person,
    row,
    patch,
    blobs,
    settle,
  };
}

describe('PATCH /organisations/{id} by a manager', () => {
  it('changes the descriptive fields, answers with editableFields, and conforms to the schema', async () => {
    const w = await world();
    const reply = await w.patch(w.manager, {
      description: 'new text',
      website: 'https://ipk.example.org',
      sameAs: ['https://www.wikidata.org/wiki/Q1'],
      rorId: 'https://ror.org/02skbsp27',
      contactEmail: 'info@ipk.example.org',
      contactType: 'customer support',
    });
    expect(reply.status).toBe(200);
    conforms(w.s, reply, 'PATCH', '/organisations/{id}');
    expect(reply.body).toMatchObject({
      description: 'new text',
      rorId: '02skbsp27',
      contactEmail: 'info@ipk.example.org',
      editableFields: ['description', 'website', 'sameAs', 'rorId', 'logo', 'contact'],
    });
    // The audit columns stay with administrators.
    expect(JSON.stringify(reply.body)).not.toMatch(/createdBy|updatedBy/);
    expect((await w.row()).updated_by).toBe(w.manager.user.id);
  });

  it.each(['type', 'abbreviation', 'name'])(
    'refuses %s with 403 and the field name, mixed with allowed fields too, and writes nothing [ASVS-8.2.3]',
    async (field) => {
      const w = await world();
      const before = await w.row();
      const reply = await w.patch(w.manager, {
        description: 'would have been fine',
        [field]: field === 'type' ? 'consortium' : 'SECRETVALUE',
      });
      expect(reply.status).toBe(403);
      expect(reply.res.headers.get('content-type')).toMatch(/problem\+json/);
      const problem = reply.body as Problem;
      expect(problem.detail).toBe(
        `These fields can only be changed by an administrator: ${field}.`,
      );
      expect(JSON.stringify(problem)).not.toMatch(/SECRETVALUE|consortium/);
      expect(await w.row()).toEqual(before);
    },
  );

  it('answers 409 for a ROR id that another organisation holds and does not name that organisation', async () => {
    const w = await world();
    await makeOrganisation(w.s.kernel.pool, { abbreviation: 'SECRETORG', rorId: '03yrm5c26' });
    const reply = await w.patch(w.manager, { rorId: '03yrm5c26' });
    expect(reply.status).toBe(409);
    expect(JSON.stringify(reply.body)).not.toContain('SECRETORG');
    expect((reply.body as Problem).errors?.map((e) => e.path)).toEqual(['rorId']);
  });

  it('answers 422 for bad input from a manager as it does for an Admin, never 500', async () => {
    const w = await world();
    for (const who of [w.manager, w.admin]) {
      for (const body of [
        { sameAs: Array.from({ length: 21 }, (_, i) => `https://l${i}.example.org`) },
        { rorId: 'not-a-ror' },
        { contactEmail: 'only@example.org' },
        { website: 'javascript:alert(1)' },
        { colour: 'red' },
      ]) {
        const reply = await w.patch(who, body);
        expect(reply.status, JSON.stringify(body)).toBe(422);
      }
    }
  });

  it('is turned away for the manager of another organisation, a member, a person with no membership: 403, nothing changes [ASVS-8.2.1] [ASVS-8.2.2]', async () => {
    const w = await world();
    const before = await w.row();
    for (const who of [w.managerElsewhere, w.member, w.person]) {
      const reply = await w.patch(who, { description: 'defaced' });
      expect(reply.status).toBe(403);
      expect(reply.res.headers.get('content-type')).toMatch(/problem\+json/);
    }
    expect(await w.row()).toEqual(before);
  });

  it('answers 404 for an unknown organisation to every signed-in person and 401 to an anonymous caller', async () => {
    const w = await world();
    const absent = '018f3b7e-0000-7000-8000-000000000000';
    for (const who of [w.manager, w.person, w.admin]) {
      expect((await w.patch(who, { description: 'x' }, absent)).status).toBe(404);
    }
    expect(
      (await w.s.call('PATCH', `/organisations/${w.org.id}`, { body: { description: 'x' } }))
        .status,
    ).toBe(401);
  });
});

describe('the route alone would let the caller through', () => {
  it('refuses at the service a caller that the route accepted: the plain `read` passes, the edit does not [ASVS-8.3.1]', async () => {
    const w = await world();
    const before = await w.row();
    for (const who of [w.person, w.member, w.managerElsewhere]) {
      // The route's own permission is held: the same caller reads the organisation ...
      expect((await w.s.get(`/organisations/${w.org.id}`, as(who))).status).toBe(200);
      // ... so a 403 here is the service's, and a missing service check would be a 200.
      expect((await w.patch(who, { description: 'defaced' })).status).toBe(403);
      expect(
        (await w.s.call('PUT', `/organisations/${w.org.id}/logo`, { ...as(who), body: makePng() }))
          .status,
      ).toBe(403);
      expect((await w.s.call('DELETE', `/organisations/${w.org.id}/logo`, as(who))).status).toBe(
        403,
      );
    }
    expect(await w.row()).toEqual(before);
    expect(await w.blobs()).toBe(0);
  });
});

describe('an organisation answer never holds a user’s address', () => {
  it('names no signed-in person’s e-mail in the record, the profile, the edit answers or the members list', async () => {
    const w = await world();
    const answers = [
      await w.s.get(`/organisations/${w.org.id}`, as(w.manager)),
      await w.s.get(`/organisations/${w.org.id}/schema-org`, as(w.manager)),
      await w.patch(w.manager, { description: 'a new text' }),
      await w.s.get(`/organisations/${w.org.id}/members`, as(w.manager)),
      await w.s.get(`/organisations/${w.org.id}`, as(w.admin)),
    ];
    for (const reply of answers) expect(reply.status).toBe(200);
    const text = JSON.stringify(answers.map((reply) => reply.body));
    for (const username of ['adminy', 'manny', 'elsa', 'memmy', 'perry']) {
      expect(text).not.toContain(`${username}@example.org`);
    }
    // The organisation's own role address is there, for the readers the table names.
    expect(text).toContain('old@example.org');
  });
});

describe('POST and DELETE /organisations by a manager', () => {
  it('are 403, for their own organisation too, and change nothing [ASVS-8.2.1]', async () => {
    const w = await world();
    const before = await w.row();
    expect(
      (
        await w.s.post('/organisations', {
          ...as(w.manager),
          body: { type: 'provider', abbreviation: 'MINE', name: 'Mine' },
        })
      ).status,
    ).toBe(403);
    expect((await w.s.call('DELETE', `/organisations/${w.org.id}`, as(w.manager))).status).toBe(
      403,
    );
    expect(await w.row()).toEqual(before);
    const count = await w.s.kernel.pool.query('select count(*)::int as n from org_organisation');
    expect(count.rows).toEqual([{ n: 2 }]);
  });
});

describe('the logo routes for a manager', () => {
  it('lets a manager of the organisation upload, replace and remove the logo, and answers 403 for another organisation with no file stored [ASVS-8.2.2]', async () => {
    const w = await world();
    const put = (who: Parameters<typeof as>[0], id: string, size: number) =>
      w.s.call('PUT', `/organisations/${id}/logo`, { ...as(who), body: makePng(size) });
    const first = await put(w.manager, w.org.id, 16);
    expect(first.status).toBe(200);
    conforms(w.s, first, 'PUT', '/organisations/{id}/logo');
    expect((first.body as { logoUrl: string }).logoUrl).toMatch(/\/api\/internal\/files\//);
    const second = await put(w.manager, w.org.id, 20);
    expect(second.status).toBe(200);
    const blobsBefore = await w.blobs();
    expect((await put(w.managerElsewhere, w.org.id, 24)).status).toBe(403);
    expect((await put(w.member, w.org.id, 24)).status).toBe(403);
    expect((await put(w.person, w.org.id, 24)).status).toBe(403);
    expect(await w.blobs()).toBe(blobsBefore);
    expect(
      (await w.s.call('DELETE', `/organisations/${w.org.id}/logo`, as(w.managerElsewhere))).status,
    ).toBe(403);
    const removed = await w.s.call('DELETE', `/organisations/${w.org.id}/logo`, as(w.manager));
    expect(removed.status).toBe(200);
    conforms(w.s, removed, 'DELETE', '/organisations/{id}/logo');
    expect(removed.body).not.toHaveProperty('logoUrl');
  });

  it('answers 404 for an unknown organisation before any file is stored, and 413 above the ceiling', async () => {
    const w = await world();
    const absent = '018f3b7e-0000-7000-8000-000000000000';
    expect(
      (
        await w.s.call('PUT', `/organisations/${absent}/logo`, {
          ...as(w.manager),
          body: makePng(),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.s.call('PUT', `/organisations/${w.org.id}/logo`, {
          ...as(w.manager),
          body: new Uint8Array(8 * 1024 * 1024 + 1),
        })
      ).status,
    ).toBe(413);
    expect(await w.blobs()).toBe(0);
  });
});

describe('GET /organisations/{id}: editableFields', () => {
  it('says what the caller may write: all for an Admin, the descriptive fields for a manager, none for everybody else [ASVS-8.2.3]', async () => {
    const w = await world();
    const fields = async (who: Parameters<typeof as>[0], id = w.org.id) => {
      const reply = await w.s.get(`/organisations/${id}`, as(who));
      expect(reply.status).toBe(200);
      conforms(w.s, reply, 'GET', '/organisations/{id}');
      return (reply.body as { editableFields: string[] }).editableFields;
    };
    expect(await fields(w.admin)).toEqual([
      'type',
      'abbreviation',
      'name',
      'description',
      'website',
      'sameAs',
      'rorId',
      'logo',
      'contact',
    ]);
    expect(await fields(w.manager)).toEqual([
      'description',
      'website',
      'sameAs',
      'rorId',
      'logo',
      'contact',
    ]);
    for (const who of [w.member, w.person, w.managerElsewhere])
      expect(await fields(who)).toEqual([]);
    expect(await fields(w.managerElsewhere, w.other.id)).toHaveLength(6);
  });
});

describe('the audit trail of a manager’s edit', () => {
  const ROWS =
    "select action, user_id, outcome, source, path, body, payload from audit_event where path like '/api/internal/organisations%' or action like 'registry.organisation.%' order by occurred_at, id";

  const secrets = {
    description: 'SECRET-DESCRIPTION',
    website: 'https://secret-website.example.org',
    sameAs: ['https://secret-link.example.org'],
    contactEmail: 'secret-address@example.org',
    contactType: 'secret-type',
  };
  type Row = {
    action: string;
    user_id: string | null;
    outcome: string;
    source: string;
    path: string | null;
    body: unknown;
    payload: { by?: string; fields?: string[]; actorId?: string } | null;
  };
  const NO_SECRETS = [
    'SECRET-DESCRIPTION',
    'secret-website',
    'secret-link',
    'secret-address',
    'secret-type',
    'Renamed by the admin',
    'SECRETVALUE',
  ];

  it('names the manager, `by` and the changed fields in the entry of the edit, the denied attempt too, and holds no value', async () => {
    const w = await world();
    expect((await w.patch(w.manager, secrets)).status).toBe(200);
    expect((await w.patch(w.admin, { name: 'Renamed by the admin' })).status).toBe(200);
    // A refused attempt is in the trail as an API entry (denied) and has no event.
    expect((await w.patch(w.manager, { name: 'SECRETVALUE' })).status).toBe(403);
    await w.settle();
    const { rows } = await w.s.kernel.pool.query<Row>(ROWS);
    const api = rows.filter((r) => r.source === 'api');
    expect(api.map((r) => `${r.action} ${r.user_id} ${r.outcome}`)).toEqual([
      `api.PATCH ${w.manager.user.id} ok`,
      `api.PATCH ${w.admin.user.id} ok`,
      `api.PATCH ${w.manager.user.id} denied`,
    ]);
    expect(api.every((r) => r.path === '/api/internal/organisations/{id}' && r.body === null)).toBe(
      true,
    );
    const events = rows.filter((r) => r.source === 'event');
    expect(events.map((r) => [r.user_id, r.payload?.by])).toEqual([
      [w.manager.user.id, 'manager'],
      [w.admin.user.id, 'admin'],
    ]);
    expect([...events[0]!.payload!.fields!].sort()).toEqual(
      ['contact', 'description', 'sameAs', 'website'].sort(),
    );
    expect(events[1]!.payload!.fields).toEqual(['name']);
    for (const secret of NO_SECRETS) expect(JSON.stringify(rows), secret).not.toContain(secret);
  });

  it('keeps the event of a manager’s edit with the admin channel off (critical) and drops the Admin’s (Decision 19)', async () => {
    const w = await world();
    const saved = await w.s.get('/settings/core.audit', as(w.admin));
    await w.s.call('PUT', '/settings/core.audit', {
      ...as(w.admin),
      body: {
        version: (saved.body as { version: number }).version,
        values: { channels: { admin: false, api: true } },
      },
    });
    expect((await w.patch(w.manager, secrets)).status).toBe(200);
    expect((await w.patch(w.admin, { name: 'Renamed by the admin' })).status).toBe(200);
    await w.settle();
    const { rows } = await w.s.kernel.pool.query<Row>(ROWS);
    expect(rows.map((r) => [r.action, r.user_id, r.payload?.by])).toEqual([
      ['registry.organisation.updated@1', w.manager.user.id, 'manager'],
    ]);
    for (const secret of NO_SECRETS) expect(JSON.stringify(rows), secret).not.toContain(secret);
  });

  it('records an Admin who is also a manager as by: admin, and the Admin’s own edit as ordinary when the channel is on', async () => {
    const w = await world();
    await makeMembership(w.s.kernel.pool, {
      organisationId: w.org.id,
      userId: w.admin.user.id,
      role: 'manager',
    });
    expect((await w.patch(w.admin, { description: 'by the admin who manages' })).status).toBe(200);
    await w.settle();
    const { rows } = await w.s.kernel.pool.query<{ payload: { by: string } }>(
      "select payload from audit_event where action = 'registry.organisation.updated@1'",
    );
    expect(rows.map((r) => r.payload.by)).toEqual(['admin']);
  });
});

describe('a token edits only within its scopes', () => {
  let n = 0;
  const tokenOf = async (s: Started, owner: Parameters<typeof as>[0], scopes: string[]) => {
    const made = await s.post('/tokens', { ...as(owner), body: { name: `edit${n++}`, scopes } });
    expect(made.status).toBe(201);
    return (made.body as { token: string }).token;
  };
  const READ = 'registry.organisations.organisation.read';
  const EDIT = 'registry.organisations.organisation.edit';

  it('lets a manager’s token with the scope change the description, and refuses it without; a member’s token never edits [ASVS-8.2.1]', async () => {
    const w = await world();
    const withEdit = await tokenOf(w.s, w.manager, [READ, EDIT]);
    const readOnly = await tokenOf(w.s, w.manager, [READ]);
    const memberToken = await tokenOf(w.s, w.member, [READ, EDIT]);
    const call = (token: string, body: unknown) =>
      w.s.call('PATCH', `/organisations/${w.org.id}`, { headers: bearer(token), body });
    expect((await call(readOnly, { description: 'a' })).status).toBe(403);
    expect((await call(memberToken, { description: 'b' })).status).toBe(403);
    expect((await call(withEdit, { name: 'c' })).status).toBe(403);
    expect((await w.row()).description).toBe('old');
    expect((await call(withEdit, { description: 'by token' })).status).toBe(200);
    expect((await w.row()).description).toBe('by token');
  });
});
