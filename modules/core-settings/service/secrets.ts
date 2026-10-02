// The secrets store (ADR 0016). Values are encrypted with AES-256-GCM under the key ring from
// `SECRETS_KEY` / `SECRETS_KEY_NEXT` and are write-only through the API: nothing here returns a
// value except `getSecret`, which is for trusted code. A value, a key or a key id is never put in
// a log line, an event, an error message or a response.
import { Invalid, NotFound, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import { ids, type ModuleContext } from '@scorpion/kernel';
import { asc, eq, ne, sql } from 'drizzle-orm';
import { secret } from '../db/schema.ts';
import {
  decrypt as aesDecrypt,
  encrypt as aesEncrypt,
  type KeyRing,
  type Sealed,
  type SecretsKey,
} from './crypto.ts';
import { PERMISSION_SECRET_WRITE, PERMISSION_SETTINGS_READ } from './permissions.ts';

/** `oidc.keycloak.client-secret`: lower-case letters, digits, `.`, `-`, `_`; starts with a letter. */
export const SECRET_NAME = /^[a-z][a-z0-9._-]{0,127}$/;
export const MAX_SECRET_LENGTH = 4096;

export interface SecretStatus {
  name: string;
  /** Always true: a secret that is not stored is not listed. The value is never returned. */
  set: true;
  updatedAt: Date;
}

export interface SecretsAdminService {
  /** Needs `core.settings.read`. Names and when they were set; never a value. */
  list(actor: Actor): Promise<SecretStatus[]>;
  /** Needs `core.settings.secret.write`. Stores or replaces a secret. `Invalid` for a bad name or value. */
  set(actor: Actor, name: string, value: string): Promise<SecretStatus>;
  /** Needs `core.settings.secret.write`. `NotFound` when there is no such secret. */
  remove(actor: Actor, name: string): Promise<void>;
}

export interface RotationReport {
  /** Rows moved to the next key by this run. */
  rotated: number;
  /** Rows still on another key afterwards (0 after a complete run). */
  remaining: number;
}

export interface RotationOptions {
  /** Rows per transaction. Default 100. */
  batchSize?: number;
  /** Called after each committed batch (tests and progress output). */
  afterBatch?: (rotated: number) => Promise<void> | void;
}

export interface SecretsInternals extends SecretsAdminService {
  /** The value of a secret, or `undefined` when none is stored. Trusted code only (see public.ts). */
  getSecret(name: string): Promise<string | undefined>;
  /**
   * For trusted code with no human caller (`scorpion set-secret`): stores a secret without a
   * permission check, in a transaction with its event. The CLI is the only caller.
   */
  setAsSystem(name: string, value: string): Promise<SecretStatus>;
  /**
   * Re-encrypts every row that is not on `SECRETS_KEY_NEXT` under it, one transaction per batch,
   * verifying that the new ciphertext decrypts to the same value before the batch commits. Safe to
   * stop and run again. A row that cannot be decrypted with the keys at hand stops the run
   * (`Error` naming the secret) and leaves it, and everything before it, readable.
   */
  rotate(options?: RotationOptions): Promise<RotationReport>;
  /** How many rows are not on the write key. */
  countOffKey(): Promise<number>;
}

export interface Cipher {
  encrypt(key: SecretsKey, name: string, plaintext: string): Sealed;
  decrypt(key: SecretsKey, name: string, sealed: Pick<Sealed, 'ciphertext' | 'nonce'>): string;
}

const aes: Cipher = { encrypt: aesEncrypt, decrypt: aesDecrypt };

function checkName(name: string) {
  if (!SECRET_NAME.test(name)) {
    throw new Invalid('The secret name is not valid.', [
      {
        path: 'name',
        message:
          'Use lower-case letters, digits, ".", "-" and "_", starting with a letter (at most 128 characters).',
      },
    ]);
  }
}

function checkValue(value: string) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SECRET_LENGTH) {
    // The message never repeats the value.
    throw new Invalid('The secret value is not valid.', [
      { path: 'value', message: `Must be 1 to ${MAX_SECRET_LENGTH} characters.` },
    ]);
  }
}

