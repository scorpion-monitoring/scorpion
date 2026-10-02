// Loader steps 3 and 4: register permissions, event schemas and registries, then validate the
// contributions against them. Everything here is pure, so it is tested without a database.
import type { z } from 'zod';
import { KernelStartupError } from './errors.ts';
import { AUTHENTICATOR_REGISTRY, authenticatorEntrySchema } from './authn.ts';
import { AUTHORIZER_REGISTRY, authorizerEntrySchema } from './authz.ts';
import { SETTINGS_STORE_REGISTRY, settingsStoreEntrySchema } from './settings.ts';
import { SYSTEM_READY, type PermissionDef } from './manifest.ts';
import type { ResolvedModule, ResolvedProfile } from './resolve.ts';

export interface RegisteredPermission extends PermissionDef {
  id: string;
  module: string;
}

export interface RegisteredEvent {
  name: string;
  module: string;
  schema: z.ZodType;
}

export interface RegistryEntry {
  /** The module that contributed the entry. */
  module: string;
  /** The entry after validation and parsing by the registry's schema. */
  value: unknown;
}

export interface RegisteredRegistry {
  name: string;
  owner: string;
  schema: z.ZodType;
  entries: RegistryEntry[];
}

export interface Composition {
  permissions: ReadonlyMap<string, RegisteredPermission>;
  events: ReadonlyMap<string, RegisteredEvent>;
  registries: ReadonlyMap<string, RegisteredRegistry>;
  /** Table-name prefix per module id. */
  tablePrefixes: ReadonlyMap<string, string>;
  /** Contributions and subscriptions dropped because their target module is absent. */
  skipped: readonly string[];
}

/** The prefix a module's tables must carry: its own `tablePrefix`, else derived from the id. */
export function tablePrefixOf(module: Pick<ResolvedModule, 'id' | 'manifest'>): string {
  return module.manifest.tablePrefix ?? `${module.id.replaceAll(/[.-]/g, '_')}_`;
}

/** Modules whose registries and events `module` may use: itself and its dependencies. */
function reachable(module: ResolvedModule): Set<string> {
  return new Set([module.id, ...module.dependsOn, ...module.presentOptional]);
}

/** Owner of the registries the kernel itself declares. Every module may contribute to them. */
export const KERNEL_OWNER = 'kernel';

