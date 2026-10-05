// Local accounts: register, log in, log out, and who am I. Everything that changes data goes
// through here; the routes only parse, call one method and map the result.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Conflict, Forbidden, Invalid, Unauthorized, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { DbTx, ModuleContext } from '@scorpion/kernel';
import type { ZodError } from 'zod';
import { authMethod, user } from '../db/schema.ts';
import type { User, UserService } from '../public.ts';
import { loginInput, registerInput } from '../validation.ts';
import { APPROVAL_POLICY_REGISTRY, type ApprovalPolicyEntry } from './approval-policy.ts';
import type { IdentityMail } from './identity-mail.ts';
import type { MailBudget } from './mail-budget.ts';
import type { MailLinks } from './mail-links.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { requireUser } from './require-user.ts';
import { ADMIN_ROLE, grantDefaultRole } from './roles.ts';
import { csrfTokenFor } from './session-id.ts';
import type { RecoveryService } from './recovery.ts';
import type { SessionService } from './sessions.ts';
import type { IdentitySettings } from './settings.ts';

export interface LoginResult {
  user: User;
  /** The value for the cookie. */
  sessionId: string;
  expiresAt: Date;
  csrfToken: string;
}

export interface AccountService {
  /**
   * Creates a password account under the approval policy and queues its mails in the same
   * transaction: the welcome mail and the confirmation link for the new person, and (when the
   * account waits for review) one mail to every administrator. 403 when local accounts are off,
   * 409 for a taken **username** (usernames are public).
   *
   * A taken **email address** is not an error and not visible to the caller (register without
   * revealing, M4 decision 4): nothing is created, the owner of the address gets the mail
   * `identity.register-attempt`, and the result is `undefined`. The route answers 202 for both.
   * The address's mail budget is spent on both paths, and so is the password hash, so the two cost
   * about the same.
   */
  register(input: unknown): Promise<User | undefined>;
  /**
   * Checks the password and starts a session. An unknown user and a wrong password answer the same
   * way and cost the same; a pending account is told to wait, a rejected or deleted one is not
   * told anything. `previousSessionId` (the caller's current session, if any) is ended.
   */
  login(input: unknown, previousSessionId?: string): Promise<LoginResult>;
  /** Ends the caller's own session. */
  logout(actor: Actor, sessionId: string | undefined): Promise<void>;
  /** Ends every session of the caller; returns how many were open. */
  logoutAll(actor: Actor): Promise<number>;
  /**
   * The caller's own account, their roles (asked of core.authz every time, never cached here) and
   * the CSRF token of their session when they have one.
   */
  me(
    actor: Actor,
    sessionId: string | undefined,
  ): Promise<{ user: User; roles: string[]; csrfToken: string | null }>;
}

