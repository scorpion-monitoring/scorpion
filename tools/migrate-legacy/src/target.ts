// The new instance the tool writes to: the kernel of the `full` profile booted over DATABASE_URL with its services built
// and nothing else (no migration, no routes, no `system.ready`, no workers: `kernel.buildServices()`), and the account the
// tool acts as (ADR-0052). The modules are reached only through their public.ts.
import { randomBytes } from 'node:crypto';
import type { UserActor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { IdentityService } from '@scorpion/core-identity/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import { createKernel, createLogger, loadConfig, type Kernel } from '@scorpion/kernel';
import type { OrganisationsPublic } from '@scorpion/registry-organisations/public';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { moduleIds, profileName, sources } from '@scorpion/server/src/generated/profile.ts';

export const MIGRATION_USERNAME = 'legacy-migration';
/** The Admin role of core.identity (`ADMIN_ROLE`); every write passes the same permission check as a request. */
export const ADMIN_ROLE = 'admin';

export class TargetError extends Error {}

export interface Target {
  kernel: Kernel;
  organisations: OrganisationsPublic;
  services: ServicesPublic;
  identity: IdentityService;
  authz: AuthzService;
  settings: SettingsService;
  stop(): Promise<void>;
}

function service<T>(kernel: Kernel, id: string): T {
  const found = kernel.services.get(id);
  if (!found) throw new TargetError(`The profile has no module ${id}.`);
  return found as T;
}

/** Boots the kernel over `env.DATABASE_URL`. Refuses another profile than `full` and pending migrations. */
export async function openTarget(
  env: Readonly<Record<string, string | undefined>>,
): Promise<Target> {
  // The generated file is rewritten by `profile:generate <name>`, so its literal type can be another profile.
  const generated: string = profileName;
  if (generated !== 'full') {
    throw new TargetError(
      `The generated profile is "${generated}"; the migration needs "full". Run: pnpm scorpion profile:generate full`,
    );
  }
  if (!env.DATABASE_URL)
    throw new TargetError('Set DATABASE_URL to the database of the new instance.');
  const config = loadConfig({ ...env, PROFILE: profileName });
  const kernel = createKernel({
    profile: { name: profileName, modules: moduleIds },
    sources,
    config,
    log: createLogger({ level: env.LOG_LEVEL === undefined ? 'warn' : config.LOG_LEVEL }),
  });
  try {
    await kernel.buildServices();
  } catch (error) {
    await kernel.stop();
    throw error;
  }
  return {
    kernel,
    organisations: service(kernel, 'registry.organisations'),
    services: service(kernel, 'registry.services'),
    identity: service(kernel, 'core.identity'),
    authz: service(kernel, 'core.authz'),
    settings: service(kernel, 'core.settings'),
    stop: () => kernel.stop(),
  };
}

const actorOf = (user: { id: string; username: string }): UserActor => ({
  kind: 'user',
  userId: user.id,
  username: user.username,
  roles: [],
  via: 'session',
});

/**
 * The migration account, found by its username or, when `create` is set, created like `create-admin` makes the first
 * administrator: an active account with the Admin role, in one transaction. Its password is random and shown nowhere,
 * so nobody signs in as it. A found account is used as it is: the tool never gives a role to an existing account (one
 * named so by somebody else gains nothing), so one without Admin is refused by the services at the first write.
 */
export async function migrationAccount(
  target: Target,
  options: { create: boolean },
): Promise<{ actor: UserActor | undefined; state: 'found' | 'created' | 'not created (dry run)' }> {
  const found = await target.identity.users.findByUsername(MIGRATION_USERNAME);
  if (found) {
    if (found.status !== 'active' || found.deletedAt !== null) {
      throw new TargetError(
        `The account "${MIGRATION_USERNAME}" exists but is ${found.deletedAt ? 'deleted' : found.status}; activate it or remove it first.`,
      );
    }
    return { actor: actorOf(found), state: 'found' };
  }
  if (!options.create) return { actor: undefined, state: 'not created (dry run)' };
  const user = await target.kernel.db.tx(async (tx) => {
    const created = await target.identity.users.createUser({
      username: MIGRATION_USERNAME,
      status: 'active',
      auth: { provider: 'local', password: randomBytes(32).toString('base64url') },
    });
    await target.authz.assignRoleAsSystem(tx, { userId: created.id, roleKey: ADMIN_ROLE });
    return created;
  });
  return { actor: actorOf(user), state: 'created' };
}

/** What the target already holds of the registry, read through the services: an operator is told before a write. */
export async function targetState(
  target: Target,
  keys: { providers: readonly string[]; services: readonly string[] },
): Promise<{ empty: boolean; notes: string[] }> {
  const [anyService, consortia, providerIds] = await Promise.all([
    target.services.listForPickerAsSystem({ limit: 1 }),
    target.organisations.listConsortiaAsSystem(),
    target.services.listProviderIdsAsSystem(),
  ]);
  let providers = 0;
  for (const abbreviation of keys.providers) {
    if (await target.organisations.findByAbbreviationAsSystem('provider', abbreviation))
      providers += 1;
  }
  let services = 0;
  for (const slug of keys.services) {
    if (await target.services.findBySlugAsSystem(slug)) services += 1;
  }
  const notes: string[] = [];
  if (anyService.length > 0) notes.push('it holds services');
  if (consortia.length > 0) notes.push(`it holds ${consortia.length} consortia`);
  if (providerIds.length > 0) notes.push(`${providerIds.length} provider(s) have services`);
  if (providers > 0) notes.push(`${providers} of the snapshot's providers exist`);
  if (services > 0) notes.push(`${services} of the snapshot's services exist`);
  return { empty: notes.length === 0, notes };
}
