// The notification routes of M4 sprint 3 through the whole pipeline, on real Postgres and the real
// core.identity: the caller's own inbox, the category list and the preference that uses it, and the
// administrator's status, delivery list, requeue and test mail. Also the acceptance row of the plan:
// a relay that is down shows as `dead` with its error code and no body.
import { makeInboxItem, tablesContaining } from '@scorpion/testing';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PASSWORD, useIdentityApp, type Reply } from './testing/identity-app.ts';

const app = useIdentityApp();
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const session = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
const problem = (reply: Reply) => reply.res.headers.get('content-type') ?? '';
type Envelope = {
  metadata: { currentPage: number; pageSize: number; totalCount: number; totalPages: number };
  result: Record<string, unknown>[];
};

/** A relay that refuses connections and one attempt only: the first failure is the last. */
const RELAY_DOWN = {
  emailTransport: 'smtp',
  smtp: { host: '127.0.0.1', port: 1, tls: 'none', timeoutSeconds: 1 },
  maxAttempts: 1,
};

/** Keys a delivery view must never have, and values that must never appear in any response about deliveries. */
const FORBIDDEN_KEYS = [
  'body',
  'text',
  'textBody',
  'html',
  'htmlBody',
  'text_body',
  'html_body',
  'address',
  'recipientAddress',
  'recipient_address',
  'to',
  'email',
  'subject',
  'url',
  'link',
  'token',
];
function keysOf(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, found));
  else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      found.add(key);
      keysOf(inner, found);
    }
  }
  return found;
}

