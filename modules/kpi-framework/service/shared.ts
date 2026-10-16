// What the three services share: who acted, which constraint a database error is about, and the IRI base.
import type { Actor } from '@scorpion/contracts';
import { mountPath, type ModuleContext } from '@scorpion/kernel';
import { resolveIriBase } from './iri.ts';
import { settingsSchema } from '../settings-schema.ts';

export const actorId = (actor: Actor): string | null =>
  actor.kind === 'user' ? actor.userId : null;

/** The name of the unique index that a duplicate-key error (23505) is about, looking through wrapped causes. */
export function uniqueViolation(error: unknown): string | undefined {
  for (let e: unknown = error, depth = 0; e && depth < 4; depth++) {
    const err = e as { code?: string; constraint?: string; cause?: unknown };
    if (err.code === '23505' && err.constraint) return err.constraint;
    e = err.cause;
  }
  return undefined;
}

/**
 * The base of the IRIs: the setting `iriBase`, else the origin and base path of this instance. Read for each
 * call (the settings service caches), so a change of the setting is seen at once.
 */
export function iriBaseOf(ctx: Pick<ModuleContext, 'settings' | 'config'>) {
  return async (): Promise<string> =>
    resolveIriBase(settingsSchema.parse(await ctx.settings.get()).iriBase, {
      origin: ctx.config.ORIGIN,
      basePath: mountPath(ctx.config),
    });
}
