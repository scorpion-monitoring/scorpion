import { randomUUID } from 'node:crypto';
import { makeAuditEvent, makeUser } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useAudit } from '../test/harness.ts';
import { escapeLike } from './viewer.ts';

const audit = useAudit();
const MIN = 60_000;

describe('escapeLike', () => {
  it.each([
    ['/api/internal/users', '/api/internal/users'],
    ['100%', '100\\%'],
    ['a_b', 'a\\_b'],
    ['back\\slash', 'back\\\\slash'],
  ])('%s → %s', (input, expected) => expect(escapeLike(input)).toBe(expected));
});

describe('the list', () => {
  it('filters by method, user, endpoint prefix, action, outcome, source and date range', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    const tag = `/api/internal/viewer-${randomUUID().slice(0, 8)}`;
    const user = randomUUID();
    const t0 = Date.now() - 60 * MIN;
    const rows = {
      a: await makeAuditEvent(s.pool, {
        method: 'POST',
        path: `${tag}/a`,
        userId: user,
        action: 'api.POST',
        occurredAt: new Date(t0),
      }),
      b: await makeAuditEvent(s.pool, {
        method: 'GET',
        path: `${tag}/b`,
        userId: user,
        action: 'api.GET',
        outcome: 'denied',
        status: 403,
        occurredAt: new Date(t0 + 10 * MIN),
      }),
      c: await makeAuditEvent(s.pool, {
        method: 'GET',
        path: `${tag}/c`,
        userId: randomUUID(),
        action: 'api.GET',
        occurredAt: new Date(t0 + 20 * MIN),
      }),
      d: await makeAuditEvent(s.pool, {
        source: 'event',
        action: 'thing.done@1',
        userId: user,
        path: null,
        method: null,
        occurredAt: new Date(t0 + 30 * MIN),
      }),
    };
    const ids = async (filter: Record<string, unknown>) =>
      (
        await s.audit.viewer.list(admin, { endpoint: tag, ...filter }, { page: 0, pageSize: 50 })
      ).events.map((e) => e.id);

    expect(await ids({})).toEqual([rows.c.id, rows.b.id, rows.a.id]); // newest first
    expect(await ids({ method: 'POST' })).toEqual([rows.a.id]);
    expect(await ids({ user })).toEqual([rows.b.id, rows.a.id]);
    expect(await ids({ action: 'api.GET' })).toEqual([rows.c.id, rows.b.id]);
    expect(await ids({ outcome: 'denied' })).toEqual([rows.b.id]);
    expect(await ids({ endpoint: `${tag}/b` })).toEqual([rows.b.id]);
    expect(await ids({ from: new Date(t0 + 5 * MIN), to: new Date(t0 + 15 * MIN) })).toEqual([
      rows.b.id,
    ]);
    // The source filter reaches the event row, which has no path: the endpoint prefix is left out.
    const events = await s.audit.viewer.list(
      admin,
      { source: 'event', user },
      { page: 0, pageSize: 50 },
    );
    expect(events.events.map((e) => e.id)).toContain(rows.d.id);
    expect(events.events.every((e) => e.source === 'event')).toBe(true);
  });

  it('joins the username of the acting user, and leaves it empty for an account that no longer exists', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    const tag = `/api/internal/joined-${randomUUID().slice(0, 8)}`;
    const alive = await makeUser(s.pool, { username: `alive-${randomUUID().slice(0, 8)}` });
    const purged = randomUUID(); // an id the trail kept after the account row was deleted
    const keep = await makeAuditEvent(s.pool, { path: `${tag}/a`, userId: alive.id });
    const gone = await makeAuditEvent(s.pool, { path: `${tag}/b`, userId: purged });
    const nobody = await makeAuditEvent(s.pool, {
      path: `${tag}/c`,
      userId: null,
      actorKind: 'anonymous',
    });
    const { events } = await s.audit.viewer.list(
      admin,
      { endpoint: tag },
      { page: 0, pageSize: 10 },
    );
    const by = (id: string) => events.find((event) => event.id === id)!;
    expect(by(keep.id)).toMatchObject({ userId: alive.id, userName: alive.username });
    expect(by(gone.id)).toMatchObject({ userId: purged, userName: null });
    expect(by(nobody.id)).toMatchObject({ userId: null, userName: null });
    expect((await s.audit.viewer.get(admin, keep.id)).userName).toBe(alive.username);
    expect((await s.audit.viewer.get(admin, gone.id)).userName).toBeNull();
  });

  it('takes the endpoint prefix literally: % and _ match themselves', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    const tag = randomUUID().slice(0, 8);
    const literal = await makeAuditEvent(s.pool, { path: `/odd-${tag}/100%_done` });
    await makeAuditEvent(s.pool, { path: `/odd-${tag}/100xyzdone` });
    const found = await s.audit.viewer.list(
      admin,
      { endpoint: `/odd-${tag}/100%_` },
      { page: 0, pageSize: 50 },
    );
    expect(found.events.map((e) => e.id)).toEqual([literal.id]);
  });

  it('pages in the standard order: occurred_at desc, then id desc, stable across pages', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    const tag = `/api/internal/paging-${randomUUID().slice(0, 8)}`;
    const same = new Date(Date.now() - 5 * MIN);
    const made = [];
    for (let i = 0; i < 7; i += 1)
      made.push(await makeAuditEvent(s.pool, { path: `${tag}/${i}`, occurredAt: same }));
    const expected = made
      .map((m) => m.id)
      .sort()
      .reverse(); // equal times: id descending
    const pages = [];
    for (let page = 0; page < 4; page += 1) {
      const { events, total } = await s.audit.viewer.list(
        admin,
        { endpoint: tag },
        { page, pageSize: 3 },
      );
      expect(total).toBe(7);
      pages.push(...events.map((e) => e.id));
    }
    expect(pages).toEqual(expected);
  });

  it('[ASVS-V16.4.2] is denied to a plain User, to a user without roles and to an anonymous caller', async () => {
    const s = await audit.startShared();
    const plain = await s.actor('user');
    const nobody = await s.actor();
    const row = await makeAuditEvent(s.pool);
    for (const actor of [plain, nobody]) {
      await expect(s.audit.viewer.list(actor, {}, { page: 0, pageSize: 10 })).rejects.toMatchObject(
        { status: 403 },
      );
      await expect(s.audit.viewer.get(actor, row.id)).rejects.toMatchObject({ status: 403 });
    }
    await expect(
      s.audit.viewer.list({ kind: 'anonymous' }, {}, { page: 0, pageSize: 10 }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('is denied to a holder of only the export permission, and the other way round', async () => {
    const s = await audit.startShared();
    const exporter = await s.actor();
    const reader = await s.actor();
    const { makeRole, makeRoleAssignment } = await import('@scorpion/testing');
    await makeRoleAssignment(
      s.pool,
      { id: exporter.userId },
      await makeRole(s.pool, { permissions: ['core.audit.export'] }),
    );
    await makeRoleAssignment(
      s.pool,
      { id: reader.userId },
      await makeRole(s.pool, { permissions: ['core.audit.read'] }),
    );
    await expect(s.audit.viewer.list(exporter, {}, { page: 0, pageSize: 1 })).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(s.audit.viewer.exportCsv(reader, {})).rejects.toMatchObject({ status: 403 });
    expect((await s.audit.viewer.list(reader, {}, { page: 0, pageSize: 1 })).events).toHaveLength(
      1,
    );
  });
});

describe('one entry', () => {
  it('returns it, 404 for an unknown id and for text that is not an id', async () => {
    const s = await audit.startShared();
    const admin = await s.actor('admin');
    const row = await makeAuditEvent(s.pool, { body: { a: 1 }, query: { q: 'x' } });
    expect(await s.audit.viewer.get(admin, row.id)).toMatchObject({
      id: row.id,
      body: { a: 1 },
      query: { q: 'x' },
    });
    await expect(s.audit.viewer.get(admin, randomUUID())).rejects.toMatchObject({ status: 404 });
    await expect(s.audit.viewer.get(admin, "1' or '1'='1")).rejects.toMatchObject({ status: 404 });
  });
});
