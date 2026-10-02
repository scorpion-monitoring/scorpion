// The tables of core.identity. Every name starts with `identity_` (the manifest's `tablePrefix`,
// ADR 0004). Create a migration after a change: `pnpm db:generate --filter @scorpion/core-identity`.
//
// Secrets are never stored in the clear: a session id and a login state are random 256-bit values
// kept as a SHA-256 hash, a token secret and a password as an argon2id hash.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** The provider id of the password account that every user can have. */
export const LOCAL_PROVIDER = 'local';

/**
 * What `create-admin` and the first-run token write to mark the administrator they create: the
 * only place in the code that sets the temporary marker, so the file list that may mention it stays
 * this one (ADR 0006). It is write-only: nothing reads the column, and nothing decides by it.
 */
export const BOOTSTRAP_ADMIN_MARK = { isBootstrapAdmin: true } as const;

/** A person. How they sign in is in `identity_auth_method`, so one user can have several ways. */
export const user = pgTable(
  'identity_user',
  {
    id: uuid().primaryKey(), // UUIDv7
    /** Lower-case letters, digits, `_` and `-`, 3 to 31 characters. Unique, and stays reserved after a soft delete. */
    username: text().notNull(),
    email: text(),
    /** Set when the address was confirmed (by mail link, or by the OIDC provider). */
    emailVerifiedAt: timestamptz('email_verified_at'),
    /** `pending` (waiting for approval), `active` or `rejected`. A text column checked in the service (architecture: state machines as columns). */
    status: text().notNull().default('pending'),
    /** Soft delete: the row stays, the account cannot sign in. */
    deletedAt: timestamptz('deleted_at'),
    /** The blob store arrives with core.settings (M3); nothing sets this before. */
    avatarBlobId: uuid('avatar_blob_id'),
    /**
     * TEMPORARY, removed completely in M3 (ADR 0006). Marks the admin that `scorpion create-admin`
     * or the first-run token creates, until roles exist. M3's seed migration turns it into an
     * Admin role assignment and drops the column. Nothing reads it in M2, so it grants nothing.
     */
    isBootstrapAdmin: boolean('is_bootstrap_admin').notNull().default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('identity_user_username_uidx').on(table.username),
    // A verified address belongs to one user. An unverified one is not unique here: it proves
    // nothing, and the service refuses a second registration with it anyway.
    uniqueIndex('identity_user_email_verified_uidx')
      .on(sql`lower(${table.email})`)
      .where(sql`${table.email} is not null and ${table.emailVerifiedAt} is not null`),
    index('identity_user_email_idx').on(sql`lower(${table.email})`),
    check('identity_user_username_format', sql`${table.username} ~ '^[a-z0-9_-]{3,31}$'`),
    check('identity_user_status_known', sql`${table.status} in ('pending', 'active', 'rejected')`),
    check(
      'identity_user_verified_has_email',
      sql`${table.emailVerifiedAt} is null or ${table.email} is not null`,
    ),
  ],
);

