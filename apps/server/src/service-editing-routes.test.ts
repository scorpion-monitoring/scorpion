// Editing a service through the whole pipeline (session, CSRF, permission, validation, error mapping, audit)
// over real Postgres, by the three groups of M7 sprint 2 (ADR-0036): the approved members of the provider edit
// everything but the slug and the provider, the managers of the provider and Admin change those too, Reviewers
// and Admin publish. `PATCH` and the icon routes carry the plain `…service.read` (ADR-0034), so the service is
// what refuses; every refusal here that is not a 401 or a pipeline 403 is the service's. The service rules are
// in modules/registry-services/service/editing.test.ts, the denied cases of every route in
// defect-01.privilege-escalation.test.ts.
import { makeMembership, makeOrganisation, makePng, makeService } from '@scorpion/testing';
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
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';

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
  const provider = await makeOrganisation(pool, { type: 'provider', abbreviation: 'IPK' });
  const other = await makeOrganisation(pool, { type: 'provider', abbreviation: 'DKFZ' });
  const consortium = await makeOrganisation(pool, { type: 'consortium', abbreviation: 'DENBI' });
  const svc = await makeService(pool, {
    provider: provider.id,
    consortia: [consortium.id],
    description: 'old',
    contactEmail: 'team@example.org',
    contactType: 'support',
  });
  const people = {
    admin: await s.signedIn('adminy', { roles: ['admin'] }),
    reviewer: await s.signedIn('rita', { roles: ['reviewer'] }),
    manager: await s.signedIn('manny'),
    member: await s.signedIn('memmy'),
    managerElsewhere: await s.signedIn('elsa'),
    plain: await s.signedIn('perry'),
  };
  const join = (who: { user: { id: string } }, organisationId: string, role = 'member') =>
    makeMembership(pool, { organisationId, userId: who.user.id, role: role as 'member' });
  await join(people.manager, provider.id, 'manager');
  await join(people.member, provider.id);
  await join(people.managerElsewhere, other.id, 'manager');
  const row = async (id = svc.id) =>
    (await pool.query('select * from svc_service where id = $1', [id])).rows[0] as Record<
      string,
      unknown
    >;
  const patch = (who: Parameters<typeof as>[0], body: unknown, id = svc.id) =>
    s.call('PATCH', `/services/${id}`, { ...as(who), body });
  const blobs = async () =>
    (await pool.query<{ n: number }>('select count(*)::int as n from blob_blob')).rows[0]!.n;
  const settle = async () => {
    while ((await s.kernel.dispatcher.dispatchOnce()) > 0) {
      // run until the outbox is quiet
    }
  };
  return { s, pool, provider, other, consortium, svc, people, join, row, patch, blobs, settle };
}

