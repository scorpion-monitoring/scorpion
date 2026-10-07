// Adds an identity at a provider to an account: the one write that both ways of linking use, the
// profile (signed in, after a recent authentication) and the confirmation of the mail (ADR 0026).
import { and, eq } from 'drizzle-orm';
import { Conflict } from '@scorpion/contracts';
import { ids, type DbTx, type ModuleContext } from '@scorpion/kernel';
import { authMethod } from '../db/schema.ts';

export type LinkedVia = 'email' | 'profile';

/**
 * Inserts the auth method and emits `identity.authMethod.linked@1`, in the caller's transaction. 409
 * when the identity belongs to an account already, or the account already has a sign-in at that
 * provider.
 */
export async function addIdentityIn(
  ctx: ModuleContext,
  tx: DbTx,
  account: { id: string; username: string },
  provider: string,
  subject: string,
  via: LinkedVia,
): Promise<void> {
  const [sameSubject] = await tx
    .select({ id: authMethod.id })
    .from(authMethod)
    .where(and(eq(authMethod.provider, provider), eq(authMethod.subject, subject)))
    .limit(1);
  const [sameProvider] = await tx
    .select({ id: authMethod.id })
    .from(authMethod)
    .where(and(eq(authMethod.userId, account.id), eq(authMethod.provider, provider)))
    .limit(1);
  if (sameSubject || sameProvider) {
    throw new Conflict('This sign-in is already linked to an account.');
  }
  await tx.insert(authMethod).values({ id: ids.uuidv7(), userId: account.id, provider, subject });
  await ctx.events.emit('identity.authMethod.linked@1', {
    userId: account.id,
    username: account.username,
    provider,
    via,
  });
}
