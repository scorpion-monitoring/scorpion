// Local accounts: register, log in, log out, and who am I. Everything that changes data goes
// through here; the routes only parse, call one method and map the result.
import { and, eq, sql } from 'drizzle-orm';
import { Forbidden, Invalid, Unauthorized, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { ModuleContext } from '@scorpion/kernel';
import type { ZodError } from 'zod';
import { authMethod } from '../db/schema.ts';
import type { User, UserService } from '../public.ts';
import { loginInput, registerInput } from '../validation.ts';
import { APPROVAL_POLICY_REGISTRY, type ApprovalPolicyEntry } from './approval-policy.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { requireUser } from './require-user.ts';
import { grantDefaultRole } from './roles.ts';
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
  /** Creates a password account under the approval policy. 403 when local accounts are off. */
  register(input: unknown): Promise<User>;
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
    recovery: Pick<RecoveryService, 'startVerification'>;
    authz: AuthzService;
  },
): AccountService {
  const { users, sessions, settings, recovery, authz } = deps;

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

  return {
    async register(input) {
      const { localAccounts, approvalPolicy } = await settings.get();
      if (!localAccounts) throw new Forbidden('Registering with a password is turned off.');
      const parsed = registerInput.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error);
      const { username, email, password } = parsed.data;

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

      // The user, its auth method and the event are one write.
      const registered = await ctx.db.tx(async (tx) => {
        const created = await users.createUser({
          username,
          email,
          auth: { provider: 'local', password },
          status: decision.status,
        });
        // A policy that activates at once also gives the default role; otherwise approval does.
        await grantDefaultRole(authz, tx, created);
        await ctx.events.emit('identity.user.registered@1', {
          userId: created.id,
          username: created.username,
          status: created.status,
        });
        return created;
      });
      // The mail that asks the owner to confirm the address goes out after the commit.
      await recovery.startVerification(registered.id, email);
      return registered;
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