describe('PATCH /services/{id}: the three groups', () => {
  it('lets a member change the descriptive fields and the consortia, answers with the record, and conforms to the schema', async () => {
    const w = await world();
    const reply = await w.patch(w.people.member, {
      name: 'Renamed',
      description: 'new text',
      url: 'https://example.org/tool',
      license: 'MIT',
      contact: { email: 'new@example.org', type: 'support' },
      consortia: [],
    });
    expect(reply.status).toBe(200);
    conforms(w.s, reply, 'PATCH', '/services/{id}');
    const body = reply.body as {
      description: string;
      editableFields: string[];
      allowedActions: string[];
      organisations: unknown[];
    };
    expect(body).toMatchObject({ description: 'new text', allowedActions: ['edit'] });
    expect(body.editableFields).not.toContain('slug');
    expect(body.editableFields).toContain('consortia');
    expect(body.organisations).toHaveLength(1);
    expect(await w.row()).toMatchObject({
      name: 'Renamed',
      license: 'MIT',
      contact_email: 'new@example.org',
    });
  });

  it('refuses a member the slug and the provider whole, with a problem that names fields and never values [ASVS-8.2.3]', async () => {
    const w = await world();
    const before = await w.row();
    for (const body of [
      { slug: 'stolen' },
      { provider: w.other.id },
      { description: 'fine', slug: 'stolen' },
    ]) {
      const reply = await w.patch(w.people.member, body);
      expect(reply.status).toBe(403);
      expect(reply.res.headers.get('content-type')).toContain('application/problem+json');
      const problem = reply.body as Problem;
      expect(problem.detail).toMatch(/slug|provider/);
      expect(JSON.stringify(problem)).not.toContain('stolen');
      expect(JSON.stringify(problem)).not.toContain(w.other.id);
    }
    expect(await w.row()).toEqual(before);
  });

  it('lets a manager rename, with the old address still resolving, and move to an organisation they manage only', async () => {
    const w = await world();
    const renamed = await w.patch(w.people.manager, { slug: 'new-address' });
    expect(renamed.status).toBe(200);
    expect((renamed.body as { slug: string }).slug).toBe('new-address');
    const viaOld = await w.s.get(`/services/by-slug/${w.svc.slug}`, as(w.people.plain));
    expect(viaOld.status).toBe(200);
    expect(viaOld.body).toMatchObject({
      id: w.svc.id,
      slug: 'new-address',
      redirectedFrom: w.svc.slug,
    });
    expect((await w.patch(w.people.manager, { provider: w.other.id })).status).toBe(403);
    await w.join(w.people.manager, w.other.id, 'manager');
    expect((await w.patch(w.people.manager, { provider: w.other.id })).status).toBe(200);
  });

  it('answers 409 for a taken slug, an old slug and the slug of another service, naming the field only', async () => {
    const w = await world();
    const rival = await makeService(w.pool, { provider: w.other.id, slug: 'rival' });
    await w.patch(w.people.admin, { slug: 'moved-on' });
    // An old slug of this service and the current slug of another, in any case.
    for (const [slug, id] of [
      [w.svc.slug, rival.id],
      ['rival', w.svc.id],
      ['RIVAL', w.svc.id],
    ] as const) {
      const reply = await w.patch(w.people.admin, { slug }, id);
      expect(reply.status, slug).toBe(409);
      const problem = reply.body as Problem;
      expect(problem.type).toContain('slug-taken');
      expect(problem.errors).toEqual([
        { in: 'body', path: 'slug', message: 'This slug is already taken.' },
      ]);
    }
  });

  it('answers 422 for bad input, 403 before 422 for a caller who may not edit, 404 for an unknown id', async () => {
    const w = await world();
    expect((await w.patch(w.people.member, { url: 'javascript:alert(1)' })).status).toBe(422);
    expect((await w.patch(w.people.member, {})).status).toBe(422);
    expect((await w.patch(w.people.member, { unknown: 1 })).status).toBe(422);
    expect((await w.patch(w.people.admin, { provider: ABSENT })).status).toBe(422);
    expect((await w.patch(w.people.plain, { url: 'javascript:alert(1)' })).status).toBe(403);
    expect((await w.patch(w.people.plain, { description: 'x' }, ABSENT)).status).toBe(404);
    expect((await w.patch(w.people.member, { description: 'x' }, 'not-a-uuid')).status).toBe(422);
  });

  it('is turned away for everybody who may not edit: 403, nothing changes [ASVS-8.2.1] [ASVS-8.2.2]', async () => {
    const w = await world();
    const before = await w.row();
    for (const who of ['plain', 'reviewer', 'managerElsewhere'] as const) {
      expect((await w.patch(w.people[who], { description: 'defaced' })).status, who).toBe(403);
    }
    expect(
      (await w.s.call('PATCH', `/services/${w.svc.id}`, { body: { description: 'x' } })).status,
    ).toBe(401);
    expect(await w.row()).toEqual(before);
  });
});

