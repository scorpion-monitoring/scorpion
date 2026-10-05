// The vocabulary routes and the public branding and legal routes, through the whole pipeline. The
// denied cases are in defect-01.privilege-escalation.test.ts.
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
const start = () => app.start();
type Started = Awaited<ReturnType<typeof start>>;
const as = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
const admin = (s: Started) => s.signedIn('adminy', { roles: ['admin'] });
interface Page<T> {
  metadata: Record<string, number>;
  result: T[];
}
const keys = (reply: { body: unknown }) =>
  (reply.body as Page<{ key: string }>).result.map((term) => term.key);

describe('vocabularies', () => {
  it('lists the vocabularies and the terms in order, in the list envelope, for a plain User', async () => {
    const s = await start();
    const user = await s.signedIn('plain');
    const all = await s.get('/vocabularies', as(user));
    expect((all.body as Page<{ id: string }>).result.map((v) => v.id)).toEqual([
      'aggregate',
      'necessity',
      'sender-type',
      'stage',
      'thematic-category',
    ]);
    const stages = await s.get('/vocabularies/stage/terms', as(user));
    expect(stages.status).toBe(200);
    expect(keys(stages)).toEqual(['DEV', 'DEMO', 'PROD', 'TERM']);
    expect((stages.body as Page<unknown>).metadata).toEqual({
      currentPage: 0,
      pageSize: 100,
      totalCount: 4,
      totalPages: 1,
    });
    expect((stages.body as Page<{ label: string }>).result[3]!.label).toBe('Terminated');
  });

  it('shows the label for the requested locale', async () => {
    const s = await start();
    const root = await admin(s);
    await s.call('PATCH', '/vocabularies/stage/terms/PROD', {
      ...as(root),
      body: { labels: { en: 'Production', de: 'Betrieb' } },
    });
    const de = await s.get('/vocabularies/stage/terms?locale=de-AT', as(root));
    expect(
      (de.body as Page<{ key: string; label: string }>).result.find((t) => t.key === 'PROD')!.label,
    ).toBe('Betrieb');
  });

  it('keeps deactivated terms from a User and shows them to an administrator who asks', async () => {
    const s = await start();
    const root = await admin(s);
    const user = await s.signedIn('plain');
    expect((await s.call('DELETE', '/vocabularies/stage/terms/TERM', as(root))).body).toMatchObject(
      {
        outcome: 'deactivated',
        term: { key: 'TERM', active: false },
      },
    );
    expect(keys(await s.get('/vocabularies/stage/terms', as(user)))).toEqual([
      'DEV',
      'DEMO',
      'PROD',
    ]);
    expect(await s.get('/vocabularies/stage/terms?includeInactive=true', as(user))).toMatchObject({
      status: 403,
    });
    expect(keys(await s.get('/vocabularies/stage/terms?includeInactive=true', as(root)))).toEqual([
      'DEV',
      'DEMO',
      'PROD',
      'TERM',
    ]);
  });

  it('adds, changes and deletes a term of an administrator’s own', async () => {
    const s = await start();
    const root = await admin(s);
    const created = await s.post('/vocabularies/stage/terms', {
      ...as(root),
      body: { key: 'BETA', labels: { en: 'Beta' } },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ key: 'BETA', sortOrder: 50, active: true, seeded: false });
    const patched = await s.call('PATCH', '/vocabularies/stage/terms/BETA', {
      ...as(root),
      body: { sortOrder: 5 },
    });
    expect(patched.body).toMatchObject({ sortOrder: 5 });
    expect(keys(await s.get('/vocabularies/stage/terms', as(root)))[0]).toBe('BETA');
    const removed = await s.call('DELETE', '/vocabularies/stage/terms/BETA', as(root));
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ outcome: 'deleted', term: null });
  });

  it('answers 409 for a key that exists, 404 for what does not, and 422 for bad input', async () => {
    const s = await start();
    const root = await admin(s);
    expect(
      (
        await s.post('/vocabularies/stage/terms', {
          ...as(root),
          body: { key: 'PROD', labels: { en: 'x' } },
        })
      ).status,
    ).toBe(409);
    expect((await s.get('/vocabularies/nope/terms', as(root))).status).toBe(404);
    expect(
      (
        await s.call('PATCH', '/vocabularies/stage/terms/NOPE', {
          ...as(root),
          body: { active: true },
        })
      ).status,
    ).toBe(404);
    for (const body of [
      { key: 'a b', labels: { en: 'x' } },
      { key: 'OK', labels: { de: 'x' } },
      { key: 'OK', labels: { en: 'x' }, seeded: true },
      {},
    ]) {
      const reply = await s.post('/vocabularies/stage/terms', { ...as(root), body });
      expect(reply.status, JSON.stringify(body)).toBe(422);
    }
    expect(
      (await s.call('PATCH', '/vocabularies/stage/terms/PROD', { ...as(root), body: {} })).status,
    ).toBe(422);
    expect((await s.get('/vocabularies/stage/terms?pageSize=501', as(root))).status).toBe(422);
  });
});

