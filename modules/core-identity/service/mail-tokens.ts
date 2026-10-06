// Tokens that travel by mail (ADR 0012, ADR 0026): a password reset, the confirmation of an address
// and the confirmation of linking a sign-in provider.
// 256 random bits, kept only as a SHA-256 hash (the secret has full entropy, so a slow hash adds
// nothing), single use, short-lived. A new token for the same user and purpose ends the older one.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { ids, type DbTx } from '@scorpion/kernel';
import { mailToken, type MailTokenPurpose } from '../db/schema.ts';

/** A reset link authenticates, so it is an out-of-band request with the 10 minutes of ASVS 6.5.5 (ADR 0026). */
export const RESET_TTL_MS = 10 * 60 * 1000;
/** A verification link only confirms an address and authenticates nobody: 24 hours (ADR 0026, section 3). */
export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/** Linking a provider adds a way to sign in, so it is as short as the reset link. */
export const OIDC_LINK_TTL_MS = 10 * 60 * 1000;

/** `srt_` (reset), `sev_` (verification) or `sol_` (link) and 43 base64url characters. Not an access token. */
const MARK: Record<MailTokenPurpose, string> = {
  'password-reset': 'srt_',
  'email-verification': 'sev_',
  'oidc-link': 'sol_',
};
const SHAPE = /^(srt|sev|sol)_[A-Za-z0-9_-]{43}$/;

export const hashMailToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function newMailToken(purpose: MailTokenPurpose): string {
  return `${MARK[purpose]}${randomBytes(32).toString('base64url')}`;
}

/** Whether a string could be a token for this purpose. Checked before the database is asked. */
export function isMailTokenShape(token: string, purpose: MailTokenPurpose): boolean {
  return SHAPE.test(token) && token.startsWith(MARK[purpose]);
}

export interface ClaimedToken {
  id: string;
  userId: string;
  email: string | null;
  /** `oidc-link` only. */
  provider: string | null;
  subject: string | null;
}

type Reader = Pick<DbTx, 'select'>;

/**
 * Stores a new token and ends the outstanding ones of the same user and purpose. Returns the
 * secret, which exists only here and in the mail.
 */
export async function issueMailToken(
  tx: Pick<DbTx, 'insert' | 'delete'>,
  options: {
    userId: string;
    purpose: MailTokenPurpose;
    email?: string;
    /** `oidc-link`: the identity to link. */
    identity?: { provider: string; subject: string };
    ttlMs: number;
    now: Date;
  },
): Promise<string> {
  const { userId, purpose, now } = options;
  await tx
    .delete(mailToken)
    .where(
      and(eq(mailToken.userId, userId), eq(mailToken.purpose, purpose), isNull(mailToken.usedAt)),
    );
  const token = newMailToken(purpose);
  await tx.insert(mailToken).values({
    id: ids.uuidv7(),
    userId,
    purpose,
    secretHash: hashMailToken(token),
    email: purpose === 'email-verification' ? (options.email ?? null) : null,
    provider: purpose === 'oidc-link' ? (options.identity?.provider ?? null) : null,
    subject: purpose === 'oidc-link' ? (options.identity?.subject ?? null) : null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + options.ttlMs),
  });
  return token;
}

/** The live token, without using it. For the cheap refusal before an expensive hash. */
export async function peekMailToken(
  tx: Reader,
  token: string,
  purpose: MailTokenPurpose,
  now: Date,
): Promise<ClaimedToken | undefined> {
  if (!isMailTokenShape(token, purpose)) return undefined;
  const hash = hashMailToken(token);
  const [row] = await tx
    .select({
      id: mailToken.id,
      userId: mailToken.userId,
      email: mailToken.email,
      provider: mailToken.provider,
      subject: mailToken.subject,
      secretHash: mailToken.secretHash,
    })
    .from(mailToken)
    .where(
      and(
        eq(mailToken.secretHash, hash),
        eq(mailToken.purpose, purpose),
        isNull(mailToken.usedAt),
        gt(mailToken.expiresAt, now),
      ),
    )
    .limit(1);
  // The index found it by hash; the comparison is repeated in constant time anyway.
  if (!row || !equal(row.secretHash, hash)) return undefined;
  return {
    id: row.id,
    userId: row.userId,
    email: row.email,
    provider: row.provider,
    subject: row.subject,
  };
}

/**
 * Uses the token: one update that only succeeds for a live, unused token, so two requests with
 * the same link cannot both win. Unknown, used, expired and wrong-purpose tokens are the same
 * `undefined`. Call it inside the transaction that does what the token allows.
 */
export async function claimMailToken(
  tx: Pick<DbTx, 'update'>,
  token: string,
  purpose: MailTokenPurpose,
  now: Date,
  /** Only a token of this user: another user's token is left unused and answers like an unknown one. */
  userId?: string,
): Promise<ClaimedToken | undefined> {
  if (!isMailTokenShape(token, purpose)) return undefined;
  const [row] = await tx
    .update(mailToken)
    .set({ usedAt: now })
    .where(
      and(
        eq(mailToken.secretHash, hashMailToken(token)),
        eq(mailToken.purpose, purpose),
        isNull(mailToken.usedAt),
        gt(mailToken.expiresAt, now),
        userId === undefined ? undefined : eq(mailToken.userId, userId),
      ),
    )
    .returning({
      id: mailToken.id,
      userId: mailToken.userId,
      email: mailToken.email,
      provider: mailToken.provider,
      subject: mailToken.subject,
    });
  return row;
}

/** Ends every outstanding token of a user for one purpose (after a reset or a password change). */
export async function endMailTokens(
  tx: Pick<DbTx, 'delete'>,
  userId: string,
  purpose: MailTokenPurpose,
): Promise<void> {
  await tx
    .delete(mailToken)
    .where(and(eq(mailToken.userId, userId), eq(mailToken.purpose, purpose)));
}

/** The address a user has asked to change to and not yet confirmed, if any. */
export async function pendingVerificationEmail(
  tx: Reader,
  userId: string,
  currentEmail: string | null,
  now: Date,
): Promise<string | null> {
  const [row] = await tx
    .select({ email: mailToken.email })
    .from(mailToken)
    .where(
      and(
        eq(mailToken.userId, userId),
        eq(mailToken.purpose, 'email-verification'),
        isNull(mailToken.usedAt),
        gt(mailToken.expiresAt, now),
        currentEmail === null
          ? sql`true`
          : ne(sql`lower(${mailToken.email})`, currentEmail.toLowerCase()),
      ),
    )
    .limit(1);
  return row?.email ?? null;
}

/** Deletes used and expired tokens; returns how many. For the cleanup job. */
export async function deleteSpentMailTokens(tx: Pick<DbTx, 'delete'>, now: Date): Promise<number> {
  const gone = await tx
    .delete(mailToken)
    .where(or(lt(mailToken.expiresAt, now), sql`${mailToken.usedAt} is not null`))
    .returning({ id: mailToken.id });
  return gone.length;
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
