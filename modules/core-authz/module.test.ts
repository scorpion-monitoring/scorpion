// The module as the kernel sees it: its manifest, the authoriser it contributes (ADR 0005), and that
// it needs nothing from identity.
import { Forbidden, Unauthorized, type UserActor } from '@scorpion/contracts';
import { makeRole, makeRoleAssignment } from '@scorpion/testing';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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
