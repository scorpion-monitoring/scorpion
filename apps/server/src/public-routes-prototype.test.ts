// Prototype of M7 sprint 3 (plan §0 item 5 and §7 item 1; recorded in ADR-0036 part 2): a public route
// (`public: true`) that reads a record by the per-resource flag, behind the REAL pipeline. It shows that no change
// in a scoped path is needed (`apps/server/src/pipeline`, `packages/contracts/src/route.ts`, `modules/core-identity`,
// `modules/core-authz`): the rate limit applies to a public route, a record that is not public answers 404 with the
// body of an unknown id (never 403), the route sets `Cache-Control: public, max-age=60` itself, an unpublish is seen
// at the next request (the server keeps no cache; the lifetime is the only delay for a shared cache in front), a
// session cookie on a public route sets no cookie and changes nothing, and the CSP stays strict. The full set of
// cases is `public-service-routes.test.ts`.
import { makeOrganisation, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';
/** A problem without the request id, which is different for every request by design. */
const bodyOf = (body: unknown) => {
  const rest = { ...(body as Record<string, unknown>) };
  delete rest.requestId;
  return rest;
};

async function world(options: Parameters<typeof app.start>[0] = {}) {
  const s = await app.start({ tokenCacheTtlMs: 0, ...options });
  const provider = await makeOrganisation(s.kernel.pool, { type: 'provider' });
  const open = await makeService(s.kernel.pool, { provider: provider.id, public: true });
  const closed = await makeService(s.kernel.pool, { provider: provider.id });
  return { s, provider, open, closed };
}

describe('a public route behind the real pipeline (prototype)', () => {
  it('answers 200 to an anonymous reader with Cache-Control public, max-age=60 and the strict CSP', async () => {
    const { s, open } = await world();
    const reply = await s.get(`/public/services/${open.slug}`);
    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(reply.res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(reply.res.headers.get('set-cookie')).toBeNull();
    expect(reply.body).toMatchObject({ id: open.id, slug: open.slug });
  });

  it('answers a service that is not public with the exact body of an unknown id, never 403', async () => {
    const { s, closed } = await world();
    const unknown = await s.get(`/public/services/${ABSENT}`);
    const unknownSlug = await s.get('/public/services/no-such-slug');
    expect(unknown.status).toBe(404);
    for (const ref of [closed.id, closed.slug]) {
      const reply = await s.get(`/public/services/${ref}`);
      expect(reply.status).toBe(404);
      expect(bodyOf(reply.body)).toEqual(bodyOf(unknown.body));
      expect(reply.res.headers.get('cache-control')).toBeNull();
    }
    expect(bodyOf(unknownSlug.body)).toEqual(bodyOf(unknown.body));
  });

  it('applies the rate limit of the default group', async () => {
    const { s, open } = await world({
      rateLimits: { default: { capacity: 3, refillPerSecond: 0.0001 } },
    });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await s.get(`/public/services/${open.id}`)).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  it('shows an unpublish at the next request: the server keeps no copy', async () => {
    const { s, open } = await world();
    expect((await s.get(`/public/services/${open.id}`)).status).toBe(200);
    await s.kernel.pool.query(
      'update svc_service set public = false, published_at = null, published_by = null where id = $1',
      [open.id],
    );
    expect((await s.get(`/public/services/${open.id}`)).status).toBe(404);
  });

  it('ignores a session cookie, and a stale one does not turn the answer into a 401', async () => {
    const { s, open } = await world();
    const who = await s.signedIn('cookie-reader');
    for (const cookie of [who.cookie, 'not-a-session']) {
      const reply = await s.get(`/public/services/${open.id}`, { cookie });
      expect(reply.status).toBe(200);
      expect(reply.setCookie).toBeUndefined();
    }
  });

  it('writes the JSON-LD with no character that could end a script block', async () => {
    const { s, open } = await world();
    const reply = await s.get(`/public/services/${open.id}/schema-org`);
    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('content-type')).toContain('application/ld+json');
    expect(reply.res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(reply.bytes.toString()).not.toMatch(/[<>&]/);
  });
});
