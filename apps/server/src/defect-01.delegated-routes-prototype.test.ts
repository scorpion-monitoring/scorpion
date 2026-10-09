// Prototype of M6 sprint 3 (plan §0 item 8 and §7 item 1; recorded in ADR-0034): the two ways a route
// can carry a resource-scoped permission, through the whole pipeline with the real authoriser.
//
//   A. The route names a plain global permission that every signed-in person holds, and the service
//      calls `authz.require(actor, scoped, resource)`. The policy answers there.
//   B. The route names the scoped permission itself. The pipeline checks it with no resource, so a
//      caller who holds it only through the policy never gets in.
//
// A needs no change in the pipeline or in `createRoute()` and is what M6 builds. B is the reason the
// alternative (a `scoped` route flag) is recorded and deferred. This file is a regression test: if the
// pipeline ever starts to pass B, the ADR is out of date and this test says so.
import { createRoute, z } from '@scorpion/contracts';
import { defineModule } from '@scorpion/kernel';
import type { AuthzService } from '@scorpion/core-authz/public';
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
const session = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const READ = 'fix.deleg.thing.read';
const EDIT = 'fix.deleg.thing.edit';
const managers = new Set<string>();

const params = z.object({ id: z.string() });
const designA = createRoute({
  method: 'get',
  path: '/fixture/deleg/a/{id}',
  permission: READ,
  request: { params },
  responses: { 200: { description: 'ok' } },
});
const designB = createRoute({
  method: 'get',
  path: '/fixture/deleg/b/{id}',
  permission: EDIT,
  request: { params },
  responses: { 200: { description: 'ok' } },
});

type Ctx = {
  get: (key: 'actor') => never;
  req: { param: (name: string) => string };
  json: (body: unknown) => Response;
};

const fixture = {
  id: 'fix.deleg',
  requires: ['@scorpion/core-authz'],
  manifest: defineModule({
    id: 'fix.deleg',
    version: '1.0.0',
    permissions: {
      [READ]: { description: 'Read things' },
      [EDIT]: { description: 'Edit one thing', scope: 'thing' },
    },
    contributes: {
      // Every signed-in person holds the plain permission, nothing more.
      'authz.defaultRole': [{ role: 'user', permissions: [READ] }],
      'authz.resourcePolicy': [
        {
          resourceType: 'thing',
          allows: ({ actor, resource }: { actor: { userId: string }; resource: { id?: string } }) =>
            resource.id === 'mine' && managers.has(actor.userId),
        },
      ],
    },
    services: (ctx) => ({
      authz: (ctx.deps as Record<string, unknown>)['core.authz'] as AuthzService,
    }),
    routes: (r) => {
      const service = r.service<{ authz: AuthzService }>();
      // A: the service is the authorization.
      r.internal(designA, (async (c: Ctx) => {
        await service.authz.require(c.get('actor'), EDIT, {
          type: 'thing',
          id: c.req.param('id'),
        });
        return c.json({ ok: true });
      }) as never);
      // B: the handler runs only for callers the pipeline let through.
      r.internal(designB, ((c: Ctx) => c.json({ ok: true })) as never);
    },
  }),
};

const start = () => app.start({ tokenCacheTtlMs: 0, extraModules: [fixture] });

describe('delegation at the route: two designs (prototype)', () => {
  it('A: a plain global permission on the route and a scoped check in the service lets the manager of one thing through and nobody else', async () => {
    managers.clear();
    const s = await start();
    const manager = await s.signedIn('manager');
    const outsider = await s.signedIn('outsider');
    const admin = await s.signedIn('boss', { roles: ['admin'] });
    managers.add(manager.user.id);
    expect((await s.get('/fixture/deleg/a/mine', session(manager))).status).toBe(200);
    expect((await s.get('/fixture/deleg/a/other', session(manager))).status).toBe(403);
    expect((await s.get('/fixture/deleg/a/mine', session(outsider))).status).toBe(403);
    expect((await s.get('/fixture/deleg/a/mine', session(admin))).status).toBe(200);
    expect((await s.get('/fixture/deleg/a/mine')).status).toBe(401);
  });

  it('A: a token passes only with the scoped permission in its scopes, on top of the plain one', async () => {
    managers.clear();
    const s = await start();
    const manager = await s.signedIn('manager');
    managers.add(manager.user.id);
    let n = 0;
    const make = async (scopes: string[]) => {
      const made = await s.post('/tokens', {
        ...session(manager),
        body: { name: `token-${++n}`, scopes },
      });
      expect(made.status).toBe(201);
      return (made.body as { token: string }).token;
    };
    const both = await make([READ, EDIT]);
    const plainOnly = await make([READ]);
    const scopedOnly = await make([EDIT]);
    expect((await s.get('/fixture/deleg/a/mine', { headers: bearer(both) })).status).toBe(200);
    expect((await s.get('/fixture/deleg/a/mine', { headers: bearer(plainOnly) })).status).toBe(
      403, // the service asks for EDIT: the scope gate stops it before the policy
    );
    expect((await s.get('/fixture/deleg/a/mine', { headers: bearer(scopedOnly) })).status).toBe(
      403, // the route asks for READ
    );
  });

  it('A: the effect of a demotion is at the next request, because the policy reads the membership each time', async () => {
    managers.clear();
    const s = await start();
    const manager = await s.signedIn('manager');
    managers.add(manager.user.id);
    expect((await s.get('/fixture/deleg/a/mine', session(manager))).status).toBe(200);
    managers.delete(manager.user.id);
    expect((await s.get('/fixture/deleg/a/mine', session(manager))).status).toBe(403);
  });

  it('B: a scoped permission on the route turns the manager away, because the pipeline checks it without a resource', async () => {
    managers.clear();
    const s = await start();
    const manager = await s.signedIn('manager');
    const admin = await s.signedIn('boss', { roles: ['admin'] });
    managers.add(manager.user.id);
    expect((await s.get('/fixture/deleg/b/mine', session(manager))).status).toBe(403);
    // Admin holds it globally, so it passes: B works for Admin only, which is why it is not used.
    expect((await s.get('/fixture/deleg/b/mine', session(admin))).status).toBe(200);
  });
});
