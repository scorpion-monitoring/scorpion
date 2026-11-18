// The claim of a migrated account (ADR 0053). Trusted code (the legacy migration) creates an account with no way to sign in
// and an open claim: the provider its owner signs in with, the `preferred_username` that provider must send, and an end. The
// owner's first sign-in there, with a subject no account knows, claims it when every one of these holds:
//   - the provider is the claim's;
//   - the provider sent `email_verified: true` and an address equal (without case) to the account's;
//   - the provider's `preferred_username` equals the claim's (without case);
//   - the claim has not expired;
//   - the account is active, not deleted, and has no way to sign in at all (nobody has ever entered it).
// Then the identity is added and the claim deleted in one transaction, and the caller signs the person in. Anything else
// leaves the claim alone and the sign-in takes the mail path of ADR 0026, which links nothing.
//
// This trusts the provider's word for the address and the name, for these accounts only and once. ADR 0053 has the
// reasons; the migration gives such accounts the role `user` only, so a wrong claim never reaches an administrator.
import { and, eq, gt, sql } from 'drizzle-orm';
import type { ModuleContext } from '@scorpion/kernel';
import { accountClaim, authMethod, user } from '../db/schema.ts';
import type { User } from '../public.ts';
import { addIdentityIn } from './identity-link.ts';
import type { IdentityClaims } from './oidc-token.ts';

/** Why a claim did not happen, for the log (never a value). `none`: the account has no claim. */
export type ClaimRefusal =
  | 'none'
  | 'other-provider'
  | 'expired'
  | 'username-differs'
  | 'address-unverified'
  | 'account-unusable'
  | 'account-has-sign-in';

export type ClaimResult = { claimed: true } | { claimed: false; reason: ClaimRefusal };

const same = (a: string | undefined | null, b: string | undefined | null) =>
  a != null && b != null && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Claims `account` for the identity of `claims` at `provider` when every rule above holds. `account` is the holder of the
 * provider's verified address (the caller found it by that address).
 */
export async function claimAccount(
  ctx: ModuleContext,
  account: User,
  provider: string,
  claims: IdentityClaims,
  now: Date = new Date(),
): Promise<ClaimResult> {
  return ctx.db.tx(async (tx) => {
    // Locked, so two sign-ins at once claim once.
    const [open] = await tx
      .select()
      .from(accountClaim)
      .where(eq(accountClaim.userId, account.id))
      .for('update');
    const refuse = (reason: ClaimRefusal): ClaimResult => ({ claimed: false, reason });
    if (!open) return refuse('none');
    if (open.provider !== provider) return refuse('other-provider');
    if (open.expiresAt.getTime() <= now.getTime()) return refuse('expired');
    if (!claims.emailVerified || !same(claims.email, account.email)) {
      return refuse('address-unverified');
    }
    if (!same(claims.preferredUsername, open.username)) return refuse('username-differs');

    const [current] = await tx
      .select({ status: user.status, deletedAt: user.deletedAt })
      .from(user)
      .where(eq(user.id, account.id))
      .for('update');
    if (!current || current.status !== 'active' || current.deletedAt !== null) {
      return refuse('account-unusable');
    }
    const [anySignIn] = await tx
      .select({ id: authMethod.id })
      .from(authMethod)
      .where(eq(authMethod.userId, account.id))
      .limit(1);
    if (anySignIn) return refuse('account-has-sign-in');

    const [used] = await tx
      .delete(accountClaim)
      .where(and(eq(accountClaim.userId, account.id), gt(accountClaim.expiresAt, now)))
      .returning({ userId: accountClaim.userId });
    if (!used) return refuse('expired');
    await addIdentityIn(ctx, tx, account, provider, claims.subject, 'claim');
    // The provider vouched for the address, as at a first sign-in that creates an account.
    await tx
      .update(user)
      .set({ emailVerifiedAt: now, updatedAt: sql`now()` })
      .where(eq(user.id, account.id));
    return { claimed: true };
  });
}
