// The new instance the tool writes to: the kernel of the `full` profile booted over DATABASE_URL with its services built
// and nothing else (no migration, no routes, no `system.ready`, no workers: `kernel.buildServices()`), and the account the
// tool acts as (ADR-0052). The modules are reached only through their public.ts.
import { randomBytes } from 'node:crypto';
import { Conflict, type UserActor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { IdentityService } from '@scorpion/core-identity/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import { createKernel, createLogger, loadConfig, type Kernel } from '@scorpion/kernel';
import type { KpiFrameworkPublic } from '@scorpion/kpi-framework/public';
import type { KpiIngestionPublic } from '@scorpion/kpi-ingestion/public';
import type { OrganisationsPublic } from '@scorpion/registry-organisations/public';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { moduleIds, profileName, sources } from '@scorpion/server/src/generated/profile.ts';

export const MIGRATION_USERNAME = 'legacy-migration';
/** The Admin role of core.identity (`ADMIN_ROLE`); every write passes the same permission check as a request. */
export const ADMIN_ROLE = 'admin';

export class TargetError extends Error {}

/** `host:port/database` of a connection URL, for the operator: never the user or the password. */
export function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname}`;
  } catch {
    return '(DATABASE_URL is not a URL)';
  }
}

export interface Target {
  kernel: Kernel;
  organisations: OrganisationsPublic;
  services: ServicesPublic;
  kpi: KpiFrameworkPublic;
  ingestion: KpiIngestionPublic;
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
    kpi: service(kernel, 'kpi.framework'),
    ingestion: service(kernel, 'kpi.ingestion'),
    identity: service(kernel, 'core.identity'),
    authz: service(kernel, 'core.authz'),
    settings: service(kernel, 'core.settings'),
    stop: () => kernel.stop(),
  };
}

export const actorOf = (user: { id: string; username: string }): UserActor => ({
  kind: 'user',
  userId: user.id,
  username: user.username,
  roles: [],
  via: 'session',
});

/** The name of the n-th migration account: `legacy-migration`, `legacy-migration-2`, … */
const accountName = (n: number) => (n === 1 ? MIGRATION_USERNAME : `${MIGRATION_USERNAME}-${n}`);

/**
 * The migration account: the first of `legacy-migration`, `legacy-migration-2`, … that is active, or, when `create` is set
 * and there is none, a new one made like `create-admin` makes the first administrator: an active account with the Admin
 * role, in one transaction. Its password is random and shown nowhere, so nobody signs in as it. A found account is used as
 * it is: the tool never gives a role to an existing account (one named so by somebody else gains nothing), so one without
 * Admin is refused by the services at the first write. An account that was deactivated (by the end of an earlier run, or by
 * somebody) is never reused: nothing reactivates an account, so a run after it uses the next name.
 */
export async function migrationAccount(
  target: Target,
  options: { create: boolean },
): Promise<{
  actor: UserActor | undefined;
  state: 'found' | 'created' | 'not created (dry run)';
  username: string;
}> {
  for (let n = 1; n <= 50; n += 1) {
    const username = accountName(n);
    const found = await target.identity.users.findByUsername(username);
    if (found) {
      if (found.status === 'active' && found.deletedAt === null) {
        return { actor: actorOf(found), state: 'found', username };
      }
      continue;
    }
    if (!options.create) return { actor: undefined, state: 'not created (dry run)', username };
    const user = await target.kernel.db.tx(async (tx) => {
      const created = await target.identity.users.createUser({
        username,
        status: 'active',
        auth: { provider: 'local', password: randomBytes(32).toString('base64url') },
      });
      await target.authz.assignRoleAsSystem(tx, { userId: created.id, roleKey: ADMIN_ROLE });
      return created;
    });
    return { actor: actorOf(user), state: 'created', username };
  }
  throw new TargetError(
    `Fifty accounts named "${MIGRATION_USERNAME}…" exist and none is active; remove the closed ones first.`,
  );
}

/**
 * Ends the life of the migration account (plan §4): deactivated, so nobody can use it. The last-Admin rule still applies,
 * so on an instance with no other active administrator it stays active, and the answer says so (the operator closes it
 * after the first administrator exists). Returns what to write in the report.
 */
export async function endAccount(target: Target, actor: UserActor): Promise<string> {
  try {
    await target.identity.deactivateAsSystem(actor.userId);
    return 'deactivated';
  } catch (error) {
    if (error instanceof Conflict) {
      return `still active: ${error.message} Deactivate it once another administrator exists`;
    }
    throw error;
  }
}

/** The ids of the OIDC providers configured in the target (the setting "Sign-in providers"). */
export async function configuredProviders(target: Target): Promise<string[]> {
  const settings = (await target.kernel.settingsOf('core.identity').get()) as {
    oidcProviders?: { id: string }[];
  };
  return (settings.oidcProviders ?? []).map((provider) => provider.id);
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