export function createSecretsService(
  ctx: ModuleContext,
  deps: { authz: Pick<AuthzService, 'require'>; keys: KeyRing; cipher?: Cipher },
): SecretsInternals {
  const { keys } = deps;
  const cipher = deps.cipher ?? aes;

  function open(name: string, row: { ciphertext: Buffer; nonce: Buffer; keyId: string }): string {
    const key = keys.find(row.keyId);
    if (!key)
      throw new Error(`The secret "${name}" is encrypted with a key this process does not hold.`);
    return cipher.decrypt(key, name, row);
  }

  async function store(
    name: string,
    value: string,
    updatedBy: string | null,
  ): Promise<SecretStatus> {
    checkName(name);
    checkValue(value);
    const sealed = cipher.encrypt(keys.writeKey, name, value);
    const now = new Date();
    await ctx.db.tx(async (tx) => {
      await tx
        .insert(secret)
        .values({ id: ids.uuidv7(), name, ...sealed, updatedBy })
        .onConflictDoUpdate({
          target: secret.name,
          set: { ...sealed, updatedBy, updatedAt: now },
        });
      // The name only: the value, the key and its id stay out of the event.
      await ctx.events.emit('settings.secret.changed@1', { name, removed: false });
    });
    return { name, set: true, updatedAt: now };
  }

  const writeKeyId = keys.writeKey.id;

  return {
    async list(actor) {
      await deps.authz.require(actor, PERMISSION_SETTINGS_READ);
      const rows = await ctx.db
        .select({ name: secret.name, updatedAt: secret.updatedAt })
        .from(secret)
        .orderBy(asc(secret.name));
      return rows.map((row) => ({ name: row.name, set: true as const, updatedAt: row.updatedAt }));
    },

    async set(actor, name, value) {
      await deps.authz.require(actor, PERMISSION_SECRET_WRITE);
      return store(name, value, actor.kind === 'user' ? actor.userId : null);
    },

    setAsSystem: (name, value) => store(name, value, null),

    async remove(actor, name) {
      await deps.authz.require(actor, PERMISSION_SECRET_WRITE);
      checkName(name);
      await ctx.db.tx(async (tx) => {
        const removed = await tx
          .delete(secret)
          .where(eq(secret.name, name))
          .returning({ id: secret.id });
        if (removed.length === 0) throw new NotFound(`There is no secret "${name}".`);
        await ctx.events.emit('settings.secret.changed@1', { name, removed: true });
      });
    },

    async getSecret(name) {
      const [row] = await ctx.db.select().from(secret).where(eq(secret.name, name));
      return row ? open(name, row) : undefined;
    },

    async countOffKey() {
      const [counted] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(secret)
        .where(ne(secret.keyId, writeKeyId));
      return counted?.n ?? 0;
    },

    async rotate(options = {}) {
      const target = keys.nextKey;
      if (!target) {
        throw new Error('There is no SECRETS_KEY_NEXT: set it to the new key before rotating.');
      }
      const batchSize = options.batchSize ?? 100;
      if (!Number.isInteger(batchSize) || batchSize < 1)
        throw new Error('The batch size must be a positive whole number.');
      let rotated = 0;
      for (;;) {
        const moved = await ctx.db.tx(async (tx) => {
          const rows = await tx
            .select()
            .from(secret)
            .where(ne(secret.keyId, target.id))
            .orderBy(asc(secret.id))
            .limit(batchSize)
            .for('update');
          for (const row of rows) {
            const plaintext = open(row.name, row);
            const sealed = cipher.encrypt(target, row.name, plaintext);
            // Verify before the batch can commit: what we are about to store must read back.
            if (cipher.decrypt(target, row.name, sealed) !== plaintext) {
              throw new Error(
                `Re-encrypting the secret "${row.name}" did not verify; nothing was changed.`,
              );
            }
            await tx.update(secret).set(sealed).where(eq(secret.id, row.id));
          }
          return rows.length;
        });
        if (moved === 0) break;
        rotated += moved;
        await options.afterBatch?.(moved);
      }
      const [counted] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(secret)
        .where(ne(secret.keyId, target.id));
      return { rotated, remaining: counted?.n ?? 0 };
    },
  };
}