/** One way to sign in: a password (`local`) or an identity at an OIDC provider. */
export const authMethod = pgTable(
  'identity_auth_method',
  {
    id: uuid().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** `local`, or the id of the configured provider. */
    provider: text().notNull(),
    /** The user's id at the provider; for `local` the user's own id. */
    subject: text().notNull(),
    /** argon2id, `local` only. */
    passwordHash: text('password_hash'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    lastLoginAt: timestamptz('last_login_at'),
  },
  (table) => [
    uniqueIndex('identity_auth_method_provider_subject_uidx').on(table.provider, table.subject),
    uniqueIndex('identity_auth_method_local_user_uidx')
      .on(table.userId)
      .where(sql`${table.provider} = 'local'`),
    index('identity_auth_method_user_idx').on(table.userId),
    check(
      'identity_auth_method_provider_format',
      sql`${table.provider} ~ '^[a-z][a-z0-9-]{0,62}$'`,
    ),
    check(
      'identity_auth_method_password_only_local',
      sql`(${table.provider} = 'local') = (${table.passwordHash} is not null)`,
    ),
  ],
);

/** A browser session. The cookie holds the secret; only its hash is here, so a leaked table is no login. */
export const session = pgTable(
  'identity_session',
  {
    id: uuid().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** SHA-256 of the 256-bit session id. */
    secretHash: text('secret_hash').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    /** Set by logout and "log out everywhere"; a revoked session never authenticates. */
    revokedAt: timestamptz('revoked_at'),
  },
  (table) => [
    uniqueIndex('identity_session_secret_hash_uidx').on(table.secretHash),
    index('identity_session_user_idx').on(table.userId),
    index('identity_session_expires_idx').on(table.expiresAt),
  ],
);

/**
 * The state of one OIDC login in progress: single use, short-lived (10 minutes). It holds hashes
 * only (ADR 0011): the PKCE verifier and the browser binding live in a cookie of the browser that
 * started the login, and the nonce is compared against its hash.
 */
export const loginState = pgTable(
  'identity_login_state',
  {
    id: uuid().primaryKey(),
    /** The provider the login was started for. */
    providerId: text('provider_id').notNull(),
    /** SHA-256 of the random `state` value sent to the provider. */
    stateHash: text('state_hash').notNull(),
    /** SHA-256 of the `nonce` sent to the provider; the id_token must carry the same nonce. */
    nonceHash: text('nonce_hash').notNull(),
    /**
     * The PKCE `code_challenge` (SHA-256 of the verifier). The verifier is in the browser's login
     * cookie; at the callback its hash must equal this, which ties the callback to the browser
     * that started the login.
     */
    bindingHash: text('binding_hash').notNull(),
    /** Set when a signed-in user started the flow to add this provider to their account. */
    linkUserId: uuid('link_user_id').references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
  },
  (table) => [
    uniqueIndex('identity_login_state_hash_uidx').on(table.stateHash),
    index('identity_login_state_expires_idx').on(table.expiresAt),
  ],
);

/** A personal access token, `scp_<prefix>_<secret>`: found by prefix, checked by hash. */
export const token = pgTable(
  'identity_token',
  {
    id: uuid().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The user's own label. Unique per user among the tokens that are not revoked. */
    name: text().notNull(),
    /** The 8 characters after `scp_`; not secret, used to find the row. */
    prefix: text().notNull(),
    /** argon2id of the secret part. */
    secretHash: text('secret_hash').notNull(),
    /** What the token may do, `read:kpi`. */
    scopes: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    expiresAt: timestamptz('expires_at'),
    lastUsedAt: timestamptz('last_used_at'),
    revokedAt: timestamptz('revoked_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('identity_token_prefix_uidx').on(table.prefix),
    // Unique among the live tokens: a revoked token keeps its row but frees its name, so rotating
    // (revoke, then create under the same name) and re-creating a token work.
    uniqueIndex('identity_token_user_name_uidx')
      .on(table.userId, table.name)
      .where(sql`${table.revokedAt} is null`),
    index('identity_token_expires_idx').on(table.expiresAt),
    check('identity_token_prefix_format', sql`${table.prefix} ~ '^[A-Za-z0-9]{8}$'`),
  ],
);

/**
 * The one-time token a fresh install prints to its console so the first administrator can be
 * created without the "first registrant" rule. Single use, short-lived, kept only as a SHA-256
 * hash of 256 random bits (so a leaked table is no way in).
 */
export const firstRunToken = pgTable(
  'identity_first_run_token',
  {
    id: uuid().primaryKey(),
    /** SHA-256 of the token that was printed. */
    secretHash: text('secret_hash').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    /** Set when it was used, or when an administrator was created another way; either ends it. */
    redeemedAt: timestamptz('redeemed_at'),
  },
  (table) => [uniqueIndex('identity_first_run_token_hash_uidx').on(table.secretHash)],
);

/** What a mail token is for. */
export const MAIL_TOKEN_PURPOSES = ['password-reset', 'email-verification'] as const;
export type MailTokenPurpose = (typeof MAIL_TOKEN_PURPOSES)[number];

/**
 * A single-use token that travels by mail: a password reset or the confirmation of an address
 * (ADR 0012). Only the SHA-256 hash of 256 random bits is kept, so a leaked table is no way in.
 * A new token for the same user and purpose replaces the outstanding one.
 */
export const mailToken = pgTable(
  'identity_mail_token',
  {
    id: uuid().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    purpose: text().notNull(),
    /** SHA-256 of the token that was mailed. */
    secretHash: text('secret_hash').notNull(),
    /** For `email-verification`: the address the token confirms (the current one, or a new one). */
    email: text(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    /** Set when the token was used; a used token never works again. */
    usedAt: timestamptz('used_at'),
  },
  (table) => [
    uniqueIndex('identity_mail_token_hash_uidx').on(table.secretHash),
    index('identity_mail_token_user_idx').on(table.userId, table.purpose),
    index('identity_mail_token_expires_idx').on(table.expiresAt),
    check(
      'identity_mail_token_purpose_known',
      sql`${table.purpose} in ('password-reset', 'email-verification')`,
    ),
    check(
      'identity_mail_token_verification_has_email',
      sql`(${table.purpose} = 'email-verification') = (${table.email} is not null)`,
    ),
  ],
);
