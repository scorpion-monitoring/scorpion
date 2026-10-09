// The only file other modules may import. It holds the service interface and nothing else.
import type { Actor } from '@scorpion/contracts';
import type { CreateUserInput } from './validation.ts';

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
  /** Case-insensitive. `undefined` when no user has this address. */
  findByEmail(email: string): Promise<User | undefined>;
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
}

export type { CreateUserInput };

// Lets `ctx.deps['core.identity']` be typed in modules that depend on this one.
declare module '@scorpion/kernel' {
  interface ModuleServices {
    'core.identity': IdentityService;
  }
}
