// AES-256-GCM for the secrets store (ADR 0016). Pure functions over node:crypto: no database, no
// environment. A secret value, a key and a nonce never appear in an error message or a log line;
// every failure is one of the fixed messages below.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const KEY_BYTES = 32;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;

/** A key and its id. The id is derived from the key, so the same key always has the same id. */
export interface SecretsKey {
  readonly id: string;
  /** The raw key. Never leaves this module: not logged, not in an error, not in an event. */
  readonly bytes: Buffer;
}

export class SecretDecryptError extends Error {
  constructor() {
    super('A stored secret could not be decrypted with the key it names.');
    this.name = 'SecretDecryptError';
  }
}

/**
 * `SECRETS_KEY` as the standard base64 of exactly 32 bytes (`openssl rand -base64 32`). Returns
 * `undefined` for anything else; the caller says how to generate a good one, without echoing the value.
 */
export function parseKey(text: string | undefined): SecretsKey | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return undefined;
  const bytes = Buffer.from(trimmed, 'base64');
  if (bytes.length !== KEY_BYTES || bytes.toString('base64') !== trimmed) return undefined;
  return { id: keyId(bytes), bytes };
}

/**
 * A short, stable name for a key, stored on every row it encrypts. It is a domain-separated SHA-256
 * prefix of the key: it identifies the key without helping anyone to recover it.
 */
export function keyId(bytes: Buffer): string {
  return createHash('sha256')
    .update('scorpion.secrets.key-id.v1\0')
    .update(bytes)
    .digest('hex')
    .slice(0, 16);
}

export interface Sealed {
  /** The encrypted value followed by the authentication tag. */
  ciphertext: Buffer;
  nonce: Buffer;
  keyId: string;
}

/**
 * The secret's name is authenticated with the value (GCM additional data), so a row copied under
 * another name does not decrypt.
 */
const additionalData = (name: string) => Buffer.from(`scorpion.secret.v1:${name}`, 'utf8');

export function encrypt(key: SecretsKey, name: string, plaintext: string): Sealed {
  const nonce = randomBytes(NONCE_BYTES); // a new one for every value; never reused with a key
  const cipher = createCipheriv('aes-256-gcm', key.bytes, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(additionalData(name));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext: Buffer.concat([body, cipher.getAuthTag()]), nonce, keyId: key.id };
}

export function decrypt(
  key: SecretsKey,
  name: string,
  sealed: Pick<Sealed, 'ciphertext' | 'nonce'>,
): string {
  try {
    if (sealed.nonce.length !== NONCE_BYTES || sealed.ciphertext.length < TAG_BYTES) {
      throw new Error('malformed');
    }
    const body = sealed.ciphertext.subarray(0, sealed.ciphertext.length - TAG_BYTES);
    const tag = sealed.ciphertext.subarray(sealed.ciphertext.length - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key.bytes, sealed.nonce, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(additionalData(name));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretDecryptError(); // the cause could say which byte was wrong; it says nothing
  }
}

/** The keys this process holds: the current one and, during a rotation, the next. */
export interface KeyRing {
  /** Decrypts rows of either key. */
  find(id: string): SecretsKey | undefined;
  /** The key new values are written with: `SECRETS_KEY_NEXT` while a rotation is under way, else `SECRETS_KEY`. */
  readonly writeKey: SecretsKey;
  /** The key a rotation moves rows to; `undefined` when none is configured. */
  readonly nextKey: SecretsKey | undefined;
}

export const HOW_TO_GENERATE_A_KEY =
  "Generate one with: openssl rand -base64 32  (or: node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64'))\")";

/** Reads `SECRETS_KEY` and `SECRETS_KEY_NEXT` from `env`. Returns the problems, never the values. */
export function loadKeyRing(env: Record<string, string | undefined>): {
  ring?: KeyRing;
  problems: string[];
} {
  const problems: string[] = [];
  const present = (name: string) =>
    env[name] === undefined || env[name] === '' ? undefined : name;
  let current: SecretsKey | undefined;
  let next: SecretsKey | undefined;
  if (!present('SECRETS_KEY')) {
    problems.push(
      `SECRETS_KEY is not set. It encrypts the stored secrets and must be 32 random bytes, base64 encoded. ${HOW_TO_GENERATE_A_KEY}`,
    );
  } else {
    current = parseKey(env.SECRETS_KEY);
    if (!current) {
      problems.push(
        `SECRETS_KEY is not valid: it must be the base64 of exactly 32 bytes. ${HOW_TO_GENERATE_A_KEY}`,
      );
    }
  }
  if (present('SECRETS_KEY_NEXT')) {
    next = parseKey(env.SECRETS_KEY_NEXT);
    if (!next) {
      problems.push(
        `SECRETS_KEY_NEXT is not valid: it must be the base64 of exactly 32 bytes. ${HOW_TO_GENERATE_A_KEY}`,
      );
    } else if (current && next.id === current.id) {
      problems.push('SECRETS_KEY_NEXT is the same key as SECRETS_KEY; a rotation needs a new one.');
    }
  }
  if (problems.length > 0 || !current) return { problems };
  const keys = new Map([current, ...(next ? [next] : [])].map((key) => [key.id, key]));
  return {
    problems,
    ring: { find: (id) => keys.get(id), writeKey: next ?? current, nextKey: next },
  };
}