/** The field problems of a Zod error, without ever repeating the value that was sent. */
function invalid(error: ZodError): Invalid {
  return new Invalid(
    'The request is not valid.',
    error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}

export function createAccountService(
  ctx: ModuleContext,
  deps: {
    users: UserService;
    sessions: SessionService;
    settings: IdentitySettings;
    recovery: Pick<RecoveryService, 'startVerificationIn'>;
    mail: IdentityMail;
    budget: MailBudget;
    links: MailLinks;
    authz: AuthzService;
  },
): AccountService {
  const { users, sessions, settings, recovery, mail, budget, links, authz } = deps;

  // A hash to check when there is nobody to check against, so that "no such user" takes as long as
  // "wrong password". Made with the same parameters as the real ones, once, on first use.
  let dummyHash: Promise<string> | undefined;
  const decoy = () => (dummyHash ??= hashPassword('scorpion decoy: nobody has this password'));

  /** The policy named by the setting, from the registry; `undefined` when no module contributes it. */
  function policyFor(id: string): ApprovalPolicyEntry | undefined {
    return (ctx.registry(APPROVAL_POLICY_REGISTRY) as readonly ApprovalPolicyEntry[]).find(
      (entry) => entry.id === id,
    );
  }

  /**
   * The address is taken: tell its owner, create nothing. A pending or active account is told; a
   * rejected (soft-deleted) one is not, because the person it belonged to was refused and a mail
   * saying "you have an account" would mislead. The caller sees no difference.
   */
  async function noticeToOwner(
    holder: User,
    password: string,
    locale: string | undefined,
    mayMailOwner: boolean,
  ): Promise<undefined> {
    // The work the new path spends on hashing the password, so the two paths cost about the same.
    await hashPassword(password);
    if (
      holder.deletedAt !== null ||
      holder.status === 'rejected' ||
      !holder.email ||
      !mayMailOwner
    ) {
      return undefined;
    }
    await ctx.db.tx((tx) =>
      mail.send(
        tx,
        'identity.register-attempt',
        { signInUrl: links.signIn(), forgotPasswordUrl: links.forgotPassword() },
        { address: holder.email!, userId: holder.id },
        locale,
      ),
    );
    return undefined;
  }

  /** One mail to every active administrator who has an address, each in their own language. */
  async function mailAdministrators(tx: DbTx, applicant: User): Promise<void> {
    const adminIds = await authz.listHoldersAsSystem(tx, ADMIN_ROLE);
    if (adminIds.length === 0) return;
    const admins = await tx
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(and(inArray(user.id, adminIds), eq(user.status, 'active'), isNull(user.deletedAt)))
      .orderBy(user.id);
    for (const admin of admins) {
      if (!admin.email) continue;
      await mail.send(
        tx,
        'identity.registration-request',
        {
          applicantUsername: applicant.username,
          applicantEmail: applicant.email ?? '',
          reviewUrl: links.review(),
        },
        { address: admin.email, userId: admin.id },
        await mail.preferredLocale(admin.id),
      );
    }
  }

  return {
    async register(input) {
      const { localAccounts, approvalPolicy } = await settings.get();
      if (!localAccounts) throw new Forbidden('Registering with a password is turned off.');
      const parsed = registerInput.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error);
      const { username, email, password, locale } = parsed.data;

      // Spent on both paths, before anything tells them apart: exhausting it says nothing.
      const mayMailOwner = await budget.spend(email);

      // Usernames are public, so a taken one is a plain 409.
      if (await users.findByUsername(username)) {
        throw new Conflict('This username is already taken.');
      }
      const holder = await users.findByEmail(email);
      if (holder) return noticeToOwner(holder, password, locale, mayMailOwner);

      // A policy that is not installed must not approve anyone: the account waits.
      const policy = policyFor(approvalPolicy);
      if (!policy) {
        ctx.log.warn({ policy: approvalPolicy }, 'the configured approval policy is not installed');
      }
      const decision = (await policy?.decide({
        username,
        email,
        emailVerified: false,
        provider: 'local',
      })) ?? { status: 'pending' as const };

      try {
        // The user, its auth method, its mails and its event are one write. The mails are queued
        // before the event so a failing outbox rolls them back with the rest.
        return await ctx.db.tx(async (tx) => {
          const created = await users.createUser({
            username,
            email,
            auth: { provider: 'local', password },
            status: decision.status,
          });
          // A policy that activates at once also gives the default role; otherwise approval does.
          await grantDefaultRole(authz, tx, created);
          await recovery.startVerificationIn(tx, created.id, email, {
            send: mayMailOwner,
            locale,
            budgetSpent: true,
          });
          if (mayMailOwner) {
            await mail.send(
              tx,
              'identity.welcome',
              {
                username: created.username,
                pendingReview: created.status === 'pending',
                signInUrl: links.signIn(),
              },
              { address: email, userId: created.id },
              locale,
            );
          }
          if (created.status === 'pending') await mailAdministrators(tx, created);
          await ctx.events.emit('identity.user.registered@1', {
            userId: created.id,
            username: created.username,
            status: created.status,
          });
          return created;
        });
      } catch (error) {
        // Two registrations raced and the unique index stopped this one: if the address is now
        // held, this is the taken-address path; a taken username stays a 409.
        if (error instanceof Conflict) {
          const winner = await users.findByEmail(email);
          if (winner && !(await users.findByUsername(username))) {
            return noticeToOwner(winner, password, locale, mayMailOwner);
          }
        }
        throw error;
      }
    },

    async login(input, previousSessionId) {
      const { localAccounts } = await settings.get();
      if (!localAccounts) throw new Forbidden('Signing in with a password is turned off.');
      const parsed = loginInput.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error);
      const { username, password } = parsed.data;

      const found = await users.findByUsername(username);
      const [method] = found
        ? await ctx.db
            .select({ id: authMethod.id, passwordHash: authMethod.passwordHash })
            .from(authMethod)
            .where(and(eq(authMethod.userId, found.id), eq(authMethod.provider, 'local')))
            .limit(1)
        : [];
      const storedHash = method?.passwordHash ?? undefined;

      const passwordOk = await verifyPassword(storedHash ?? (await decoy()), password);
      if (found === undefined || storedHash === undefined || !passwordOk) {
        throw new Unauthorized('The username or password is wrong.');
      }
      if (found.deletedAt !== null || found.status === 'rejected') {
        throw new Unauthorized('The username or password is wrong.');
      }
      if (found.status === 'pending') {
        throw new Forbidden('Your account is waiting for approval.');
      }

      const session = await ctx.db.tx(async (tx) => {
        const created = await sessions.create(found.id, tx);
        await tx
          .update(authMethod)
          .set({ lastLoginAt: sql`now()` })
          .where(eq(authMethod.id, method!.id));
        return created;
      });
      // A new login replaces the session the browser held, so an old id cannot be carried over.
      if (previousSessionId) await sessions.revoke(previousSessionId);

      return {
        user: found,
        sessionId: session.id,
        expiresAt: session.expiresAt,
        csrfToken: csrfTokenFor(session.id),
      };
    },

    async logout(actor, sessionId) {
      requireUser(actor);
      await authz.require(actor, 'core.identity.session.manage');
      if (sessionId !== undefined) await sessions.revoke(sessionId);
    },

    async logoutAll(actor) {
      const { userId } = requireUser(actor);
      await authz.require(actor, 'core.identity.session.manage');
      return sessions.revokeAll(userId);
    },

    async me(actor, sessionId) {
      const { userId } = requireUser(actor);
      const found = await users.findById(userId);
      if (!found) throw new Unauthorized();
      await authz.require(actor, 'core.identity.me.read');
      return {
        user: found,
        roles: await authz.rolesOf(actor, userId),
        csrfToken:
          actor.kind === 'user' && actor.via === 'session' && sessionId
            ? csrfTokenFor(sessionId)
            : null,
      };
    },
  };
}