describe('GET /branding and GET /legal/{page}', () => {
  const save = async (s: Started, branding: Record<string, unknown>) => {
    const root = await admin(s);
    const current = await s.get('/settings/core.settings', as(root));
    const { version, values } = current.body as {
      version: number;
      values: Record<string, unknown>;
    };
    const reply = await s.call('PUT', '/settings/core.settings', {
      ...as(root),
      body: { version, values: { ...values, branding } },
    });
    expect(reply.status).toBe(200);
  };

  it('is open to anyone, without a session, and has the product name by default', async () => {
    const s = await start();
    const reply = await s.get('/branding');
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      productName: 'Scorpion',
      instanceName: 'Scorpion',
      contactEmail: null,
      imprintUrl: null,
      logos: { light: null, dark: null },
      legalPages: [],
    });
  });

  it('shows what an administrator saved, and never the sender address', async () => {
    const s = await start();
    await save(s, {
      instanceName: 'de.NBI Registry',
      mailFrom: 'registry@example.org',
      contactEmail: 'help@example.org',
      logos: { light: 'a'.repeat(64) },
      legal: { privacy: 'We keep little.' },
    });
    const reply = await s.get('/branding');
    expect(reply.body).toMatchObject({
      instanceName: 'de.NBI Registry',
      contactEmail: 'help@example.org',
      logos: { light: 'a'.repeat(64), dark: null },
      legalPages: ['privacy'],
    });
    expect(JSON.stringify(reply.body)).not.toContain('registry@example.org');
  });

  it('serves a legal page to anyone, rendered and sanitised, and 404 for one without a text', async () => {
    const s = await start();
    expect((await s.get('/legal/terms')).status).toBe(404);
    await save(s, {
      legal: {
        terms:
          '# Terms\n\nBe **kind**. [Home](/)\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\n[bad](javascript:alert(3))',
      },
    });
    const reply = await s.get('/legal/terms'); // no session
    expect(reply.status).toBe(200);
    const { html, title } = reply.body as { html: string; title: string };
    expect(title).toBe('Terms of use');
    expect(html).toContain('<h1>Terms</h1>');
    expect(html).toContain('<strong>kind</strong>');
    // Raw HTML shows as inert text (`&lt;img …&gt;`); what must not exist is a tag or a script link.
    expect(html).not.toMatch(/<(script|img)\b|<[^>]*\son\w+=|href="javascript/i);
    expect(html).toContain('&lt;script&gt;');
    expect((await s.get('/legal/privacy')).status).toBe(404);
    expect((await s.get('/legal/cookies')).status).toBe(422);
  });

  it('is rate limited like other open routes', async () => {
    const s = await app.start({
      rateLimits: {
        default: { capacity: 3, refillPerSecond: 0.001 },
        strict: { capacity: 3, refillPerSecond: 0.001 },
      },
    });
    const statuses = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await s.get('/legal/terms')).status);
    expect(statuses).toContain(429);
  });
});