describe('the route alone would let the caller through', () => {
  it('refuses at the service a caller that the route accepted: the plain `read` passes, the edit does not [ASVS-8.3.1]', async () => {
    const w = await world();
    for (const who of ['plain', 'reviewer', 'managerElsewhere'] as const) {
      // The same person reads the service (200) and is refused every write (403).
      expect((await w.s.get(`/services/${w.svc.id}`, as(w.people[who]))).status, who).toBe(200);
      expect((await w.patch(w.people[who], { description: 'x' })).status, who).toBe(403);
      expect(
        (await w.s.call('DELETE', `/services/${w.svc.id}/icon`, as(w.people[who]))).status,
        who,
      ).toBe(403);
      expect(
        (
          await w.s.call('PUT', `/services/${w.svc.id}/icon`, {
            ...as(w.people[who]),
            body: makePng(),
          })
        ).status,
        who,
      ).toBe(403);
    }
    expect(await w.blobs()).toBe(0);
  });

  it('refuses a member the slug through the service though the route let them through [ASVS-8.3.1]', async () => {
    const w = await world();
    expect((await w.patch(w.people.member, { name: 'ok' })).status).toBe(200);
    expect((await w.patch(w.people.member, { slug: 'nope' })).status).toBe(403);
  });
});

describe('GET /services/{id}: editableFields and allowedActions', () => {
  it('says what the caller may write and do: all for Admin and a manager, the descriptive fields for a member, none for the rest [ASVS-8.2.3]', async () => {
    const w = await world();
    const of = async (who: keyof typeof w.people) => {
      const reply = await w.s.get(`/services/${w.svc.id}`, as(w.people[who]));
      expect(reply.status).toBe(200);
      const { editableFields, allowedActions } = reply.body as {
        editableFields: string[];
        allowedActions: string[];
      };
      return { editableFields, allowedActions };
    };
    const admin = await of('admin');
    expect(admin.allowedActions).toEqual(['edit', 'publish']);
    expect(admin.editableFields).toEqual(expect.arrayContaining(['slug', 'provider', 'name']));
    expect((await of('manager')).editableFields).toEqual(admin.editableFields);
    const member = await of('member');
    expect(member.editableFields).not.toContain('slug');
    expect(member.editableFields).not.toContain('provider');
    expect(member.editableFields).toContain('consortia');
    expect(await of('reviewer')).toEqual({ editableFields: [], allowedActions: ['publish'] });
    expect(await of('plain')).toEqual({ editableFields: [], allowedActions: [] });
    expect(await of('managerElsewhere')).toEqual({ editableFields: [], allowedActions: [] });
  });

  it('shows the contact point to Admin and the provider’s people always, and to others while the setting is on', async () => {
    const w = await world();
    const email = async (who: keyof typeof w.people) =>
      (await w.s.get(`/services/${w.svc.id}`, as(w.people[who]))).body as { contactEmail?: string };
    for (const who of ['admin', 'manager', 'member', 'plain', 'reviewer'] as const) {
      expect((await email(who)).contactEmail, who).toBe('team@example.org');
    }
    const saved = await w.s.get('/settings/registry.services', as(w.people.admin));
    const put = await w.s.call('PUT', '/settings/registry.services', {
      ...as(w.people.admin),
      body: {
        version: (saved.body as { version: number }).version,
        values: { exposeContactPoint: false, allowPublic: true },
      },
    });
    expect(put.status).toBe(200);
    for (const who of ['admin', 'manager', 'member'] as const) {
      expect((await email(who)).contactEmail, who).toBe('team@example.org');
    }
    for (const who of ['plain', 'reviewer', 'managerElsewhere'] as const) {
      expect(await email(who), who).not.toHaveProperty('contactEmail');
    }
    const list = await w.s.get('/services', as(w.people.member));
    expect(JSON.stringify(list.body)).not.toContain('team@example.org');
  });
});

