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
import type { BlobService } from '@scorpion/core-blob/public';
import { createRateLimiter, type ModuleContext } from '@scorpion/kernel';
import type { ZodError } from 'zod';
import { user } from '../db/schema.ts';
import { updateProfileInput } from '../validation.ts';
import { avatarReference } from './avatar-reference.ts';
import { TooManyRequests } from './errors.ts';
import { pendingVerificationEmail } from './mail-tokens.ts';
import type { RecoveryService } from './recovery.ts';
import { budgetLimit, type IdentitySettings } from './settings.ts';
import { requireSession } from './require-user.ts';

export interface Profile {
  username: string;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  /** An address the owner asked to change to and has not confirmed yet. */
  pendingEmail: string | null;
  bio: string | null;
  /** The SHA-256 of the avatar file, shown at `GET /files/{hash}`; `null` without an avatar. */
  avatarHash: string | null;
}

export type ProfileField = 'displayName' | 'bio' | 'email' | 'avatar';

export interface ProfileService {
  /** The caller's own profile. */
  get(actor: Actor, now?: Date): Promise<Profile>;
  /**
   * Changes the caller's own display name, bio and (through a confirmation mail) address. 422 for
   * input that breaks the rules or changes nothing, 429 when the caller asks for too many address
   * changes. Returns the profile as it is afterwards.
   */
  update(actor: Actor, input: unknown, now?: Date): Promise<Profile>;
  /**
   * Sets the caller's own avatar from the bytes of an image. Session callers only, and only their own
   * account: there is no user id in the input. The blob service checks the file and rewrites it
   * (`Invalid` for a file it refuses); this replaces the previous avatar, which is released. Needs
   * `core.identity.avatar.update` and `core.blob.upload`. Uploading the avatar the account already
   * has changes nothing. Returns the profile as it is afterwards.
   */
  setAvatar(actor: Actor, bytes: Uint8Array, now?: Date): Promise<Profile>;
  /** Removes the caller's own avatar (also when there is none). Session callers only. */
  removeAvatar(actor: Actor, now?: Date): Promise<Profile>;
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
  deps: {
    recovery: Pick<RecoveryService, 'startVerification'>;
    authz: AuthzService;
    blob: Pick<BlobService, 'put' | 'describe' | 'setReference'>;
    settings: IdentitySettings;
  },
): ProfileService {
  const { authz, blob, settings } = deps;
  const limiter = createRateLimiter(ctx.db);

  async function load(userId: string, now: Date): Promise<Profile> {
    const [row] = await ctx.db
      .select({
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        verifiedAt: user.emailVerifiedAt,
        bio: user.bio,
        avatarBlobId: user.avatarBlobId,
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
      avatarHash: row.avatarBlobId ? ((await blob.describe(row.avatarBlobId))?.hash ?? null) : null,
    };
  }

  /** Points the account at `blobId` (or at nothing) and the reference with it, in one transaction. */
  async function changeAvatar(userId: string, username: string, blobId: string | null) {
    await ctx.db.tx(async (tx) => {
      const [row] = await tx
        .select({ avatarBlobId: user.avatarBlobId })
        .from(user)
        .where(eq(user.id, userId))
        .for('update');
      if (!row) throw new NotFound('There is no such user.');
      if (row.avatarBlobId === blobId) return;
      await tx
        .update(user)
        .set({ avatarBlobId: blobId, updatedAt: sql`now()` })
        .where(eq(user.id, userId));
      // Released and referenced inside this transaction: a failure leaves both as they were.
      await blob.setReference(avatarReference(userId), blobId);
      await ctx.events.emit('identity.profile.updated@1', { userId, username, fields: ['avatar'] });
    });
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
        const { mailBudgets } = await settings.get();
        const budget = await limiter.consume(
          `identity.verify:${userId}`,
          budgetLimit(mailBudgets.perUser),
        );
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

    async setAvatar(actor, bytes, now = new Date()) {
      const { userId, username } = requireSession(actor, 'The avatar');
      await authz.require(actor, 'core.identity.avatar.update');
      const stored = await blob.put(actor, bytes);
      await changeAvatar(userId, username, stored.id);
      return load(userId, now);
    },

    async removeAvatar(actor, now = new Date()) {
      const { userId, username } = requireSession(actor, 'The avatar');
      await authz.require(actor, 'core.identity.avatar.update');
      await changeAvatar(userId, username, null);
      return load(userId, now);
    },
  };
}
