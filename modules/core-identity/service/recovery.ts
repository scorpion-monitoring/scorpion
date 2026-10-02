// Getting back into an account and proving an address: password reset, password change and email
// verification (ADR 0012). Everything that changes data goes through here.
//
// Rules that hold for every method:
// - The request routes (`requestReset`, resend) answer the same whether or not the address is known
//   or may use the feature, and never say what they did.
// - A token that is unknown, used, expired, of the wrong kind or for an account that cannot use it
//   is one 400, so a link says nothing about the account behind it.
// - The token is in the mail only: not in a response, an event, an error or a log line. A mail is
//   sent after the transaction that stores its token has committed, and without making the caller
//   wait for the transport.
import { createHash } from 'node:crypto';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { Conflict, Forbidden, Invalid, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import { createRateLimiter, type ModuleContext } from '@scorpion/kernel';
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
import { resetMail, verificationMail, type MailContext } from './mail-messages.ts';
import { dispatch, type Mail, type Mailer } from './mailer.ts';
import { TooManyRequests } from './errors.ts';
import { BadRequest } from './oidc-errors.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { requireSession } from './require-user.ts';
import type { SessionService } from './sessions.ts';
import {
  budgetLimit,
  DEFAULT_INSTANCE_NAME,
  DEFAULT_MAIL_FROM,
  type IdentitySettings,
} from './settings.ts';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export interface RecoveryService {
  /**
   * Mails a reset link to the account behind the address, when there is one that can use a
   * password. Resolves the same way in every case (also when the address is unknown, the account
   * cannot use a password, or the address has had its mails for the hour). 403 when local accounts
   * are off, 422 for a malformed address.
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
   * Stores a verification token for `email` and mails it to that address. `send: false` stores the
   * token without a mail (a change to an address another account holds: the caller must not be
   * able to tell). Never throws: a failure is logged, because registration and profile edits
   * must not fail for it.
   */
  startVerification(
    userId: string,
    email: string,
    options?: { send?: boolean; now?: Date },
  ): Promise<void>;
  /** Mails a fresh link for the caller's own address. 409 when it is already confirmed. */
  resendVerification(actor: Actor, now?: Date): Promise<void>;
  /** Confirms the address a token was sent to. 400 for any token that is not good. */
  confirmEmail(input: unknown, now?: Date): Promise<void>;
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
    mailer: Mailer;
    authz: AuthzService;
  },
): RecoveryService {
  const { sessions, settings, mailer, authz } = deps;
  const limiter = createRateLimiter(ctx.db);

  async function mailContext(): Promise<MailContext> {
    const { instanceName, mailFrom } = await settings.get();
    return {
      config: ctx.config,
      instanceName: instanceName ?? DEFAULT_INSTANCE_NAME,
      from: mailFrom ?? DEFAULT_MAIL_FROM,
    };
  }

  /** Spends one mail from an address's budget; false when it has had its share. */
  async function mayMail(address: string): Promise<boolean> {
    const { mailBudgets } = await settings.get();
    const decision = await limiter.consume(
      `identity.mail:${sha256(address.toLowerCase())}`,
      budgetLimit(mailBudgets.perAddress),
    );
    return decision.allowed;
  }

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

  /**
   * After the commit: the mail is handed to the transport and nobody waits for the transport. The
   * settings are read first, so the caller sees the same work whether or not it sends.
   */
  async function send(build: (context: MailContext) => Mail): Promise<void> {
    const context = await mailContext();
    void dispatch(mailer, ctx.log, build(context));
  }

  async function startVerification(
    userId: string,
    email: string,
    options: { send?: boolean; now?: Date } = {},
  ): Promise<void> {
    const { send: mail = true, now = new Date() } = options;
    try {
      const token = await ctx.db.tx((tx) =>
        issueMailToken(tx, {
          userId,
          purpose: 'email-verification',
          email,
          ttlMs: VERIFICATION_TTL_MS,
          now,
        }),
      );
      if (mail && (await mayMail(email))) {
        await send((context) => verificationMail(context, email, token));
      }
    } catch (error) {
      ctx.log.error({ err: error, userId }, 'could not start the verification of an address');
    }
  }

  return {
    async requestReset(input, now = new Date()) {
      await requireLocalAccounts('Resetting a password');
      const parsed = resetRequestInput.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error);
      const { email } = parsed.data;

      // The budget is spent for every address, known or not, so it says nothing either.
      const allowed = await mayMail(email);
      const account = await passwordAccountByEmail(email);
      if (!allowed || !account) return;

      const token = await ctx.db.tx(async (tx) => {
        const issued = await issueMailToken(tx, {
          userId: account.id,
          purpose: 'password-reset',
          ttlMs: RESET_TTL_MS,
          now,
        });
        await ctx.events.emit('identity.password.resetRequested@1', {
          userId: account.id,
          username: account.username,
        });
        return issued;
      });
      await send((context) => resetMail(context, email, token));
    },

    async confirmReset(input, now = new Date()) {
      await requireLocalAccounts('Resetting a password');
      const parsed = resetConfirmInput.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error);
      const { token, password } = parsed.data;

      // A bad link is refused before the expensive hash is made.
      if (!(await peekMailToken(ctx.db, token, 'password-reset', now))) {
        throw new BadRequest(LINK_PROBLEM);
      }
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
      if (!(await verifyPassword(currentHash, currentPassword))) {
        throw new Invalid('The request is not valid.', [
          { path: 'currentPassword', message: 'is not your current password' },
        ]);
      }
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
        await sessions.revokeAll(userId, tx);
        await ctx.events.emit('identity.password.changed@1', { userId, username });
      });
      await sessions.revokeAll(userId);
    },

    startVerification,

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
      await startVerification(userId, waiting?.email ?? account.email, { now });
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
