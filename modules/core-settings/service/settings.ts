// Module settings: what an administrator saved for each module, validated by that module's own
// `settings` schema (ADR 0017). The store behind `ctx.settings` is here too: it reads the table
// with a short cache that this process empties when it writes.
//
// The cache holds the stored JSON of each module for `SETTINGS_CACHE_TTL_MS`. A write empties the
// entry in the process that made it, so that process sees it at once. Another process learns of a
// change when its entry expires, so with several server processes a changed setting (turning
// local accounts off, say) takes effect there within that bound, the same bound as for sessions
// (ADR 0007) and permissions (ADR 0014).
import { Conflict, Invalid, NotFound, type Actor, type FieldProblem } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import { resolveSettings, type ModuleContext, type SettingsStore } from '@scorpion/kernel';
import { eq } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { setting } from '../db/schema.ts';
import { PERMISSION_SETTINGS_READ, PERMISSION_SETTINGS_WRITE } from './permissions.ts';

/** How long one process trusts the stored settings it has read. The staleness bound across processes. */
export const SETTINGS_CACHE_TTL_MS = 5_000;

export interface SettingsView {
  module: string;
  /** 0 until something is saved. A write names the version it read. */
  version: number;
  /** The effective values: what is stored, validated, with the defaults applied. */
  values: unknown;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export interface SettingsAdminService {
  /** Needs `core.settings.read`. The settings of every loaded module that declares a schema, by module id. */
  list(actor: Actor): Promise<SettingsView[]>;
  /** Needs `core.settings.read`. `NotFound` for a module with no settings schema. */
  get(actor: Actor, moduleId: string): Promise<SettingsView>;
  /** Needs `core.settings.read`. The JSON Schema of the module's settings, for the admin form. */
  jsonSchema(actor: Actor, moduleId: string): Promise<Record<string, unknown>>;
  /**
   * Needs `core.settings.write`. Replaces the stored settings of one module with `values`, which
   * the module's schema must accept (`Invalid`, with the failing fields). `version` is the one
   * the caller read; a stale one is `Conflict` and nothing is written. A write that changes
   * nothing is not written and emits nothing. Emits `settings.changed@1` with the names of the
   * changed keys, never their values.
   */
  update(
    actor: Actor,
    moduleId: string,
    input: { version: number; values: unknown },
  ): Promise<SettingsView>;
}

export interface SettingsInternals extends SettingsAdminService {
  /** What the kernel's `ctx.settings` reads. */
  store: SettingsStore;
  /** The stored JSON of one module, straight from the database (no cache, and the cache is not filled). */
  readFresh(moduleId: string): Promise<unknown>;
  /** Empties the cache of this process. */
  invalidate(moduleId?: string): void;
}

interface CacheEntry {
  value: unknown;
  readAt: number;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The keys whose values differ between two stored objects, sorted. */
export function changedKeys(before: unknown, after: unknown): string[] {
  const a = isPlainObject(before) ? before : {};
  const b = isPlainObject(after) ? after : {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => !isDeepStrictEqual(a[key], b[key]))
    .sort();
}

/** The problems of a Zod error as field problems: paths and messages, never the offending value. */
export function fieldProblems(error: z.ZodError, prefix = ''): FieldProblem[] {
  return error.issues.map((issue) => ({
    path: [...(prefix ? [prefix] : []), ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));
}

export function createSettingsService(
  ctx: ModuleContext,
  deps: { authz: Pick<AuthzService, 'require'> },
  options: { cacheTtlMs?: number; now?: () => number } = {},
): SettingsInternals {
  const ttl = options.cacheTtlMs ?? SETTINGS_CACHE_TTL_MS;
  const clock = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  /** Bumped by every invalidation; a read that raced with one does not cache its result. */
  let generation = 0;

  const invalidate = (moduleId?: string) => {
    generation += 1;
    if (moduleId === undefined) cache.clear();
    else cache.delete(moduleId);
  };

  async function stored(moduleId: string, fresh = false): Promise<unknown> {
    const now = clock();
    const hit = cache.get(moduleId);
    if (!fresh && hit && now - hit.readAt < ttl) return hit.value;
    const before = generation;
    const [row] = await ctx.db
      .select({ value: setting.value })
      .from(setting)
      .where(eq(setting.moduleId, moduleId));
    const value = row?.value;
    if (!fresh && before === generation) cache.set(moduleId, { value, readAt: now });
    return value;
  }

  function schemaOf(moduleId: string): z.ZodType {
    const schema = ctx.settingsSchemas.get(moduleId);
    if (!schema)
      throw new NotFound(`There are no settings for the module "${moduleId.slice(0, 100)}".`);
    return schema;
  }

  async function view(moduleId: string): Promise<SettingsView> {
    const [row] = await ctx.db.select().from(setting).where(eq(setting.moduleId, moduleId));
    return {
      module: moduleId,
      version: row?.version ?? 0,
      values: resolveSettings(schemaOf(moduleId), row?.value).value,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  }

  return {
    store: { read: (moduleId) => stored(moduleId) },
    readFresh: (moduleId) => stored(moduleId, true),
    invalidate,

    async list(actor) {
      await deps.authz.require(actor, PERMISSION_SETTINGS_READ);
      const rows = new Map(
        (await ctx.db.select().from(setting)).map((row) => [row.moduleId, row] as const),
      );
      return [...ctx.settingsSchemas.keys()].sort().map((moduleId) => {
        const row = rows.get(moduleId);
        return {
          module: moduleId,
          version: row?.version ?? 0,
          values: resolveSettings(schemaOf(moduleId), row?.value).value,
          updatedAt: row?.updatedAt ?? null,
          updatedBy: row?.updatedBy ?? null,
        };
      });
    },

    async get(actor, moduleId) {
      await deps.authz.require(actor, PERMISSION_SETTINGS_READ);
      schemaOf(moduleId);
      return view(moduleId);
    },

    async jsonSchema(actor, moduleId) {
      await deps.authz.require(actor, PERMISSION_SETTINGS_READ);
      // The form edits what is sent, so it is described by the input side; a part Zod cannot
      // express in JSON Schema is left open (and still checked by the server on save).
      return z.toJSONSchema(schemaOf(moduleId), { io: 'input', unrepresentable: 'any' });
    },

    async update(actor, moduleId, input) {
      await deps.authz.require(actor, PERMISSION_SETTINGS_WRITE);
      const schema = schemaOf(moduleId);
      if (!isPlainObject(input.values)) {
        throw new Invalid('The settings are not valid.', [
          { in: 'body', path: 'values', message: 'Must be an object.' },
        ]);
      }
      const parsed = schema.safeParse(input.values);
      if (!parsed.success) {
        throw new Invalid('The settings are not valid.', fieldProblems(parsed.error, 'values'));
      }
      const updatedBy = actor.kind === 'user' ? actor.userId : null;
      const result = await ctx.db.tx(async (tx) => {
        const [current] = await tx
          .select()
          .from(setting)
          .where(eq(setting.moduleId, moduleId))
          .for('update');
        if ((current?.version ?? 0) !== input.version) {
          throw new Conflict('The settings changed since you read them. Reload and try again.');
        }
        const keys = changedKeys(current?.value, input.values);
        if (current && keys.length === 0) return { keys, version: current.version };
        const version = (current?.version ?? 0) + 1;
        if (current) {
          await tx
            .update(setting)
            .set({ value: input.values, version, updatedBy, updatedAt: new Date() })
            .where(eq(setting.moduleId, moduleId));
        } else {
          const inserted = await tx
            .insert(setting)
            .values({ moduleId, value: input.values, version, updatedBy })
            .onConflictDoNothing()
            .returning({ moduleId: setting.moduleId });
          // Another writer saved the first version between our read and our insert.
          if (inserted.length === 0) {
            throw new Conflict('The settings changed since you read them. Reload and try again.');
          }
        }
        if (keys.length > 0) {
          await ctx.events.emit('settings.changed@1', { module: moduleId, keys, version });
        }
        return { keys, version };
      });
      if (result.keys.length > 0) invalidate(moduleId);
      return view(moduleId);
    },
  };
}
