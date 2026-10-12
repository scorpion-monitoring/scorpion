// Prototype of M7 sprint 2 (plan §0 item 4 and §6; recorded in ADR-0036), the route half: a delegated route
// (`PATCH /services/{id}`) carries only the plain `…service.read`, so a plain User passes the pipeline and the
// SERVICE refuses; the approved member of the provider and the approved manager pass the service with the
// policy `service.member`, by session and by token; and a demotion is read at the next request. No change in
// a scoped path: the route is an ordinary `createRoute()` (ADR-0034, design A). The full set of cases is
// `service-editing-routes.test.ts`; the matrix rows are in `defect-01.privilege-escalation.test.ts`.
import { makeMembership, makeOrganisation, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
const as = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function world() {
  const s = await app.start({ tokenCacheTtlMs: 0 });
  const pool = s.kernel.pool;
  const provider = await makeOrganisation(pool, { type: 'provider' });
  const svc = await makeService(pool, { provider: provider.id });
  const join = async (name: string, role: 'member' | 'manager') => {
    const who = await s.signedIn(name);
    await makeMembership(pool, {
      organisationId: provider.id,
      userId: who.user.id,
      state: 'approved',
      role,
    });
    return who;
  };
  const patch = (who: Parameters<typeof as>[0], body: unknown) =>
    s.call('PATCH', `/services/${svc.id}`, { ...as(who), body });
  return { s, pool, provider, svc, join, patch, plain: await s.signedIn('plain') };
}

describe('a delegated PATCH route carries only the plain read (prototype)', () => {
  it('lets a plain User reach the service, which refuses with 403 and writes nothing', async () => {
    const { patch, plain, pool, svc } = await world();
    expect((await patch(plain, { description: 'defaced' })).status).toBe(403);
    const { rows } = await pool.query('select description from svc_service where id = $1', [
      svc.id,
    ]);
    expect(rows).toEqual([{ description: null }]);
  });

  it('lets an approved member edit a descriptive field and refuses the slug, refusing the whole request', async () => {
    const { patch, join, pool, svc } = await world();
    const member = await join('member', 'member');
    expect((await patch(member, { description: 'mine' })).status).toBe(200);
    const mixed = await patch(member, { description: 'again', slug: 'stolen-address' });
    expect(mixed.status).toBe(403);
    const { rows } = await pool.query('select slug, description from svc_service where id = $1', [
      svc.id,
    ]);
    expect(rows).toEqual([{ slug: svc.slug, description: 'mine' }]);
  });

  it('lets an approved manager change the slug, and reads a demotion at the next request', async () => {
    const { patch, join, pool, svc } = await world();
    const manager = await join('manager', 'manager');
    expect((await patch(manager, { slug: 'renamed-once' })).status).toBe(200);
    await pool.query("update org_membership set role = 'member' where user_id = $1", [
      manager.user.id,
    ]);
    expect((await patch(manager, { slug: 'renamed-twice' })).status).toBe(403);
    expect((await patch(manager, { name: 'still a member' })).status).toBe(200);
    const { rows } = await pool.query('select slug from svc_service where id = $1', [svc.id]);
    expect(rows).toEqual([{ slug: 'renamed-once' }]);
  });

  it('passes a token only with the scoped permission in its scopes, on top of the plain one', async () => {
    const { s, join, svc } = await world();
    const member = await join('tokenmember', 'member');
    let n = 0;
    const make = async (scopes: string[]) => {
      const made = await s.post('/tokens', {
        ...as(member),
        body: { name: `token-${++n}`, scopes },
      });
      expect(made.status).toBe(201);
      return (made.body as { token: string }).token;
    };
    const read = 'registry.services.service.read';
    const edit = 'registry.services.service.edit';
    const call = (token: string) =>
      s.call('PATCH', `/services/${svc.id}`, {
        headers: bearer(token),
        body: { description: 'by token' },
      });
    expect((await call(await make([read, edit]))).status).toBe(200);
    expect((await call(await make([read]))).status).toBe(403); // the service asks for `edit`
    expect((await call(await make([edit]))).status).toBe(403); // the route asks for `read`
  });
});
