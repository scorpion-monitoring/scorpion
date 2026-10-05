// User preferences: per-user key/value pairs whose keys and value schemas modules register in
// `settings.userPreference`. A caller reads and writes their own and nobody else's: no method takes
// a user id, the owner is always the actor (CLAUDE.md "check permissions twice").
import { Invalid, NotFound, Unauthorized, type Actor, type UserActor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import { ids, KernelStartupError, type ModuleContext } from '@scorpion/kernel';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { userPreference } from '../db/schema.ts';
import { PERMISSION_PREFERENCE_READ, PERMISSION_PREFERENCE_WRITE } from './permissions.ts';
import { fieldProblems } from './settings.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const USER_PREFERENCE_REGISTRY = 'settings.userPreference';

/** `core.ui.theme`: dot-separated lower-case segments. By convention it starts with the module's id. */
export const PREFERENCE_KEY = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
/** The largest stored value, as JSON. */
export const MAX_PREFERENCE_BYTES = 8 * 1024;

export const userPreferenceEntrySchema = z.strictObject({
  key: z.string().max(128).regex(PREFERENCE_KEY, 'must be dot-separated lower-case segments'),
  description: z.string().min(1),
  /** Validates the value of this preference. */
  schema: z.custom<z.ZodType>((value) => value instanceof z.ZodType, 'expected a Zod schema'),
});
export type UserPreferenceEntry = z.infer<typeof userPreferenceEntrySchema>;

export interface PreferenceView {
  key: string;
  value: unknown;
  updatedAt: Date;
}

export interface PreferencesService {
  /** Needs `core.settings.preference.read`. Your own stored preferences, by key. */
  list(actor: Actor): Promise<PreferenceView[]>;
  /** Needs `core.settings.preference.write`. `NotFound` for an unregistered key, `Invalid` for a bad value. */
  set(actor: Actor, key: string, value: unknown): Promise<PreferenceView>;
  /** Needs `core.settings.preference.write`. Back to the default; also when nothing was stored. */
  remove(actor: Actor, key: string): Promise<void>;
  /**
   * For trusted code that acts for a user with no human caller (a mail in their language): the
   * stored value of one preference of `userId`, or `undefined` when none is stored, the key is not
   * registered, the id is not a UUID, or the stored value no longer passes the key's schema. Checks
   * no permission and no route calls it (ADR 0015).
   */
  getForUser(userId: string, key: string): Promise<unknown>;
}

export function createPreferencesService(
  ctx: ModuleContext,
  deps: { authz: Pick<AuthzService, 'require'> },
): PreferencesService {
  const definitions = new Map<string, UserPreferenceEntry>();
  for (const raw of ctx.registry(USER_PREFERENCE_REGISTRY)) {
    const entry = userPreferenceEntrySchema.parse(raw);
    if (definitions.has(entry.key)) {
      throw new KernelStartupError('Cannot start core.settings:', [
        `the user preference "${entry.key}" is registered twice`,
      ]);
    }
    definitions.set(entry.key, entry);
  }

  function owner(actor: Actor): UserActor {
    if (actor.kind !== 'user') throw new Unauthorized();
    return actor;
  }

  function definition(key: string): UserPreferenceEntry {
    const found = definitions.get(key);
    if (!found) throw new NotFound(`There is no preference "${key.slice(0, 128)}".`);
    return found;
  }

  return {
    async list(actor) {
      await deps.authz.require(actor, PERMISSION_PREFERENCE_READ);
      const { userId } = owner(actor);
      const rows = await ctx.db
        .select()
        .from(userPreference)
        .where(eq(userPreference.userId, userId))
        .orderBy(asc(userPreference.key));
      // A preference whose registration is gone (its module left the profile) is not shown.
      return rows
        .filter((row) => definitions.has(row.key))
        .map((row) => ({ key: row.key, value: row.value, updatedAt: row.updatedAt }));
    },

    async set(actor, key, value) {
      await deps.authz.require(actor, PERMISSION_PREFERENCE_WRITE);
      const { userId } = owner(actor);
      const parsed = definition(key).schema.safeParse(value);
      if (!parsed.success) {
        throw new Invalid('The preference is not valid.', fieldProblems(parsed.error, 'value'));
      }
      const stored: unknown = parsed.data;
      if (stored === null || stored === undefined) {
        throw new Invalid('The preference is not valid.', [
          { path: 'value', message: 'Must not be null; remove the preference to use its default.' },
        ]);
      }
      if (JSON.stringify(stored).length > MAX_PREFERENCE_BYTES) {
        throw new Invalid('The preference is not valid.', [
          { path: 'value', message: `Must be at most ${MAX_PREFERENCE_BYTES} bytes as JSON.` },
        ]);
      }
      const now = new Date();
      await ctx.db.tx(async (tx) => {
        await tx
          .insert(userPreference)
          .values({ id: ids.uuidv7(), userId, key, value: stored, updatedAt: now })
          .onConflictDoUpdate({
            target: [userPreference.userId, userPreference.key],
            set: { value: sql`excluded.value`, updatedAt: now },
          });
        // Which preference, never what it was set to.
        await ctx.events.emit('settings.preference.changed@1', { userId, key, removed: false });
      });
      return { key, value: stored, updatedAt: now };
    },

    async getForUser(userId, key) {
      const entry = definitions.get(key);
      if (!entry || !UUID.test(userId)) return undefined;
      const [row] = await ctx.db
        .select({ value: userPreference.value })
        .from(userPreference)
        .where(and(eq(userPreference.userId, userId.toLowerCase()), eq(userPreference.key, key)))
        .limit(1);
      if (!row) return undefined;
      const parsed = entry.schema.safeParse(row.value);
      return parsed.success ? (parsed.data as unknown) : undefined;
    },

    async remove(actor, key) {
      await deps.authz.require(actor, PERMISSION_PREFERENCE_WRITE);
      const { userId } = owner(actor);
      definition(key);
      await ctx.db.tx(async (tx) => {
        const removed = await tx
          .delete(userPreference)
          .where(and(eq(userPreference.userId, userId), eq(userPreference.key, key)))
          .returning({ id: userPreference.id });
        if (removed.length > 0) {
          await ctx.events.emit('settings.preference.changed@1', { userId, key, removed: true });
        }
      });
    },
  };
}
