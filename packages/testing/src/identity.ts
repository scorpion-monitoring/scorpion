// Factories for the tables of `core.identity`. They insert rows directly, so a test can set up a
// user, a session or a token without going through the service it is not testing. They know the
// column names: a change to the schema breaks the identity integration tests, which is the point.
// They need the module's migrations to have run.
import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** What a `pg.Pool` or `pg.Client` offers. */
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

let sequence = 0;
const next = () => ++sequence;

async function insert<R>(db: Queryable, table: string, values: Record<string, unknown>) {
  const columns = Object.keys(values);
  const { rows } = await db.query<R>(
    `insert into ${table} (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    Object.values(values),
  );
  return rows[0]!;
}

export interface UserRow {
  id: string;
  username: string;
  email: string | null;
  email_verified_at: Date | null;
  status: string;
  deleted_at: Date | null;
}

export interface MakeUser {
  username?: string;
  email?: string | null;
  emailVerified?: boolean;
  /** Default `active`. */
  status?: 'pending' | 'active' | 'rejected';
  deleted?: boolean;
}

/** A user without any way to sign in; add one with `makeAuthMethod`. Unique names by default. */
export function makeUser(db: Queryable, overrides: MakeUser = {}): Promise<UserRow> {
  const n = next();
  const email = overrides.email === undefined ? `user${n}@example.org` : overrides.email;
  return insert<UserRow>(db, 'identity_user', {
    id: randomUUID(),
    username: overrides.username ?? `user${n}`,
    email,
    email_verified_at: overrides.emailVerified && email ? new Date() : null,
    status: overrides.status ?? 'active',
    deleted_at: overrides.deleted ? new Date() : null,
  });
}

export interface MakeAuthMethod {
  /** Default `local`. */
  provider?: string;
  /** Default: the user's id for `local`, a fresh value otherwise. */
  subject?: string;
  /** Only for `local`. The default is a placeholder, not a hash of any password. */
  passwordHash?: string;
}

export function makeAuthMethod(
  db: Queryable,
  user: Pick<UserRow, 'id'>,
  overrides: MakeAuthMethod = {},
) {
  const provider = overrides.provider ?? 'local';
  return insert<{ id: string; user_id: string; provider: string; subject: string }>(
    db,
    'identity_auth_method',
    {
      id: randomUUID(),
      user_id: user.id,
      provider,
      subject: overrides.subject ?? (provider === 'local' ? user.id : `sub-${next()}`),
      password_hash:
        provider === 'local' ? (overrides.passwordHash ?? '$argon2id$placeholder') : null,
    },
  );
}

/** The SHA-256 hex of a session id, as `identity_session.secret_hash` holds it. */
export const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');

export interface MakeSession {
  /** Default: one week from now. */
  expiresAt?: Date;
  /** Default: 30 days from now. */
  absoluteExpiresAt?: Date;
  /** Default: now. */
  authenticatedAt?: Date;
  revoked?: boolean;
}

/** A session; `secret` is the value the cookie would hold, which the row itself does not. */
export async function makeSession(
  db: Queryable,
  user: Pick<UserRow, 'id'>,
  overrides: MakeSession = {},
) {
  const secret = randomBytes(32).toString('base64url');
  const row = await insert<{ id: string; user_id: string; expires_at: Date }>(
    db,
    'identity_session',
    {
      id: randomUUID(),
      user_id: user.id,
      secret_hash: hashSecret(secret),
      expires_at: overrides.expiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000),
      absolute_expires_at:
        overrides.absoluteExpiresAt ?? new Date(Date.now() + 30 * 24 * 3600 * 1000),
      authenticated_at: overrides.authenticatedAt ?? new Date(),
      revoked_at: overrides.revoked ? new Date() : null,
    },
  );
  return { row, secret };
}

export interface MakeToken {
  name?: string;
  scopes?: string[];
  expiresAt?: Date | null;
  revoked?: boolean;
  /** The stored hash. The default is a placeholder, not a hash of the secret. */
  secretHash?: string;
}

/** A personal access token; `token` is the full `scp_<prefix>_<secret>` a client would send. */
export async function makeToken(
  db: Queryable,
  user: Pick<UserRow, 'id'>,
  overrides: MakeToken = {},
) {
  const prefix = randomBytes(6)
    .toString('base64url')
    .replace(/[^A-Za-z0-9]/g, 'x')
    .slice(0, 8)
    .padEnd(8, 'x');
  const secret = randomBytes(24).toString('base64url');
  const row = await insert<{ id: string; user_id: string; prefix: string; name: string }>(
    db,
    'identity_token',
    {
      id: randomUUID(),
      user_id: user.id,
      name: overrides.name ?? `token-${next()}`,
      prefix,
      secret_hash: overrides.secretHash ?? '$argon2id$placeholder',
      scopes: overrides.scopes ?? [],
      expires_at: overrides.expiresAt ?? null,
      revoked_at: overrides.revoked ? new Date() : null,
    },
  );
  return { row, token: `scp_${prefix}_${secret}`, secret };
}