describe('the inbox', () => {
  it('serves only the caller’s own items, newest first, in the standard envelope with 0-based pages', async () => {
    const s = await app.start();
    const alice = await s.signedIn('alice');
    const bob = await s.signedIn('bob');
    for (let i = 0; i < 5; i++) {
      await makeInboxItem(s.kernel.pool, {
        userId: alice.user.id,
        title: `A${i}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 10, i)),
      });
    }
    await makeInboxItem(s.kernel.pool, { userId: bob.user.id, title: 'B' });

    const first = await s.get('/notifications/inbox?pageSize=2', session(alice));
    expect(first.status).toBe(200);
    const body = first.body as Envelope;
    expect(body.metadata).toEqual({ currentPage: 0, pageSize: 2, totalCount: 5, totalPages: 3 });
    expect(body.result.map((i) => i.title)).toEqual(['A4', 'A3']);
    expect(Object.keys(body.result[0]!).sort()).toEqual(
      ['createdAt', 'id', 'link', 'readAt', 'template', 'text', 'title'].sort(),
    );
    const last = (await s.get('/notifications/inbox?pageSize=2&page=2', session(alice)))
      .body as Envelope;
    expect(last.result.map((i) => i.title)).toEqual(['A0']);
    expect(
      ((await s.get('/notifications/inbox', session(bob))).body as Envelope).result.map(
        (i) => i.title,
      ),
    ).toEqual(['B']);
  });

  it('counts, marks one read, marks all read and deletes', async () => {
    const s = await app.start();
    const alice = await s.signedIn('alice');
    const items = [];
    for (let i = 0; i < 3; i++) {
      items.push(await makeInboxItem(s.kernel.pool, { userId: alice.user.id }));
    }
    const count = async () =>
      ((await s.get('/notifications/inbox/unread-count', session(alice))).body as { count: number })
        .count;
    expect(await count()).toBe(3);

    const read = await s.post(`/notifications/inbox/${items[0]!.id}/read`, session(alice));
    expect(read.status).toBe(200);
    expect((read.body as { readAt: string }).readAt).toBeTruthy();
    expect(await count()).toBe(2);

    const all = await s.post('/notifications/inbox/read-all', session(alice));
    expect(all.body).toEqual({ updated: 2 });
    expect(await count()).toBe(0);

    const deleted = await s.call('DELETE', `/notifications/inbox/${items[1]!.id}`, session(alice));
    expect(deleted.status).toBe(204);
    expect(
      ((await s.get('/notifications/inbox', session(alice))).body as Envelope).metadata.totalCount,
    ).toBe(2);
  });

  it('answers 403 for another user’s item, and the same for an id that does not exist, changing nothing', async () => {
    const s = await app.start();
    const alice = await s.signedIn('alice');
    const bob = await s.signedIn('bob');
    const theirs = await makeInboxItem(s.kernel.pool, { userId: bob.user.id });
    const replies = [
      await s.post(`/notifications/inbox/${theirs.id}/read`, session(alice)),
      await s.call('DELETE', `/notifications/inbox/${theirs.id}`, session(alice)),
      await s.post(`/notifications/inbox/${randomUUID()}/read`, session(alice)),
      await s.call('DELETE', `/notifications/inbox/${randomUUID()}`, session(alice)),
    ];
    for (const reply of replies) {
      expect(reply.status).toBe(403); // not 404: no oracle for other people's items
      expect(problem(reply)).toContain('application/problem+json');
      expect(JSON.stringify(reply.body)).not.toContain(bob.user.id);
    }
    // The foreign item and the unknown one are indistinguishable.
    expect(replies[0]!.body).toMatchObject({ status: 403, title: 'Forbidden' });
    expect({ ...(replies[0]!.body as object), requestId: 0, instance: 0 }).toEqual({
      ...(replies[2]!.body as object),
      requestId: 0,
      instance: 0,
    });
    expect((await s.get('/notifications/inbox/unread-count', session(bob))).body).toEqual({
      count: 1,
    });
  });

  it('is 422 for an id that is not a UUID and for a bad page, never a 500', async () => {
    const s = await app.start();
    const alice = await s.signedIn('alice');
    expect((await s.post('/notifications/inbox/nope/read', session(alice))).status).toBe(422);
    expect((await s.call('DELETE', '/notifications/inbox/nope', session(alice))).status).toBe(422);
    for (const query of ['page=-1', 'pageSize=0', 'pageSize=101', 'page=x', 'extra=1']) {
      expect((await s.get(`/notifications/inbox?${query}`, session(alice))).status, query).toBe(
        422,
      );
    }
  });

  it('is reachable with a token that has the scope, and only that', async () => {
    const s = await app.start({ tokenCacheTtlMs: 0 });
    const alice = await s.signedIn('alice');
    await makeInboxItem(s.kernel.pool, { userId: alice.user.id, title: 'Mine' });
    const make = async (scopes: string[], name: string) =>
      (
        (await s.post('/tokens', { ...session(alice), body: { name, scopes } })).body as {
          token: string;
        }
      ).token;
    const reader = await make(['core.notifications.inbox.read'], 'reader');
    const other = await make(['core.identity.me.read'], 'other');
    const listed = await s.get('/notifications/inbox', { headers: bearer(reader) });
    expect(listed.status).toBe(200);
    expect((listed.body as Envelope).result.map((i) => i.title)).toEqual(['Mine']);
    // The scope is for reading: it does not allow marking read.
    expect(
      (await s.post('/notifications/inbox/read-all', { headers: bearer(reader) })).status,
    ).toBe(403);
    expect((await s.get('/notifications/inbox', { headers: bearer(other) })).status).toBe(403);
  });
});

describe('what a mail leaves in the inbox', () => {
  it('is an item for a category the person keeps on, and none for one they switched off', async () => {
    const s = await app.start();
    const alice = await s.signedIn('alice');
    const send = (template: string, data: unknown) =>
      s.kernel.db.tx((tx) =>
        s.notifications.enqueueTemplate(tx, {
          template,
          data,
          recipient: { address: 'alice@example.org', userId: alice.user.id },
          inApp: true,
        }),
      );
    const decided = { provider: 'Provider A', decision: 'approved' };

    expect(await send('registry.membership-decided', decided)).not.toBeNull();
    const inbox = (await s.get('/notifications/inbox', session(alice))).body as Envelope;
    expect(inbox.result).toHaveLength(1);
    expect(inbox.result[0]).toMatchObject({
      template: 'registry.membership-decided',
      title: 'You are a member of Provider A',
      readAt: null,
    });

    // Switch the category off through the preference routes of core.settings.
    const off = await s.call('PUT', '/preferences/notifications.preferences', {
      ...session(alice),
      body: { value: { membership: { email: false, inApp: false } } },
    });
    expect(off.status).toBe(200);
    const before = (await s.mail.all()).length;
    expect(await send('registry.membership-decided', decided)).toBeNull();
    expect((await s.mail.all()).length).toBe(before);
    expect(
      ((await s.get('/notifications/inbox', session(alice))).body as Envelope).result,
    ).toHaveLength(1);

    // Switch only email off: the item comes, the mail does not.
    await s.call('PUT', '/preferences/notifications.preferences', {
      ...session(alice),
      body: { value: { membership: { email: false } } },
    });
    expect(await send('registry.membership-decided', decided)).toBeNull();
    expect(
      ((await s.get('/notifications/inbox', session(alice))).body as Envelope).result,
    ).toHaveLength(2);
    expect((await s.mail.all()).length).toBe(before);
  });

  it('is never stopped for a mandatory template, and a sensitive one leaves nothing in the inbox, in any table, event or log', async () => {
    const s = await app.start();
    const alice = await s.signedIn('alice');
    await s.call('PUT', '/preferences/notifications.preferences', {
      ...session(alice),
      body: { value: { security: { email: false, inApp: false } } },
    });
    const token = `tok${randomUUID().replaceAll('-', '')}`;
    await s.kernel.db.tx((tx) =>
      s.notifications.enqueueTemplate(tx, {
        template: 'identity.password-reset',
        data: { resetUrl: `https://example.org/reset#token=${token}`, validForMinutes: 30 },
        recipient: { address: 'alice@example.org', userId: alice.user.id },
        inApp: true,
      }),
    );
    // Mandatory: the switch is ignored and the mail is queued.
    expect((await s.mail.of('identity.password-reset')).map((m) => m.to)).toEqual([
      'alice@example.org',
    ]);
    // Sensitive: no inbox item, whatever the flag says.
    expect(((await s.get('/notifications/inbox', session(alice))).body as Envelope).result).toEqual(
      [],
    );

    // The link is in the queued row only; once the mail is sent it is nowhere.
    expect(await tablesContaining(s.kernel.pool, token)).toEqual(['notify_delivery']);
    await s.notifications.deliverDue();
    expect(await tablesContaining(s.kernel.pool, token)).toEqual([]);
    expect(s.logText()).not.toContain(token);
  });

  it('lists the categories from the templates, with descriptions and what cannot be switched off', async () => {
    const s = await app.start();
    const alice = await s.signedIn('alice');
    const reply = await s.get('/notifications/preferences/categories', session(alice));
    expect(reply.status).toBe(200);
    const body = reply.body as Envelope;
    const byName = Object.fromEntries(body.result.map((c) => [c.category as string, c]));
    expect(Object.keys(byName).sort()).toEqual([
      'account',
      'administration',
      'membership',
      'onboarding',
      'reminders',
      'security',
      'system',
    ]);
    expect(body.metadata.totalCount).toBe(7);
    expect(byName.security).toMatchObject({ mandatory: true });
    expect(byName.account).toMatchObject({ mandatory: false });
    for (const category of body.result) {
      expect((category.description as { en: string; de: string }).en).toBeTruthy();
      expect((category.description as { en: string; de: string }).de).toBeTruthy();
      expect((category.templates as string[]).length).toBeGreaterThan(0);
    }
    expect(byName.security!.templates).toEqual([
      'identity.email-verification',
      'identity.oidc-link',
      'identity.password-reset',
      'identity.register-attempt',
    ]);
  });

  it('stores the preference through core.settings’ own route: a bad shape is 422, a stranger’s category is kept', async () => {
    const s = await app.start();
    const alice = await s.signedIn('alice');
    const put = (value: unknown) =>
      s.call('PUT', '/preferences/notifications.preferences', {
        ...session(alice),
        body: { value },
      });
    for (const bad of [{ account: { sms: true } }, { Account: {} }, { account: 'off' }, 'x', []]) {
      expect((await put(bad)).status, JSON.stringify(bad)).toBe(422);
    }
    expect((await put({ 'removed-module': { email: false } })).status).toBe(200);
    const list = (await s.get('/preferences', session(alice))).body as Envelope;
    expect(list.result.map((p) => p.key)).toContain('notifications.preferences');
  });
});

