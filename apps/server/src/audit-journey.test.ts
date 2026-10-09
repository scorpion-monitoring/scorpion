// M4 acceptance, the `full` journey from the plan (sprint 4, item 10), through the real pipeline, real
// workers and a real relay: register, approve with a role, change the permissions of a role and a
// setting, observe the trail, export it, run retention, find the welcome and administrator mails in
// Mailpit, then break the relay and watch the retries.
import { makeAuditEvent, startMailpit, type StartedMailpit } from '@scorpion/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
let mailpit: StartedMailpit;
beforeAll(async () => {
  mailpit = await startMailpit();
}, 120_000);
afterAll(async () => {
  await mailpit?.stop();
});

const session = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
type Envelope = { metadata: { totalCount: number }; result: Record<string, unknown>[] };
const DAY = 24 * 60 * 60 * 1000;

describe('the full journey of M4', () => {
  it('registers, approves, changes a role and a setting, shows the trail, exports it, retains, and survives a broken relay', async () => {
    await mailpit.clear();
    const s = await app.start({
      tokenCacheTtlMs: 0,
      startWorkers: true,
      jobs: { pollingIntervalSeconds: 1 },
      notifications: { listen: true },
      branding: { instanceName: 'Atlas Registry', mailFrom: 'registry@atlas.example' },
      notificationSettings: {
        emailTransport: 'smtp',
        smtp: { host: mailpit.smtpHost, port: mailpit.smtpPort, tls: 'none', timeoutSeconds: 5 },
      },
    });
    const root = await s.signedIn('root', { email: 'admin@example.org', roles: ['admin'] });
    const rootActor = {
      kind: 'user' as const,
      userId: root.user.id,
      username: 'root',
      roles: [],
      via: 'session' as const,
    };
    const trail = async (query: string) =>
      (await s.get(`/audit?${query}`, session(root))).body as Envelope;
    const waitForTrail = (action: string, count = 1) =>
      expect
        .poll(
          async () => (await trail(`action=${encodeURIComponent(action)}`)).metadata.totalCount,
          {
            timeout: 20_000,
          },
        )
        .toBeGreaterThanOrEqual(count);

    // 1. Register: the welcome mail and the administrator mail arrive in Mailpit.
    const registered = await s.post('/auth/register', {
      body: { username: 'alice', email: 'alice@example.org', password: PASSWORD },
    });
    expect(registered.status).toBe(202);
    const received = await mailpit.waitForMessages(3);
    expect(received.map((m) => m.to[0]).sort()).toEqual([
      'admin@example.org',
      'alice@example.org',
      'alice@example.org',
    ]);
    expect(received.map((m) => m.subject)).toContain('Registration request from alice');
    const alice = (await s.identity.users.findByUsername('alice'))!;

    // 2. Approve with a role.
    const approved = await s.call('POST', `/users/${alice.id}/approve`, {
      ...session(root),
      body: { role: 'reviewer' },
    });
    expect(approved.status).toBe(200);

    // 3. Change what a role holds (a service call: there is no route for it yet) and a setting.
    const authz = s.kernel.services.get('core.authz') as {
      setRolePermissions(
        actor: typeof rootActor,
        role: string,
        permissions: string[],
      ): Promise<unknown>;
    };
    await authz.setRolePermissions(rootActor, 'reviewer', [
      'core.identity.me.read',
      'core.audit.read',
    ]);
    const current = (await s.get('/settings/core.notifications', session(root))).body as {
      version: number;
      values: Record<string, unknown>;
    };
    const changed = await s.call('PUT', '/settings/core.notifications', {
      ...session(root),
      body: { version: current.version, values: { ...current.values, maxAttempts: 4 } },
    });
    expect(changed.status).toBe(200);

    // 4. The trail shows each with the administrator as the actor, event rows and request rows.
    for (const action of [
      'identity.user.approved@1',
      'authz.role.assigned@1',
      'authz.role.permissions.changed@1',
      'settings.changed@1',
    ]) {
      await waitForTrail(action);
    }
    const events = await trail(`user=${root.user.id}&source=event&pageSize=100`);
    const byAction = new Map(events.result.map((r) => [r.action as string, r]));
    expect(byAction.get('identity.user.approved@1')).toMatchObject({
      userId: root.user.id,
      subjectId: alice.id,
      payload: { role: 'reviewer' },
    });
    expect(byAction.get('authz.role.permissions.changed@1')).toMatchObject({
      subjectId: 'reviewer',
      payload: {
        added: ['core.audit.read', 'core.identity.me.read'],
        // The default grant of registry.organisations (the test profile has it) is not in the list.
        removed: ['registry.organisations.organisation.read'],
      },
    });
    expect(byAction.get('settings.changed@1')).toMatchObject({
      subjectId: 'core.notifications',
      payload: { keys: expect.arrayContaining(['maxAttempts']) as unknown },
    });
    const requests = await trail(`user=${root.user.id}&source=api&method=POST&pageSize=100`);
    expect(requests.result.map((r) => r.path)).toContain('/api/internal/users/{id}/approve');

    // 5. Export it.
    const exported = await s.get('/audit/export.csv', session(root));
    expect(exported.status).toBe(200);
    const csv = exported.bytes.toString('utf8');
    expect(csv).toContain('identity.user.approved@1');
    expect(csv).toContain('settings.changed@1');
    expect(csv.trimEnd().split('\r\n').length).toBeGreaterThan(5);
    await waitForTrail('audit.exported');

    // 6. Retention: an old row goes, the new ones stay, an old address is cut.
    const ancient = await makeAuditEvent(s.kernel.pool, {
      source: 'event',
      occurredAt: new Date(Date.now() - 400 * DAY),
    });
    const stale = await makeAuditEvent(s.kernel.pool, {
      source: 'api',
      occurredAt: new Date(Date.now() - 45 * DAY),
      ip: '203.0.113.99',
    });
    const report = await s.audit!.retention.run();
    expect(report).toMatchObject({ deletedEvents: 1, deletedApi: 0, ipTruncated: 1 });
    expect((await trail('source=event&pageSize=100')).result.map((r) => r.id)).not.toContain(
      ancient.id,
    );
    expect((await trail('action=identity.user.approved@1')).metadata.totalCount).toBe(1);
    expect((await s.get(`/audit/${ancient.id}`, session(root))).status).toBe(404);
    expect((await s.get(`/audit/${stale.id}`, session(root))).body).toMatchObject({
      ip: '203.0.113.0/24',
    });

    // 7. Break the relay through the settings (as an administrator would) and register again: the mails
    // stay queued and are retried, the failure shows in the notification status, and the change is on the record.
    const next = (await s.get('/settings/core.notifications', session(root)))
      .body as typeof current;
    const broken = await s.call('PUT', '/settings/core.notifications', {
      ...session(root),
      body: {
        version: next.version,
        values: {
          ...next.values,
          smtp: { host: '127.0.0.1', port: 1, tls: 'none', timeoutSeconds: 1 },
        },
      },
    });
    expect(broken.status).toBe(200);
    await mailpit.clear();
    await s.post('/auth/register', {
      body: { username: 'bobby', email: 'bobby@example.org', password: PASSWORD },
    });
    await expect
      .poll(
        async () =>
          (
            await s.kernel.pool.query<{ attempts: number; status: string; last_error: string }>(
              "select attempts, status, last_error from notify_delivery where recipient_address = 'bobby@example.org'",
            )
          ).rows,
        { timeout: 30_000 },
      )
      .toEqual(
        expect.arrayContaining([expect.objectContaining({ status: 'queued', attempts: 1 })]),
      );
    const status = (await s.get('/notifications/status', session(root))).body as {
      counts: { queued: number };
      lastErrors: { code: string }[];
    };
    expect(status.counts.queued).toBeGreaterThan(0);
    expect(status.lastErrors.length).toBeGreaterThan(0);
    await waitForTrail('settings.changed@1', 2);
  }, 120_000);
});