describe('the icon routes', () => {
  it('lets a member upload, replace and remove the icon, and answers 403 for another provider’s people with no file stored [ASVS-8.2.2]', async () => {
    const w = await world();
    const put = (who: Parameters<typeof as>[0], id: string, size: number) =>
      w.s.call('PUT', `/services/${id}/icon`, { ...as(who), body: makePng(size) });
    const first = await put(w.people.member, w.svc.id, 16);
    expect(first.status).toBe(200);
    conforms(w.s, first, 'PUT', '/services/{id}/icon');
    expect((first.body as { iconUrl: string }).iconUrl).toMatch(/\/api\/internal\/files\//);
    expect((await put(w.people.manager, w.svc.id, 20)).status).toBe(200);
    const blobsBefore = await w.blobs();
    expect((await put(w.people.managerElsewhere, w.svc.id, 24)).status).toBe(403);
    expect((await put(w.people.plain, w.svc.id, 24)).status).toBe(403);
    expect((await put(w.people.reviewer, w.svc.id, 24)).status).toBe(403);
    expect(await w.blobs()).toBe(blobsBefore);
    expect(
      (await w.s.call('DELETE', `/services/${w.svc.id}/icon`, as(w.people.managerElsewhere)))
        .status,
    ).toBe(403);
    const removed = await w.s.call('DELETE', `/services/${w.svc.id}/icon`, as(w.people.member));
    expect(removed.status).toBe(200);
    conforms(w.s, removed, 'DELETE', '/services/{id}/icon');
    expect(removed.body).not.toHaveProperty('iconUrl');
  });

  it('answers 404 for an unknown service before any file is stored, 413 above the ceiling and 422 for no image', async () => {
    const w = await world();
    expect(
      (
        await w.s.call('PUT', `/services/${ABSENT}/icon`, {
          ...as(w.people.member),
          body: makePng(),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await w.s.call('PUT', `/services/${w.svc.id}/icon`, {
          ...as(w.people.member),
          body: new Uint8Array(8 * 1024 * 1024 + 1),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await w.s.call('PUT', `/services/${w.svc.id}/icon`, {
          ...as(w.people.member),
          body: 'not an image',
        })
      ).status,
    ).toBe(422);
    expect(await w.blobs()).toBe(0);
  });
});

describe('PUT /services/{id}/publication', () => {
  const put = (
    w: Awaited<ReturnType<typeof world>>,
    who: Parameters<typeof as>[0],
    value: boolean,
    id = w.svc.id,
  ) => w.s.call('PUT', `/services/${id}/publication`, { ...as(who), body: { public: value } });

  it('lets a Reviewer and Admin publish and unpublish, and conforms to the schema', async () => {
    const w = await world();
    const published = await put(w, w.people.reviewer, true);
    expect(published.status).toBe(200);
    conforms(w.s, published, 'PUT', '/services/{id}/publication');
    expect(published.body).toMatchObject({ public: true, allowedActions: ['unpublish'] });
    expect((await put(w, w.people.admin, false)).body).toMatchObject({ public: false });
    expect((await put(w, w.people.admin, false)).status).toBe(200); // a no-op
  });

  it('refuses a manager, a member and a plain User at the route (403) and shows `public` in the record to a member', async () => {
    const w = await world();
    for (const who of ['manager', 'member', 'plain', 'managerElsewhere'] as const) {
      expect((await put(w, w.people[who], true)).status, who).toBe(403);
    }
    expect((await w.row()).public).toBe(false);
    expect(
      (await w.s.call('PUT', `/services/${w.svc.id}/publication`, { body: { public: true } }))
        .status,
    ).toBe(401);
    await put(w, w.people.reviewer, true);
    expect(
      ((await w.s.get(`/services/${w.svc.id}`, as(w.people.member))).body as { public: boolean })
        .public,
    ).toBe(true);
  });

  it('answers 422 for a body that is not exactly { public: boolean }, 404 for an unknown service', async () => {
    const w = await world();
    for (const body of [{}, { public: 'yes' }, { public: true, extra: 1 }]) {
      expect(
        (
          await w.s.call('PUT', `/services/${w.svc.id}/publication`, {
            ...as(w.people.admin),
            body,
          })
        ).status,
      ).toBe(422);
    }
    expect((await put(w, w.people.admin, true, ABSENT)).status).toBe(404);
  });

  it('answers 409 when public services are switched off, and lets an unpublication through', async () => {
    const w = await world();
    const pub = await makeService(w.pool, { provider: w.provider.id, public: true });
    const saved = await w.s.get('/settings/registry.services', as(w.people.admin));
    await w.s.call('PUT', '/settings/registry.services', {
      ...as(w.people.admin),
      body: {
        version: (saved.body as { version: number }).version,
        values: { exposeContactPoint: true, allowPublic: false },
      },
    });
    expect((await put(w, w.people.admin, true)).status).toBe(409);
    expect((await put(w, w.people.admin, false, pub.id)).status).toBe(200);
  });
});

describe('POST /services by the provider’s people', () => {
  it('lets a member create a service for their provider (201) and refuses another provider (403) and a bad body (422)', async () => {
    const w = await world();
    const post = (who: Parameters<typeof as>[0], body: unknown) =>
      w.s.call('POST', '/services', { ...as(who), body });
    const created = await post(w.people.member, {
      slug: 'member-made',
      name: 'Member made',
      provider: w.provider.id,
    });
    expect(created.status).toBe(201);
    conforms(w.s, created, 'POST', '/services');
    expect(created.body).toMatchObject({ slug: 'member-made', allowedActions: ['edit'] });
    expect(
      (await post(w.people.member, { slug: 'x-made', name: 'X', provider: w.other.id })).status,
    ).toBe(403);
    expect(
      (await post(w.people.plain, { slug: 'y-made', name: 'Y', provider: w.provider.id })).status,
    ).toBe(403);
    expect(
      (await post(w.people.member, { slug: 'bad slug', name: 'Z', provider: w.provider.id }))
        .status,
    ).toBe(422);
    expect(
      (await post(w.people.member, { slug: 'member-made', name: 'Dup', provider: w.provider.id }))
        .status,
    ).toBe(409);
  });
});

describe('the audit trail of the edits', () => {
  const ROWS =
    "select action, user_id, outcome, source, path, body, payload from audit_event where path like '/api/internal/services%' or action like 'registry.service.%' order by occurred_at, id";
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
    'secret-address',
    'secret-slug',
    'SECRETVALUE',
  ];

  it('names the actor, `by` and the changed fields in the entry of each edit, the denied attempt too, and holds no value', async () => {
    const w = await world();
    expect(
      (
        await w.patch(w.people.member, {
          description: 'SECRET-DESCRIPTION',
          url: 'https://secret-website.example.org',
          contact: { email: 'secret-address@example.org', type: 'support' },
        })
      ).status,
    ).toBe(200);
    expect((await w.patch(w.people.manager, { slug: 'secret-slug' })).status).toBe(200);
    expect((await w.patch(w.people.admin, { stage: 'DEMO' })).status).toBe(200);
    expect((await w.patch(w.people.member, { slug: 'SECRETVALUE' })).status).toBe(403);
    await w.settle();
    const { rows } = await w.s.kernel.pool.query<Row>(ROWS);
    const api = rows.filter((r) => r.source === 'api');
    expect(api.map((r) => `${r.action} ${r.user_id} ${r.outcome}`)).toEqual([
      `api.PATCH ${w.people.member.user.id} ok`,
      `api.PATCH ${w.people.manager.user.id} ok`,
      `api.PATCH ${w.people.admin.user.id} ok`,
      `api.PATCH ${w.people.member.user.id} denied`,
    ]);
    expect(api.every((r) => r.path === '/api/internal/services/{id}' && r.body === null)).toBe(
      true,
    );
    const events = rows.filter((r) => r.source === 'event');
    // The updated and slugChanged events of one request are stored together; their order is not meaningful.
    const named = events.map((r) => `${r.action} ${r.user_id} ${r.payload?.by ?? '-'}`).sort();
    expect(named).toEqual(
      [
        `registry.service.updated@1 ${w.people.member.user.id} member`,
        `registry.service.updated@1 ${w.people.manager.user.id} manager`,
        `registry.service.slugChanged@1 ${w.people.manager.user.id} -`,
        `registry.service.updated@1 ${w.people.admin.user.id} admin`,
      ].sort(),
    );
    const fieldsOf = (by: string) =>
      events.find((r) => r.action === 'registry.service.updated@1' && r.payload?.by === by)!
        .payload!.fields!;
    // The contact type was `support` already: only the fields whose value changed are named.
    expect([...fieldsOf('member')].sort()).toEqual(['contactEmail', 'description', 'url']);
    expect(fieldsOf('manager')).toEqual(['slug']);
    expect(fieldsOf('admin')).toEqual(['stage']);
    for (const secret of NO_SECRETS) expect(JSON.stringify(rows), secret).not.toContain(secret);
  });

  it('keeps a new slug, a publication and an unpublication with the admin channel off (critical) and drops the ordinary edits', async () => {
    const w = await world();
    const saved = await w.s.get('/settings/core.audit', as(w.people.admin));
    await w.s.call('PUT', '/settings/core.audit', {
      ...as(w.people.admin),
      body: {
        version: (saved.body as { version: number }).version,
        values: { channels: { admin: false, api: true } },
      },
    });
    await w.patch(w.people.member, { description: 'quiet' });
    await w.patch(w.people.manager, { slug: 'loud-rename' });
    await w.s.call('PUT', `/services/${w.svc.id}/publication`, {
      ...as(w.people.reviewer),
      body: { public: true },
    });
    await w.s.call('PUT', `/services/${w.svc.id}/publication`, {
      ...as(w.people.admin),
      body: { public: false },
    });
    await w.settle();
    const { rows } = await w.s.kernel.pool.query<Row>(ROWS);
    expect(rows.filter((r) => r.source === 'event').map((r) => [r.action, r.user_id])).toEqual([
      ['registry.service.slugChanged@1', w.people.manager.user.id],
      ['registry.service.published@1', w.people.reviewer.user.id],
      ['registry.service.unpublished@1', w.people.admin.user.id],
    ]);
  });
});

describe('a token edits only within its scopes', () => {
  let n = 0;
  const tokenOf = async (s: Started, owner: Parameters<typeof as>[0], scopes: string[]) => {
    const made = await s.post('/tokens', { ...as(owner), body: { name: `svc${n++}`, scopes } });
    expect(made.status).toBe(201);
    return (made.body as { token: string }).token;
  };
  const READ = 'registry.services.service.read';
  const EDIT = 'registry.services.service.edit';
  const IDENTITY = 'registry.services.service.edit-identity';
  const PUBLISH = 'registry.services.service.publish';

  it('lets a member’s token with the scope edit, refuses it without, and never gives a member the identity [ASVS-8.2.1]', async () => {
    const w = await world();
    const call = (token: string, body: unknown) =>
      w.s.call('PATCH', `/services/${w.svc.id}`, { headers: bearer(token), body });
    const withEdit = await tokenOf(w.s, w.people.member, [READ, EDIT]);
    const readOnly = await tokenOf(w.s, w.people.member, [READ]);
    const memberAll = await tokenOf(w.s, w.people.member, [READ, EDIT, IDENTITY]);
    expect((await call(readOnly, { description: 'a' })).status).toBe(403);
    expect((await call(memberAll, { slug: 'b' })).status).toBe(403);
    expect((await call(withEdit, { slug: 'c' })).status).toBe(403);
    expect((await w.row()).description).toBe('old');
    expect((await call(withEdit, { description: 'by token' })).status).toBe(200);
    // A manager's token needs both scopes to change the slug and a description at once.
    const managerEdit = await tokenOf(w.s, w.people.manager, [READ, EDIT]);
    const managerBoth = await tokenOf(w.s, w.people.manager, [READ, EDIT, IDENTITY]);
    expect((await call(managerEdit, { slug: 'd' })).status).toBe(403);
    expect((await call(managerBoth, { slug: 'e', description: 'f' })).status).toBe(200);
  });

  it('lets only a token that names publish switch publication, and a manager’s never', async () => {
    const w = await world();
    // A Reviewer who may also make tokens (the role `user`).
    const rita = await w.s.signedIn('ritatoken', { roles: ['user', 'reviewer'] });
    const call = (token: string) =>
      w.s.call('PUT', `/services/${w.svc.id}/publication`, {
        headers: bearer(token),
        body: { public: true },
      });
    expect((await call(await tokenOf(w.s, rita, [READ]))).status).toBe(403);
    expect((await call(await tokenOf(w.s, w.people.manager, [READ, PUBLISH]))).status).toBe(403);
    expect((await call(await tokenOf(w.s, rita, [READ, PUBLISH]))).status).toBe(200);
  });
});
