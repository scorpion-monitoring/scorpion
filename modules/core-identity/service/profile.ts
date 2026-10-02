// The profile: what a person says about themselves (a display name and a bio) and the address they
// can be reached at. The caller edits their own and nobody else's: there is no id in the input, the
// row is the caller's from the session, and the input accepts no other field. Session callers only.
//
// A changed email address is not applied at once. The old address (confirmed or not) stays until the
// owner opens the link mailed to the new one (ADR 0012); until then the profile shows the new one as
// `pendingEmail`. Asking for an address another account holds looks exactly like asking for a free
// one: the token is stored and the profile shows it as pending, but no mail goes out.
import { and, eq, ne, sql } from 'drizzle-orm';
import { Invalid, NotFound, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import { createRateLimiter, type ModuleContext } from '@scorpion/kernel';
import type { ZodError } from 'zod';
import { user } from '../db/schema.ts';
import { updateProfileInput } from '../validation.ts';
import { TooManyRequests } from './errors.ts';
import { pendingVerificationEmail } from './mail-tokens.ts';
import { MAIL_BUDGET_PER_USER, type RecoveryService } from './recovery.ts';
import { requireSession } from './require-user.ts';

export interface Profile {
  username: string;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  /** An address the owner asked to change to and has not confirmed yet. */
  pendingEmail: string | null;
  bio: string | null;
}

export type ProfileField = 'displayName' | 'bio' | 'email';

export interface ProfileService {
  /** The caller's own profile. */
  get(actor: Actor, now?: Date): Promise<Profile>;
  /**
   * Changes the caller's own display name, bio and (through a confirmation mail) address. 422 for
   * input that breaks the rules or changes nothing, 429 when the caller asks for too many address
   * changes. Returns the profile as it is afterwards.
   */
  update(actor: Actor, input: unknown, now?: Date): Promise<Profile>;
}

function invalid(error: ZodError): Invalid {
  return new Invalid(
    'The request is not valid.',
    error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}

export function createProfileService(
  ctx: ModuleContext,
  deps: { recovery: Pick<RecoveryService, 'startVerification'>; authz: AuthzService },
): ProfileService {
  const { authz } = deps;
  const limiter = createRateLimiter(ctx.db);

  async function load(userId: string, now: Date): Promise<Profile> {
    const [row] = await ctx.db
      .select({
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        verifiedAt: user.emailVerifiedAt,
        bio: user.bio,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!row) throw new NotFound('There is no such user.');
    return {
      username: row.username,
      displayName: row.displayName,
      email: row.email,
      emailVerified: row.verifiedAt !== null,
      pendingEmail: await pendingVerificationEmail(ctx.db, userId, row.email, now),
      bio: row.bio,
    };
  }

  return {
    async get(actor, now = new Date()) {
      const { userId } = requireSession(actor, 'The profile');
      await authz.require(actor, 'core.identity.profile.read');
      return load(userId, now);
    },

    async update(actor, input, now = new Date()) {
      const { userId, username } = requireSession(actor, 'The profile');
      await authz.require(actor, 'core.identity.profile.update');
      const parsed = updateProfileInput.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error);
      const change = parsed.data;

      const before = await load(userId, now);
      const asksForNewAddress =
        change.email !== undefined && change.email.toLowerCase() !== before.email?.toLowerCase();
      if (asksForNewAddress) {
        // A signed-in caller may be told no: this limit is theirs, not an address's.
        const budget = await limiter.consume(`identity.verify:${userId}`, MAIL_BUDGET_PER_USER);
        if (!budget.allowed)
          throw new TooManyRequests('Too many address changes. Try again later.');
      }

      const fields: ProfileField[] = [];
      if (change.displayName !== undefined && change.displayName !== before.displayName) {
        fields.push('displayName');
      }
      if (change.bio !== undefined && change.bio !== before.bio) fields.push('bio');
      if (asksForNewAddress) fields.push('email');
      if (fields.length === 0) return before;

      await ctx.db.tx(async (tx) => {
        if (fields.includes('displayName') || fields.includes('bio')) {
          await tx
            .update(user)
            .set({
              ...(fields.includes('displayName') ? { displayName: change.displayName } : {}),
              ...(fields.includes('bio') ? { bio: change.bio } : {}),
              updatedAt: sql`now()`,
            })
            .where(eq(user.id, userId));
        }
        // Field names only: the values (an address, a bio) are not in an event.
        await ctx.events.emit('identity.profile.updated@1', { userId, username, fields });
      });

      if (asksForNewAddress) {
        const [holder] = await ctx.db
          .select({ id: user.id })
          .from(user)
          .where(and(sql`lower(${user.email}) = lower(${change.email!})`, ne(user.id, userId)))
          .limit(1);
        await deps.recovery.startVerification(userId, change.email!, {
          send: holder === undefined,
          now,
        });
      }
      return load(userId, now);
    },
  };
}
