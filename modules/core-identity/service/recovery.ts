// Getting back into an account and proving an address: password reset, password change and email
// verification (ADR 0012). Everything that changes data goes through here.
//
// Rules that hold for every method:
// - The request routes (`requestReset`, resend) answer the same whether or not the address is known
//   or may use the feature, and never say what they did.
// - A token that is unknown, used, expired, of the wrong kind or for an account that cannot use it
//   is one 400, so a link says nothing about the account behind it.
// - The token is in the mail only: not in a response, an event, an error or a log line. The mail is
//   stored in the transaction that stores the token (core.notifications, ADR 0019), so a rollback
//   sends nothing and the request never waits for a relay: it only inserts a row.
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { Conflict, Forbidden, Invalid, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import { createRateLimiter, type DbTx, type ModuleContext } from '@scorpion/kernel';
import type { ZodError } from 'zod';
import { authMethod, mailToken, user } from '../db/schema.ts';
import {
  changePasswordInput,
  resetConfirmInput,
  resetRequestInput,
  verifyEmailInput,
} from '../validation.ts';
import {
  claimMailToken,
  endMailTokens,
  issueMailToken,
  peekMailToken,
  RESET_TTL_MS,
  VERIFICATION_TTL_MS,
} from './mail-tokens.ts';
import type { IdentityMail } from './identity-mail.ts';
import type { MailBudget } from './mail-budget.ts';
import type { MailLinks } from './mail-links.ts';
import { TooManyRequests } from './errors.ts';
import { BadRequest } from './oidc-errors.ts';
import { hashPassword, verifyPassword } from './password.ts';
import type { PasswordPolicy } from './password-policy.ts';
import type { LoginThrottle } from './login-throttle.ts';
import { requireSession } from './require-user.ts';
import type { SessionService } from './sessions.ts';
import { budgetLimit, type IdentitySettings } from './settings.ts';

export interface RecoveryService {
  /**
   * Mails a reset link to the account behind the address, when there is one that can use a
   * password. Resolves the same way in every case (also when the address is unknown, the account
   * cannot use a password, or the address has had its mails for the hour). 403 when local accounts
   * are off, 422 for a malformed address. `locale` in the input is the language of the mail
   * (checked against the shipped list); it is optional.
   */
  requestReset(input: unknown, now?: Date): Promise<void>;
  /**
   * Sets a new password with a mailed token, ends every session of the user and every outstanding
   * reset link. 400 for any token that is not good, 422 for a weak password, 403 when local
   * accounts are off.
   */
  confirmReset(input: unknown, now?: Date): Promise<void>;
  /**
   * The caller changes their own password: the current one must match. Ends every session of the
   * caller, this one included, and every outstanding reset link. Session callers only.
   */
  changePassword(actor: Actor, input: unknown): Promise<void>;
  /**
   * Stores a verification token for `email` and queues the mail to that address, in one
   * transaction. `send: false` stores the token without a mail (a change to an address another
   * account holds: the caller must not be able to tell); so does an address whose mail budget is
   * spent. A failure to store throws, and nothing is stored.
   */
  startVerification(userId: string, email: string, options?: VerificationOptions): Promise<void>;
  /**
   * The same inside the caller's transaction `tx`, so the token, the mail and whatever else the
   * caller writes commit together or not at all (register, an address change).
   */
  startVerificationIn(
    tx: DbTx,
    userId: string,
    email: string,
    options?: VerificationOptions,
  ): Promise<void>;
  /** Mails a fresh link for the caller's own address. 409 when it is already confirmed. */
  resendVerification(actor: Actor, now?: Date): Promise<void>;
  /** Confirms the address a token was sent to. 400 for any token that is not good. */
  confirmEmail(input: unknown, now?: Date): Promise<void>;
}

export interface VerificationOptions {
  send?: boolean;
  now?: Date;
  /** The language of the mail: a request's, or a user's preference. Else the instance default. */
  locale?: string;
  /** The budget was spent already for this address by the caller (registration spends it once for both paths). */
  budgetSpent?: boolean;
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

const LINK_PROBLEM = 'This link is not valid or has expired. Ask for a new one.';

function isUniqueViolation(error: unknown): boolean {
  const code = (e: unknown) => (e as { code?: unknown } | null | undefined)?.code;
  return code(error) === '23505' || code((error as { cause?: unknown } | null)?.cause) === '23505';
}

export function createRecoveryService(
  ctx: ModuleContext,
  deps: {
    sessions: SessionService;
    settings: IdentitySettings;
    mail: IdentityMail;
    budget: MailBudget;
    links: MailLinks;
    authz: AuthzService;
    policy: PasswordPolicy;
    throttle: LoginThrottle;
  },
): RecoveryService {
  const { sessions, settings, mail, budget, links, authz, policy, throttle } = deps;
  const limiter = createRateLimiter(ctx.db);
  const mayMail = (address: string) => budget.spend(address);

  /** The account that may use a password: active, not deleted, with a password method. */
  async function passwordAccountByEmail(email: string) {
    const [row] = await ctx.db
      .select({ id: user.id, username: user.username, email: user.email })
      .from(user)
      .innerJoin(authMethod, and(eq(authMethod.userId, user.id), eq(authMethod.provider, 'local')))
      .where(
        and(
          sql`lower(${user.email}) = lower(${email})`,
          eq(user.status, 'active'),
          isNull(user.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  async function requireLocalAccounts(what: string) {
    const { localAccounts } = await settings.get();
    if (!localAccounts) throw new Forbidden(`${what} with a password is turned off.`);
  }

  async function startVerificationIn(
    tx: DbTx,
    userId: string,
    email: string,
    options: VerificationOptions = {},
  ): Promise<void> {
    const { send = true, now = new Date(), locale, budgetSpent } = options;
    const token = await issueMailToken(tx, {
      userId,
      purpose: 'email-verification',
      email,
      ttlMs: VERIFICATION_TTL_MS,
      now,
    });
    if (send && (budgetSpent ?? (await mayMail(email)))) {
      await mail.send(
        tx,
        'identity.email-verification',
        { verifyUrl: links.verify(token), validForHours: VERIFICATION_TTL_MS / 3_600_000 },
        { address: email, userId },
        locale,
      );
    }
  }

  async function startVerification(
    userId: string,
    email: string,
    options: VerificationOptions = {},
  ): Promise<void> {
    await ctx.db.tx((tx) => startVerificationIn(tx, userId, email, options));
  }

  return {
    async requestReset(input, now = new Date()) {
      await requireLocalAccounts('Resetting a password');
      const parsed = resetRequestInput.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error);
      const { email, locale } = parsed.data;

      // The budget is spent for every address, known or not, so it says nothing either.
      const allowed = await mayMail(email);
      const account = await passwordAccountByEmail(email);
      if (!allowed || !account) return;

      // The token, the mail and the event are one transaction. The mail is queued before the event
      // so a failing outbox rolls the mail back too (a test proves it).
      await ctx.db.tx(async (tx) => {
        const token = await issueMailToken(tx, {
          userId: account.id,
          purpose: 'password-reset',
          ttlMs: RESET_TTL_MS,
          now,
        });
        await mail.send(
          tx,
          'identity.password-reset',
          { resetUrl: links.reset(token), validForMinutes: RESET_TTL_MS / 60_000 },
          { address: email, userId: account.id },
          locale,
        );
        await ctx.events.emit('identity.password.resetRequested@1', {
          userId: account.id,
          username: account.username,
        });
      });
    },

    async confirmReset(input, now = new Date()) {
      await requireLocalAccounts('Resetting a password');
      const parsed = resetConfirmInput.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error);
      const { token, password } = parsed.data;

      // A bad link is refused before the expensive hash is made.
      const peeked = await peekMailToken(ctx.db, token, 'password-reset', now);
      if (!peeked) throw new BadRequest(LINK_PROBLEM);
      // The rules of a new password, with the names of the account the link belongs to. A refused
      // password is a 422 and leaves the link usable: nothing is claimed yet.
      const [owner] = await ctx.db
        .select({ username: user.username, email: user.email })
        .from(user)
        .where(eq(user.id, peeked.userId))
        .limit(1);
      await policy.check(password, owner, 'password');
      const passwordHash = await hashPassword(password);

      const userId = await ctx.db.tx(async (tx) => {
        const claimed = await claimMailToken(tx, token, 'password-reset', now);
        if (!claimed) throw new BadRequest(LINK_PROBLEM);
        const [account] = await tx
          .select({ id: user.id, username: user.username })
          .from(user)
          .where(
            and(eq(user.id, claimed.userId), eq(user.status, 'active'), isNull(user.deletedAt)),
          )
          .limit(1);
        const changed = account
          ? await tx
              .update(authMethod)
              .set({ passwordHash })
              .where(and(eq(authMethod.userId, claimed.userId), eq(authMethod.provider, 'local')))
              .returning({ id: authMethod.id })
          : [];
        // The account may have changed since the mail went out: nothing to reset any more.
        if (!account || changed.length === 0) throw new BadRequest(LINK_PROBLEM);

        await endMailTokens(tx, account.id, 'password-reset');
        await sessions.revokeAll(account.id, tx);
        await ctx.events.emit('identity.password.reset@1', {
          userId: account.id,
          username: account.username,
        });
        return account.id;
      });
      await sessions.revokeAll(userId);
    },

    async changePassword(actor, input) {
      const { userId, username } = requireSession(actor, 'Changing the password');
      await authz.require(actor, 'core.identity.password.change');
      await requireLocalAccounts('Changing the password');
      const parsed = changePasswordInput.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error);
      const { currentPassword, newPassword } = parsed.data;

      const [method] = await ctx.db
        .select({ passwordHash: authMethod.passwordHash })
        .from(authMethod)
        .where(and(eq(authMethod.userId, userId), eq(authMethod.provider, 'local')))
        .limit(1);
      const currentHash = method?.passwordHash;
      if (!currentHash) throw new Conflict('This account has no password to change.');
      // Guessing the current password through a stolen session is throttled like guessing it at login.
      await throttle.assertOpen(username, undefined);
      if (!(await verifyPassword(currentHash, currentPassword))) {
        await throttle.recordFailure(username, undefined);
        throw new Invalid('The request is not valid.', [
          { path: 'currentPassword', message: 'is not your current password' },
        ]);
      }
      const [owner] = await ctx.db
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      await policy.check(newPassword, { username, email: owner?.email }, 'newPassword');
      const passwordHash = await hashPassword(newPassword);

      await ctx.db.tx(async (tx) => {
        const changed = await tx
          .update(authMethod)
          .set({ passwordHash })
          .where(
            and(
              eq(authMethod.userId, userId),
              eq(authMethod.provider, 'local'),
              // Another change went through while this one hashed: this one loses.
              eq(authMethod.passwordHash, currentHash),
            ),
          )
          .returning({ id: authMethod.id });
        if (changed.length === 0) throw new Conflict('The password changed in the meantime.');
        await endMailTokens(tx, userId, 'password-reset');
        await throttle.reset(tx, username, undefined);
        await sessions.revokeAll(userId, tx);
        await ctx.events.emit('identity.password.changed@1', { userId, username });
      });
      await sessions.revokeAll(userId);
    },

    startVerification,
    startVerificationIn,

    async resendVerification(actor, now = new Date()) {
      const { userId } = requireSession(actor, 'Asking for a confirmation mail');
      await authz.require(actor, 'core.identity.email.verify');
      const [account] = await ctx.db
        .select({ email: user.email, verifiedAt: user.emailVerifiedAt })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      if (!account?.email) throw new Conflict('This account has no email address.');
      const { mailBudgets } = await settings.get();
      const budget = await limiter.consume(
        `identity.verify:${userId}`,
        budgetLimit(mailBudgets.perUser),
      );
      if (!budget.allowed)
        throw new TooManyRequests('Too many confirmation mails. Try again later.');
      // The address to confirm: a new one that is waiting, else the current one.
      const [waiting] = await ctx.db
        .select({ email: mailToken.email })
        .from(mailToken)
        .where(
          and(
            eq(mailToken.userId, userId),
            eq(mailToken.purpose, 'email-verification'),
            isNull(mailToken.usedAt),
            gt(mailToken.expiresAt, now),
          ),
        )
        .orderBy(desc(mailToken.createdAt))
        .limit(1);
      if (!waiting && account.verifiedAt !== null) {
        throw new Conflict('This email address is already confirmed.');
      }
      await startVerification(userId, waiting?.email ?? account.email, {
        now,
        locale: await mail.preferredLocale(userId),
      });
    },

    async confirmEmail(input, now = new Date()) {
      const parsed = verifyEmailInput.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error);
      const { token } = parsed.data;

      if (!(await peekMailToken(ctx.db, token, 'email-verification', now))) {
        throw new BadRequest(LINK_PROBLEM);
      }
      try {
        await ctx.db.tx(async (tx) => {
          const claimed = await claimMailToken(tx, token, 'email-verification', now);
          if (!claimed?.email) throw new BadRequest(LINK_PROBLEM);
          const [account] = await tx
            .select({ id: user.id, username: user.username, status: user.status })
            .from(user)
            .where(and(eq(user.id, claimed.userId), isNull(user.deletedAt)))
            .limit(1);
          if (!account || account.status === 'rejected') throw new BadRequest(LINK_PROBLEM);
          // The address may have been taken by another account since the mail went out.
          const [taken] = await tx
            .select({ id: user.id })
            .from(user)
            .where(
              and(sql`lower(${user.email}) = lower(${claimed.email})`, ne(user.id, account.id)),
            )
            .limit(1);
          if (taken) throw new BadRequest(LINK_PROBLEM);

          await tx
            .update(user)
            .set({ email: claimed.email, emailVerifiedAt: now, updatedAt: sql`now()` })
            .where(eq(user.id, account.id));
          await endMailTokens(tx, account.id, 'email-verification');
          await ctx.events.emit('identity.email.verified@1', {
            userId: account.id,
            username: account.username,
          });
        });
      } catch (error) {
        // The unique index on verified addresses decided a race.
        if (isUniqueViolation(error)) throw new BadRequest(LINK_PROBLEM);
        throw error;
      }
    },
  };
}