describe('the administrator’s view of delivery', () => {
  it('shows a relay that is down as dead, with its error code and no body', async () => {
    const s = await app.start({ notificationSettings: RELAY_DOWN });
    const admin = await s.signedIn('root', { roles: ['admin'] });
    const registered = await s.post('/auth/register', {
      body: { username: 'newcomer', email: 'newcomer@example.org', password: PASSWORD },
    });
    expect(registered.status).toBe(202);
    const queued = await s.mail.all();
    expect(queued.length).toBeGreaterThan(0);
    const secretBody = queued.find((m) => m.template === 'identity.welcome')!.text;

    const report = await s.notifications.deliverDue();
    expect(report.dead).toBe(queued.length);

    const status = await s.get('/notifications/status', session(admin));
    expect(status.status).toBe(200);
    const st = status.body as {
      counts: Record<string, number>;
      lastErrors: { code: string; count: number }[];
      emailTransport: string;
    };
    expect(st.emailTransport).toBe('smtp');
    expect(st.counts.dead).toBe(queued.length);
    expect(st.lastErrors[0]!.code).toMatch(/^[A-Za-z0-9._-]+$/);

    const list = await s.get('/notifications/deliveries?status=dead&pageSize=100', session(admin));
    expect(list.status).toBe(200);
    const deliveries = list.body as Envelope;
    expect(deliveries.metadata.totalCount).toBe(queued.length);
    for (const row of deliveries.result) {
      expect(row).toMatchObject({ status: 'dead', attempts: 1 });
      expect(row.lastError).toBe(st.lastErrors[0]!.code);
    }
    const welcome = deliveries.result.find((r) => r.template === 'identity.welcome')!;
    expect(welcome.bodyAvailable).toBe(true);
    // The sensitive verification mail lost its body when it died.
    const verification = deliveries.result.find(
      (r) => r.template === 'identity.email-verification',
    )!;
    expect(verification).toMatchObject({ sensitive: true, bodyAvailable: false });

    // No field, and no value, that is a body, address, subject or URL.
    const keys = keysOf(deliveries);
    for (const key of FORBIDDEN_KEYS) expect(keys.has(key), key).toBe(false);
    const json = JSON.stringify([status.body, deliveries]);
    for (const secret of ['newcomer@example.org', secretBody.slice(0, 30), 'http', 'Welcome to']) {
      expect(json).not.toContain(secret);
    }
    // ... nor the log, nor the events.
    const events = JSON.stringify(
      (
        await s.kernel.pool.query(
          "select payload from kernel_outbox where name like 'notifications.%'",
        )
      ).rows,
    );
    for (const secret of ['newcomer@example.org', secretBody.slice(0, 30)]) {
      expect(events).not.toContain(secret);
      expect(s.logText()).not.toContain(secret);
    }
    expect(events).toContain('deliveryId'); // the dead events exist, with ids
  });

  it('requeues a dead delivery and records the event; a scrubbed one cannot be requeued', async () => {
    const s = await app.start({ notificationSettings: RELAY_DOWN });
    const admin = await s.signedIn('root', { roles: ['admin'] });
    await s.post('/auth/register', {
      body: { username: 'newcomer', email: 'newcomer@example.org', password: PASSWORD },
    });
    await s.notifications.deliverDue();
    const rows = (
      (await s.get('/notifications/deliveries?status=dead&pageSize=100', session(admin)))
        .body as Envelope
    ).result;
    const welcome = rows.find((r) => r.template === 'identity.welcome')! as { id: string };
    const scrubbed = rows.find((r) => r.template === 'identity.email-verification')! as {
      id: string;
    };

    const requeued = await s.post(
      `/notifications/deliveries/${welcome.id}/requeue`,
      session(admin),
    );
    expect(requeued.status).toBe(200);
    expect(requeued.body).toMatchObject({ id: welcome.id, status: 'queued', attempts: 0 });
    expect(keysOf(requeued.body).has('subject')).toBe(false);
    expect(
      (
        await s.kernel.pool.query(
          "select payload from kernel_outbox where name = 'notifications.delivery.requeued@1'",
        )
      ).rows,
    ).toEqual([
      {
        payload: {
          deliveryId: welcome.id,
          template: 'identity.welcome',
          channel: 'email',
          requestedBy: admin.user.id,
        },
      },
    ]);

    // Not dead any more: 409. A scrubbed body: 409 and still dead. Unknown: 404.
    expect(
      (await s.post(`/notifications/deliveries/${welcome.id}/requeue`, session(admin))).status,
    ).toBe(409);
    const refused = await s.post(
      `/notifications/deliveries/${scrubbed.id}/requeue`,
      session(admin),
    );
    expect(refused.status).toBe(409);
    expect(problem(refused)).toContain('application/problem+json');
    expect(
      (await s.kernel.pool.query('select status from notify_delivery where id = $1', [scrubbed.id]))
        .rows,
    ).toEqual([{ status: 'dead' }]);
    expect(
      (await s.post(`/notifications/deliveries/${randomUUID()}/requeue`, session(admin))).status,
    ).toBe(404);
    expect((await s.post('/notifications/deliveries/nope/requeue', session(admin))).status).toBe(
      422,
    );
  });

  it('filters the list, and is 422 for bad filters', async () => {
    const s = await app.start();
    const admin = await s.signedIn('root', { roles: ['admin'] });
    const get = (query: string) => s.get(`/notifications/deliveries?${query}`, session(admin));
    expect((await get('status=queued&channel=email&template=identity.welcome')).status).toBe(200);
    expect(((await get('from=2999-01-01T00:00:00Z')).body as Envelope).metadata.totalCount).toBe(0);
    for (const query of [
      'status=lost',
      'channel=sms',
      'from=yesterday',
      'from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z',
      'extra=1',
      `template=${'x'.repeat(101)}`,
    ]) {
      expect((await get(query)).status, query).toBe(422);
    }
  });

  it('sends a test mail to the caller’s own address and budgets it', async () => {
    const s = await app.start();
    const admin = await s.signedIn('root', { email: 'root@example.org', roles: ['admin'] });
    const first = await s.post('/notifications/test', session(admin));
    expect(first.status).toBe(202);
    const body = first.body as { deliveryId: string; transportIsNone: boolean };
    expect(body.transportIsNone).toBe(true);
    expect(Object.keys(body).sort()).toEqual(['deliveryId', 'transportIsNone']);
    expect(JSON.stringify(first.body)).not.toContain('root@example.org');
    expect((await s.mail.of('notifications.test')).map((m) => m.to)).toEqual(['root@example.org']);
    await s.post('/notifications/test', session(admin));
    await s.post('/notifications/test', session(admin));
    const limited = await s.post('/notifications/test', session(admin));
    expect(limited.status).toBe(429);
    expect(problem(limited)).toContain('application/problem+json');
    expect((await s.mail.of('notifications.test')).length).toBe(3);
  });

  it('keeps every admin route closed to a plain User and to a token of theirs, with no trace', async () => {
    const s = await app.start({ tokenCacheTtlMs: 0 });
    const plain = await s.signedIn('plain', { email: 'plain@example.org' });
    const before = (await s.mail.all()).length;
    const requests: [string, string][] = [
      ['GET', '/notifications/status'],
      ['GET', '/notifications/deliveries'],
      ['POST', `/notifications/deliveries/${randomUUID()}/requeue`],
      ['POST', '/notifications/test'],
    ];
    const made = await s.post('/tokens', {
      ...session(plain),
      body: {
        name: 'wide',
        scopes: [
          'core.notifications.status.read',
          'core.notifications.deliveries.read',
          'core.notifications.deliveries.manage',
          'core.notifications.test',
        ],
      },
    });
    const { token } = made.body as { token: string };
    for (const [method, path] of requests) {
      expect((await s.call(method, path, session(plain))).status, `${method} ${path}`).toBe(403);
      expect(
        (await s.call(method, path, { headers: bearer(token) })).status,
        `${method} ${path} (token)`,
      ).toBe(403);
      expect((await s.call(method, path)).status, `${method} ${path} (anonymous)`).toBe(401);
    }
    expect((await s.mail.all()).length).toBe(before);
    expect(
      (await s.kernel.pool.query("select 1 from kernel_outbox where name like 'notifications.%'"))
        .rows,
    ).toEqual([]);
  });
});
