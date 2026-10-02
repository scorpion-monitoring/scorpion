// Factories for the tables of `core.settings`. They insert rows directly, so a test can set up a
// stored setting or a secret without going through the service it is not testing. They know the
// column names and the secret format (AES-256-GCM, the name as additional data, a key id derived
// from the key): a change to either breaks the settings integration tests, which is the point. They
// need the module's migrations to have run.
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Queryable } from './identity.ts';

let sequence = 0;
const next = () => ++sequence;

export interface MakeSetting {
  version?: number;
  updatedBy?: string | null;
}

/** The stored settings of one module (what an administrator saved), not checked against any schema. */
export async function makeSetting(
  db: Queryable,
  moduleId: string,
  value: Record<string, unknown>,
  overrides: MakeSetting = {},
) {
  const { rows } = await db.query<{ module_id: string; value: unknown; version: number }>(
    'insert into settings_setting (module_id, value, version, updated_by) values ($1, $2, $3, $4) returning *',
    [moduleId, JSON.stringify(value), overrides.version ?? 1, overrides.updatedBy ?? null],
  );
  return rows[0]!;
}

/** A new random key, as `SECRETS_KEY` is written: 32 bytes, base64. */
export const makeSecretsKey = () => randomBytes(32).toString('base64');

export interface MakeSecret {
  /** Default: a unique `secret-<n>`. */
  name?: string;
  /** Default: a unique value. */
  value?: string;
  /** The key to encrypt with, as `SECRETS_KEY` is written. Default: a new random one. */
  key?: string;
}

/** A secret encrypted under `key`; the key id is derived from the key as the module does. */
export async function makeSecret(db: Queryable, overrides: MakeSecret = {}) {
  const n = next();
  const name = overrides.name ?? `secret-${n}`;
  const value = overrides.value ?? `value-${n}-${randomUUID()}`;
  const key = Buffer.from(overrides.key ?? makeSecretsKey(), 'base64');
  const keyId = createHash('sha256')
    .update('scorpion.secrets.key-id.v1\0')
    .update(key)
    .digest('hex')
    .slice(0, 16);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(`scorpion.secret.v1:${name}`, 'utf8'));
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const { rows } = await db.query<{ id: string; name: string; key_id: string }>(
    'insert into settings_secret (id, name, ciphertext, nonce, key_id) values ($1, $2, $3, $4, $5) returning *',
    [randomUUID(), name, Buffer.concat([body, cipher.getAuthTag()]), nonce, keyId],
  );
  return { ...rows[0]!, value };
}

export interface MakePreference {
  updatedAt?: Date;
}

/** One stored preference of a user (opaque id), not checked against any registration. */
export async function makePreference(
  db: Queryable,
  user: { id: string },
  key: string,
  value: unknown,
  overrides: MakePreference = {},
) {
  const { rows } = await db.query<{ id: string; user_id: string; key: string }>(
    'insert into settings_user_preference (id, user_id, key, value, updated_at) values ($1, $2, $3, $4, $5) returning *',
    [randomUUID(), user.id, key, JSON.stringify(value), overrides.updatedAt ?? new Date()],
  );
  return rows[0]!;
}
