// The only file other modules may import. It holds the service interface and nothing else.
import type { Actor } from '@scorpion/contracts';
import type { CreateClaimableUserInput, CreateUserInput } from './validation.ts';

export type UserStatus = 'pending' | 'active' | 'rejected' | 'deactivated';

/** A user as other modules see them. Never holds a password hash, a secret or an internal flag. */
export interface User {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  status: UserStatus;
  /** Set for a soft-deleted account, which cannot sign in. */
  deletedAt: Date | null;
  createdAt: Date;
  /**
   * The SHA-256 of the profile picture the person chose (served at `/api/internal/files/{hash}`), or `null` without one.
   * Whoever may see the person's username may show it next to the name.
   */
  avatarHash: string | null;
}

export interface UserService {
  /**
   * Creates a user and the way they sign in (a password, or an identity at an OIDC provider) in one
   * transaction. Throws `Invalid` (422) for input that breaks the rules and `Conflict` (409) when
   * the username, the email address (verified or not) or the identity is taken, by any account.
   */
  createUser(input: CreateUserInput): Promise<User>;
  /** Case-insensitive. `undefined` when there is no such user (soft-deleted ones are found). */
  findByUsername(username: string): Promise<User | undefined>;
  /** `undefined` when there is no such user (also for an id that is not a UUID). */
  findById(id: string): Promise<User | undefined>;
  /**
   * Many users in one query (per 1000 ids). Malformed and unknown ids are left out, duplicates are
   * read once, soft-deleted users are found. For a list or a fan-out that would otherwise call
   * `findById` once per person.
   */
  findByIds(ids: readonly string[]): Promise<Map<string, User>>;
  /** Case-insensitive. `undefined` when no user has this address. */
  findByEmail(email: string): Promise<User | undefined>;
  /**
   * Creates an active account with no way to sign in and the role nobody (the caller gives one), waiting for its owner
   * (ADR-0053): their first sign-in at `claim.provider` with an unknown subject, a verified address equal to `email` and
   * a `preferred_username` equal to `claim.username` (without case) before `claim.expiresAt` adds that identity and signs
   * them in. A trusted write (ADR-0015): no permission, no route; the legacy migration calls it. `Invalid` (422) for bad
   * input, `Conflict` (409) when the username or the address is taken by any account.
   */
  createClaimableAsSystem(input: CreateClaimableUserInput): Promise<User>;
  /**
   * The open claim of an account (ADR-0053), or `undefined` once it was claimed or for an account that never had one. An
   * expired claim is returned with its `expiresAt`. A trusted read: the migration tool reports by it.
   */
  claimOfAsSystem(
    userId: string,
  ): Promise<{ provider: string; username: string; expiresAt: Date } | undefined>;
}

export interface IdentityService {
  users: UserService;
  /**
   * Resolves when the caller's session was authenticated within `maxAgeSeconds` (default: the
   * setting `sessions.recentAuthSeconds`, 5 minutes). Throws `ReauthenticationRequired` (401,
   * problem type `reauthentication-required`) when it was not; the client then asks for the
   * password or the provider and repeats the request. A caller with an access token is not asked.
   * Call it in the service, before the work, for a change that ASVS 7.5.1 protects.
   */
  requireRecentAuth(actor: Actor, maxAgeSeconds?: number): Promise<void>;
  /**
   * Deactivates an active account with no human caller: **no permission is checked** and no route calls it (ADR-0015). For the
   * migration tool, which ends the life of its own account; the last-Admin rule still applies (409), so an instance never loses
   * its last administrator this way. The audit trail shows the system.
   */
  deactivateAsSystem(userId: string): Promise<void>;
}

export type { CreateClaimableUserInput, CreateUserInput };

// Lets `ctx.deps['core.identity']` be typed in modules that depend on this one.
declare module '@scorpion/kernel' {
  interface ModuleServices {
    'core.identity': IdentityService;
  }
}