export function buildComposition(profile: ResolvedProfile): Composition {
  const problems: string[] = [];
  const skipped: string[] = [];
  const ids = profile.modules.map((module) => module.id);

  // Permissions: unique, and prefixed with the owning module's id (not with a longer module id).
  const permissions = new Map<string, RegisteredPermission>();
  for (const module of profile.modules) {
    for (const [id, def] of Object.entries(module.manifest.permissions ?? {})) {
      const foreign = ids.find(
        (other) =>
          other !== module.id && other.startsWith(`${module.id}.`) && id.startsWith(`${other}.`),
      );
      if (foreign) {
        problems.push(`${module.id}: permission "${id}" carries the prefix of module "${foreign}"`);
      }
      const existing = permissions.get(id);
      if (existing) {
        problems.push(`permission "${id}" is declared by both ${existing.module} and ${module.id}`);
        continue;
      }
      permissions.set(id, { ...def, id, module: module.id });
    }
  }

  // Table prefixes: none may be the prefix of another, so every table has one owner.
  const tablePrefixes = new Map(
    profile.modules.map((module) => [module.id, tablePrefixOf(module)]),
  );
  for (const [id, prefix] of tablePrefixes) {
    if (prefix.startsWith('kernel_'))
      problems.push(`${id}: table prefix "${prefix}" is reserved for the kernel`);
    for (const [otherId, otherPrefix] of tablePrefixes) {
      if (id < otherId && (prefix.startsWith(otherPrefix) || otherPrefix.startsWith(prefix))) {
        problems.push(
          `table prefixes of ${id} ("${prefix}") and ${otherId} ("${otherPrefix}") overlap`,
        );
      }
    }
  }

  // Events emitted: unique names.
  const events = new Map<string, RegisteredEvent>();
  for (const module of profile.modules) {
    for (const [name, schema] of Object.entries(module.manifest.events?.emits ?? {})) {
      const existing = events.get(name);
      if (existing)
        problems.push(`event "${name}" is emitted by both ${existing.module} and ${module.id}`);
      else events.set(name, { name, module: module.id, schema });
    }
  }

  // Job names: unique across modules.
  const jobOwner = new Map<string, string>();
  for (const module of profile.modules) {
    for (const job of module.manifest.jobs ?? []) {
      const other = jobOwner.get(job.name);
      if (other) problems.push(`job "${job.name}" is declared by both ${other} and ${module.id}`);
      else jobOwner.set(job.name, module.id);
    }
  }

  // CLI command names: unique across modules.
  const commandOwner = new Map<string, string>();
  for (const module of profile.modules) {
    for (const command of module.manifest.commands ?? []) {
      const other = commandOwner.get(command.name);
      if (other)
        problems.push(`command "${command.name}" is declared by both ${other} and ${module.id}`);
      else commandOwner.set(command.name, module.id);
    }
  }

  // Registries: unique names. The kernel owns `kernel.authorizer`, which any module may fill.
  const registries = new Map<string, RegisteredRegistry>([
    [
      AUTHORIZER_REGISTRY,
      {
        name: AUTHORIZER_REGISTRY,
        owner: KERNEL_OWNER,
        schema: authorizerEntrySchema,
        entries: [],
      },
    ],
    [
      AUTHENTICATOR_REGISTRY,
      {
        name: AUTHENTICATOR_REGISTRY,
        owner: KERNEL_OWNER,
        schema: authenticatorEntrySchema,
        entries: [],
      },
    ],
    [
      SETTINGS_STORE_REGISTRY,
      {
        name: SETTINGS_STORE_REGISTRY,
        owner: KERNEL_OWNER,
        schema: settingsStoreEntrySchema,
        entries: [],
      },
    ],
  ]);
  for (const module of profile.modules) {
    for (const [name, schema] of Object.entries(module.manifest.registries ?? {})) {
      const existing = registries.get(name);
      if (existing)
        problems.push(`registry "${name}" is declared by both ${existing.owner} and ${module.id}`);
      else registries.set(name, { name, owner: module.id, schema, entries: [] });
    }
  }

  for (const module of profile.modules) {
    const allowed = reachable(module);
    // A target that no module of the profile provides is a mistake, unless the module has an
    // optional dependency that is absent: then the target may belong to that module.
    const mayBeAbsent = module.optionalDependsOn.some((id) => !ids.includes(id));

    // Subscriptions: own events and events of dependencies only.
    for (const name of Object.keys(module.manifest.events?.on ?? {})) {
      if (name === SYSTEM_READY) continue;
      const event = events.get(name);
      if (!event) {
        if (mayBeAbsent)
          skipped.push(`${module.id}: subscription "${name}" (no module in the profile emits it)`);
        else
          problems.push(
            `${module.id}: subscribes to "${name}", which no module in the profile emits`,
          );
      } else if (!allowed.has(event.module)) {
        problems.push(
          `${module.id}: subscribes to "${name}" of ${event.module}, which is not a declared dependency`,
        );
      }
    }

    // Contributions: the owner must be the module itself or a dependency; entries must parse.
    for (const [name, entries] of Object.entries(module.manifest.contributes ?? {})) {
      const registry = registries.get(name);
      if (!registry) {
        if (mayBeAbsent)
          skipped.push(`${module.id}: contribution to registry "${name}" (no module declares it)`);
        else
          problems.push(
            `${module.id}: contributes to registry "${name}", which no module in the profile declares`,
          );
        continue;
      }
      if (registry.owner !== KERNEL_OWNER && !allowed.has(registry.owner)) {
        problems.push(
          `${module.id}: contributes to registry "${name}" of ${registry.owner}, which is not a declared dependency`,
        );
        continue;
      }
      entries.forEach((entry, index) => {
        const parsed = registry.schema.safeParse(entry);
        if (parsed.success) {
          registry.entries.push({ module: module.id, value: parsed.data });
          return;
        }
        for (const issue of parsed.error.issues) {
          const path = [index, ...issue.path].map(String).join('.');
          problems.push(`${module.id}: registry "${name}" entry ${path}: ${issue.message}`);
        }
      });
    }
  }

  const authorizers = registries.get(AUTHORIZER_REGISTRY)!.entries;
  if (authorizers.length > 1) {
    problems.push(
      `more than one module contributes to "${AUTHORIZER_REGISTRY}": ${authorizers.map((e) => e.module).join(', ')}`,
    );
  }

  const authenticators = registries.get(AUTHENTICATOR_REGISTRY)!.entries;
  if (authenticators.length > 1) {
    problems.push(
      `more than one module contributes to "${AUTHENTICATOR_REGISTRY}": ${authenticators.map((e) => e.module).join(', ')}`,
    );
  }

  const stores = registries.get(SETTINGS_STORE_REGISTRY)!.entries;
  if (stores.length > 1) {
    problems.push(
      `more than one module contributes to "${SETTINGS_STORE_REGISTRY}": ${stores.map((e) => e.module).join(', ')}`,
    );
  }

  if (problems.length > 0) {
    throw new KernelStartupError(`Cannot compose profile "${profile.name}":`, problems);
  }
  return { permissions, events, registries, tablePrefixes, skipped };
}
