// The module as the kernel sees it: its manifest, the authoriser it contributes (ADR 0005), and that
// it needs nothing from identity.
import { Forbidden, Unauthorized, type UserActor } from '@scorpion/contracts';
import { makeRole, makeRoleAssignment } from '@scorpion/testing';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import authzModule from './module.ts';
import { notesModule, useAuthz } from './test/harness.ts';

const harness = useAuthz();

const request = (actor: UserActor | { kind: 'anonymous' }, permission: string) => ({
  actor,
  permission,
  module: 'fix.notes',
  method: 'GET',
  path: '/notes',
  context: {},
});

describe('the kernel.authorizer entry', () => {
  it('is the one the kernel uses: 401 anonymous, 403 without the permission, through with it', async () => {
    const { kernel, authz } = await harness.start({
      modules: [notesModule()],
      cacheTtlMs: 0, // the role is added behind the service's back
    });
    void authz;
    const user = { id: randomUUID() };
    const actor: UserActor = {
      kind: 'user',
      userId: user.id,
      username: 'someone',
      roles: [],
      via: 'session',
    };
    const role = await makeRole(kernel.pool, { permissions: ['fix.notes.read'] });
    const authorize = kernel.authorizer as (r: unknown) => Promise<void>;

    await expect(
      authorize(request({ kind: 'anonymous' }, 'fix.notes.read')),
    ).rejects.toBeInstanceOf(Unauthorized);
    await expect(authorize(request(actor, 'fix.notes.read'))).rejects.toBeInstanceOf(Forbidden);
    await makeRoleAssignment(kernel.pool, user, role);
    await expect(authorize(request(actor, 'fix.notes.read'))).resolves.toBeUndefined();
    await expect(authorize(request(actor, 'fix.notes.approve'))).rejects.toBeInstanceOf(Forbidden);
  });

  it('does not trust the roles the actor carries', async () => {
    const { kernel } = await harness.start({ modules: [notesModule()] });
    const claims: UserActor = {
      kind: 'user',
      userId: randomUUID(),
      username: 'liar',
      roles: ['admin'],
      via: 'session',
    };
    const authorize = kernel.authorizer as (r: unknown) => Promise<void>;
    await expect(authorize(request(claims, 'fix.notes.read'))).rejects.toBeInstanceOf(Forbidden);
  });

  it('is public service of core.authz for modules that depend on it', async () => {
    let reached: unknown;
    const spy = notesModule();
    const manifest = {
      ...spy.manifest,
      services: (ctx: { deps: Record<string, unknown> }) => {
        reached = ctx.deps['core.authz'];
        return {};
      },
    };
    const { authz } = await harness.start({
      modules: [{ id: spy.id, manifest: manifest }],
    });
    expect(reached).toBe(authz);
  });
});

describe('what the module imports', () => {
  it('nothing from core.identity or core.settings, in package.json or in any source file', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const files = ['package.json', 'module.ts', 'public.ts', 'db', 'service', 'migrations'].flatMap(
      (entry) =>
        /\.\w+$/.test(entry)
          ? [entry]
          : readdirSync(join(dir, entry))
              .filter((file) => /\.(ts|sql)$/.test(file) && !file.endsWith('.test.ts'))
              .map((file) => join(entry, file)),
    );
    expect(files).toContain('package.json');
    for (const file of files) {
      const text = readFileSync(join(dir, file), 'utf8').replace(/\/\/.*$/gm, ''); // comments may name it
      expect(text, file).not.toMatch(
        /core-identity|core\.identity|identity_|core-settings|core\.settings/,
      );
    }
  });
});

describe('the system methods (ADR 0015)', () => {
  // `listHoldersAsSystem`, `assignRoleAsSystem` and `removeAllAssignments` check no permission, so no
  // route may reach them. Since M5 sprint 3 core.authz has routes of its own: the one that edits the
  // permissions of a role and (sprint 4) the two lists of permissions (listing roles and giving one stay in
  // core.identity); no route file in the repository names the system methods.
  it('registers exactly three routes, the permissions of a role and two lists of permissions, and touches no system method', () => {
    const registered: string[] = [];
    const SYSTEM = ['listHoldersAsSystem', 'assignRoleAsSystem', 'removeAllAssignments'];
    const service = new Proxy(
      {},
      {
        get: (_target, name) => {
          expect(SYSTEM, `route registration reads ${String(name)}`).not.toContain(name);
          return () => undefined;
        },
      },
    );
    const registrar = {
      internal: (route: { method: string; path: string }) =>
        registered.push(`${route.method.toUpperCase()} ${route.path}`),
      public: (_version: string, route: { method: string; path: string }) =>
        registered.push(`v1 ${route.method.toUpperCase()} ${route.path}`),
      service: () => service,
    };
    authzModule.routes!(registrar as never, {} as never);
    expect(registered.sort()).toEqual([
      'GET /account/permissions',
      'GET /permissions',
      'PUT /roles/{key}/permissions',
    ]);
  });

  it('are not named in any route file of any module', () => {
    const modulesDir = join(fileURLToPath(new URL('..', import.meta.url)));
    const offenders: string[] = [];
    for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const file of readdirSync(join(modulesDir, entry.name))) {
        if (!/^routes(\..*)?\.ts$/.test(file) || file.endsWith('.test.ts')) continue;
        const source = readFileSync(join(modulesDir, entry.name, file), 'utf8');
        if (/listHoldersAsSystem|assignRoleAsSystem|removeAllAssignments/.test(source)) {
          offenders.push(`${entry.name}/${file}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
