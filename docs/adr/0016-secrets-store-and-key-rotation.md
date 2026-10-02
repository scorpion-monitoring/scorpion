# ADR-0016: The secrets store, its key and key rotation

- Status: Accepted
- Date: 2026-10-02

## Context

CLAUDE.md puts secrets "only in the encrypted `secrets` store, never in `settings` JSON, env dumps, logs or API
responses". Until M3 the only secret the application holds is the OIDC client secret, read from
`OIDC_<ID>_CLIENT_SECRET` (a seam in `service/oidc-secret.ts`, ADR-0011). M3 decision 4 removes that variable with no
fallback. The store needs a cipher, a key that is not in the database, a way to change the key while rows exist, and
rules about what may ever see a value. The M3 plan (§6) names AES-256-GCM, a 12-byte nonce per value, `SECRETS_KEY`, a key
id per row, `scorpion set-secret` and `scorpion rotate-secrets`; this ADR records the choices it left open.

## Decision

### The cipher and the row

- **AES-256-GCM** from `node:crypto`; no new dependency. A **new random 12-byte nonce for every value** (a re-set value gets
  a new nonce), a 16-byte tag stored after the ciphertext in one `bytea`.
- **The secret's name is the additional authenticated data** (`scorpion.secret.v1:<name>`). A row copied or renamed to
  another name fails authentication, so an attacker with write access to the table cannot make one secret answer to
  another's name. Changing the format is a new version string and a rotation.
- A row is `(id, name, ciphertext, nonce, key_id, created_at, updated_at, updated_by)`; the name is unique. Failure to
  decrypt is always the same `SecretDecryptError` with a fixed message: the cause (wrong key, damaged byte, wrong
  name) is not distinguishable by what it says.

### The key

- **`SECRETS_KEY`**: 32 bytes, standard base64 (`openssl rand -base64 32`), validated strictly (alphabet, padding,
  length, round trip). A profile that includes `core.settings` **refuses to start** without a valid one:
  `core.settings` builds its service in `services()`, finds no usable key and throws `KernelStartupError("Cannot start
core.settings:", problems)`. The message says how to generate one and never repeats what was set. The CLI prints it as
  plain text (and the pino line carries it too). `scorpion migrate` builds no services, so it needs no key.
- The key is read from the process environment by the module (`env` can be injected by tests), not through the kernel's
  `Config`: `Config` is the validated environment that every module receives and is documented as holding no secret
  but `DATABASE_URL`. `SECRETS_KEY` and `SECRETS_KEY_NEXT` are redacted by name in the logger.
- **Key id**: the first 16 hex characters of `SHA-256("scorpion.secrets.key-id.v1\0" || key)`, stored on each row. It
  is derived, so no id has to be configured or kept in step with the key, and it identifies a key without helping to
  recover it (64 bits of a hash of 256 random bits). The id is never logged or put in an error.

### Rotation

- **Two variables, a key ring of at most two.** `SECRETS_KEY` is the key the rows are on, `SECRETS_KEY_NEXT` the new one.
  The process decrypts rows of either key. **While `SECRETS_KEY_NEXT` is set it writes with it**, so a value set during a
  rotation is already on the target key and the run converges.
  A ring with ids and an arbitrary number of retired keys was the alternative; it would let a database hold rows of
  many generations at once, which nothing here needs, and every extra key is one more secret to protect.
- **The procedure** (README of `core.settings`): generate the new key; set `SECRETS_KEY_NEXT` everywhere and restart;
  run `scorpion rotate-secrets`; when it reports no rows remain, set `SECRETS_KEY` to the new key, remove
  `SECRETS_KEY_NEXT`, restart. At every step each row can be read by the keys the running processes hold.
- **`rotate-secrets`** selects rows whose `key_id` is not the target, `FOR UPDATE`, `limit batch` (default 100), and for
  each one decrypts with the key named on the row, encrypts under the target, **decrypts the result and compares it
  with the plaintext**, then updates; the batch is one transaction. It loops until a batch is empty and reports rows
  moved and rows remaining (rows still on another key; non-zero exits 1). Nothing is printed except counts and, on
  failure, the secret's name.
- **Resumable and safe to stop.** A crash or a failed batch rolls back that batch only; batches already committed are on
  the target key, which the ring holds. A row that cannot be decrypted with the keys at hand (a third key, damage)
  **stops the run** and leaves that batch unchanged; the run does not skip it, because "rotation complete" would then be
  false. The operator removes or re-sets that secret and runs again.
- A verification failure (the new ciphertext does not read back) aborts the batch the same way. Tests inject a cipher
  that corrupts its output to prove nothing is written.

### Who can see a value

- **API**: write-only. Responses carry `{ name, set: true, updatedAt }`; there is no route that returns a value, and a
  test greps every response of the settings routes (success and failure, admin and denied) for the stored value and the
  key.
- **Code**: `ctx.deps['core.settings'].getSecret(name)` returns the plaintext. It is **trusted-code only**, like the
  system methods of `core.authz` (ADR-0015): it checks no permission, and only a module that declares `core.settings` as
  a dependency can reach it (`ctx.deps` throws for any other). It is not part of any route and not in the OpenAPI
  document.
- **CLI**: `set-secret` reads the value from the prompt or standard input and refuses it on the command line. Its
  service call (`setAsSystem`) is internal to the module and is not on the public interface.
- **Events** carry the name and whether the secret was removed. **Logs** hold none of the value, the key, the key id or the
  ciphertext; the error mapper turns an unexpected error into a 500 without a message.
- OIDC: `core.identity` asks for the secret only for the code exchange. A provider with no stored secret is a public
  client (PKCE only), as it was when the variable was unset; the start-up log names such providers. A secret that
  cannot be decrypted is a 500 (an operator's error), not a failed sign-in.

## Consequences

- **A lost key loses the stored secrets**; the fix is to set them again. The README says to back the key up with the
  database (separately from it).
- Anyone who has both the database and the key can read the secrets; the store protects against a leaked database dump
  or backup, not against a compromised server process (which holds the key).
- Upgrading from 0.3.x adds three tables and requires `SECRETS_KEY`. OIDC secrets in `OIDC_<ID>_CLIENT_SECRET` are
  ignored and must be stored once with `set-secret`; the changeset says so.
- `SMTP_URL` still carries its password in the environment until `core.notifications` (M4) moves the transport.
- `KernelStartupError` from a module's `services()` happens after migrations, so a profile without a key still migrates
  its database before it refuses to start. Harmless, and `migrate` stays usable without a key.
