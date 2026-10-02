# core.settings

Settings of every module, per-user preferences and the encrypted secrets store. It is the module that makes
configuration data instead of constants: an administrator changes a setting through the API and the module that owns it
sees the change within a few seconds, with no restart. It depends on `core.authz` ([ADR-0014](../../docs/adr/0014-authorisation-model-and-dependency-direction.md))
and, like it, knows nothing about users: a user id is an opaque value with no foreign key.

Status: M3 sprint 3. Vocabularies, branding and the blob store arrive in sprint 4.

## Manifest

| Part           | Value                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| id             | `core.settings`                                                                                                                                                                            |
| table prefix   | `settings_` (set in the manifest; ADR-0004)                                                                                                                                                |
| dependencies   | `core.authz`                                                                                                                                                                               |
| routes         | internal API: [settings](#settings), [secrets](#secrets) and [preferences](#user-preferences)                                                                                              |
| jobs           | none                                                                                                                                                                                       |
| CLI            | `set-secret <name>`, `rotate-secrets [--batch-size <n>]` ([below](#cli))                                                                                                                   |
| events         | emits `settings.changed@1`, `settings.secret.changed@1`, `settings.preference.changed@1` ([below](#events))                                                                                |
| registries     | declares `settings.userPreference`; contributes `kernel.settingsStore` (the one entry that backs `ctx.settings`, [ADR-0017](../../docs/adr/0017-settings-port.md)) and `authz.defaultRole` |
| public service | `ctx.deps['core.settings']` has one method, `getSecret(name)`, for trusted code ([below](#reading-a-secret-from-code))                                                                     |

### Permissions

| Permission                       | Allows                                                                   | Held by default by |
| -------------------------------- | ------------------------------------------------------------------------ | ------------------ |
| `core.settings.read`             | Read the settings of every module, the JSON Schema, the names of secrets | Admin              |
| `core.settings.write`            | Change the settings of a module                                          | Admin              |
| `core.settings.secret.write`     | Set and remove secrets (they can never be read back)                     | Admin              |
| `core.settings.preference.read`  | Read your own preferences                                                | User, Admin        |
| `core.settings.preference.write` | Change your own preferences                                              | User, Admin        |

Reviewer holds none. Every service method checks its permission again with `ctx.authz.require` (CLAUDE.md, "check
permissions twice"); the route's `permission` is the first check. An administrator can take the preference permissions
from the role `user`.

## Settings

A module declares a Zod schema in its manifest (`settings`). This module stores what an administrator saved for it and
the module reads it, validated, with its defaults, through **`ctx.settings.get()`**
([ADR-0017](../../docs/adr/0017-settings-port.md)); see the kernel README for the port. Without this module in the
profile `ctx.settings` yields the schema's defaults.

- **Stored as JSON, one row per module** (`settings_setting`): the object that was saved, `version`, who and when. No row
  means all defaults. The value never holds a secret (CLAUDE.md): a secret goes in the [secrets store](#secrets).
- **Validated twice.** A write is checked with the owning module's schema (`422` with the failing field paths,
  `values.retention.purgeBatch`; unknown keys are refused). A read parses the stored value again, because the schema
  may have changed since: a key the schema now rejects is ignored (it falls back to its default, the other keys keep
  their stored values) and the log names the key, never its value.
- **Optimistic versioning.** `GET` returns `version` (0 before the first save). `PUT` must send the version it read; a
  stale one is `409` and nothing is written. Two writers with the same version: exactly one wins. A save that changes
  nothing writes nothing and emits nothing.
- **A save replaces the whole stored object.** The admin form reads the effective values (defaults applied) and sends
  them back; what is sent is what is stored.
- **Cache and the cross-process bound.** The stored JSON of each module is cached in process for **5 seconds**
  (`SETTINGS_CACHE_TTL_MS`). A write empties the entry in the process that made it, so that process sees it at once.
  **Another process learns of a change when its entry expires**, so with several server processes a changed setting
  (turning local accounts off, say) takes effect there within 5 seconds. It is the bound of sessions
  ([ADR-0007](../../docs/adr/0007-session-cookie-and-csrf.md)) and permissions (ADR-0014). Tests prove it with two kernels over one
  database.

### Settings of this module

| Key                  | Default                          | Meaning                                                                                                                                                |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rateLimits.default` | `{ burst: 120, perMinute: 120 }` | The server's rate limit for ordinary routes, per client address and per credential: a burst, then a steady rate. Read on every request, from the cache |
| `rateLimits.strict`  | `{ burst: 10, perMinute: 10 }`   | The same for routes an attacker gains from by repeating them (login, register, token use and creation, secrets)                                        |

The pipeline is not a module, so the module that stores settings owns these numbers; the server reads them with
`kernel.settingsOf('core.settings')` and uses its constants when the profile has no core.settings or the value cannot be
read.

### Routes

All are internal (`/api/internal`). Settings and secrets are Admin's; no response carries a secret value.

| Route                           | Permission                       | Does                                                                                                      |
| ------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /settings`                 | `core.settings.read`             | The settings of every module that declares a schema (list envelope, 0-based pages), defaults applied      |
| `GET /settings/{module}`        | `core.settings.read`             | One module's settings and the version to send back. `404` for a module without a schema                   |
| `GET /settings/{module}/schema` | `core.settings.read`             | The JSON Schema of the settings (`z.toJSONSchema`, input side), for the admin form                        |
| `PUT /settings/{module}`        | `core.settings.write`            | `{ version, values }`: validate, store, emit `settings.changed@1`. `422` with field paths, `409` if stale |
| `GET /secrets`                  | `core.settings.read`             | Names and `updatedAt` of stored secrets, each `set: true`. Never a value                                  |
| `PUT /secrets/{name}`           | `core.settings.secret.write`     | `{ value }`: encrypt and store. Answers `{ name, set: true, updatedAt }`. Rate limited (strict)           |
| `DELETE /secrets/{name}`        | `core.settings.secret.write`     | Remove. `404` if there is none                                                                            |
| `GET /preferences`              | `core.settings.preference.read`  | Your own stored preferences                                                                               |
| `PUT /preferences/{key}`        | `core.settings.preference.write` | `{ value }`: validated by the registered schema. `404` for a key nobody registered                        |
| `DELETE /preferences/{key}`     | `core.settings.preference.write` | Back to the default (also when nothing was stored)                                                        |

## Secrets

The secrets store keeps values the application needs but nobody should read again: today the OIDC client secrets
(`oidc.<provider id>.client-secret`). Design and rotation are in [ADR-0016](../../docs/adr/0016-secrets-store-and-key-rotation.md).

- **AES-256-GCM** (`node:crypto`), a **new random 12-byte nonce for every value**, the secret's name as additional
  authenticated data (a row copied under another name does not decrypt). A row holds `ciphertext` (value then the 16-byte
  tag), `nonce` and `key_id`.
- **The key** is `SECRETS_KEY`: 32 random bytes, standard base64. **A profile that includes core.settings refuses to start
  without a valid one**, with a message that says how to generate it and never repeats what was set:

  ```text
  Cannot start core.settings:
    - SECRETS_KEY is not set. It encrypts the stored secrets and must be 32 random bytes, base64 encoded.
      Generate one with: openssl rand -base64 32
  ```

  `scorpion migrate` does not need it (it builds no services); `start`, `worker` and every module command do. `pnpm dev`
  generates one into `.env`. **Back the key up with the database** (a lost key makes the stored secrets unreadable; the
  fix is to set them again).

- **Key id.** Each row names the key that encrypted it: the first 16 hex characters of a domain-separated SHA-256 of the
  key. It identifies a key without helping anyone recover it, and lets two keys coexist during a rotation.
- **Write-only through the API.** The API returns `set: true` and the name, never the value. Names: lower-case letters,
  digits, `.`, `-`, `_`, starting with a letter, at most 128; values 1 to 4096 characters.
- **Nothing logs a secret.** Not the value, not `SECRETS_KEY`, not a key id: the logger redacts `SECRETS_KEY` and
  `SECRETS_KEY_NEXT` by name, events carry the secret's name and a `removed` flag only, and every error is a fixed message.
  Tests grep every response of the settings routes, the log and the outbox for the stored value and the key.
- **Secrets never go in `settings` JSON**, in environment dumps, logs or API responses (CLAUDE.md).

### Reading a secret from code

`ctx.deps['core.settings'].getSecret(name)` returns the plaintext, or `undefined`. **It is for trusted code only**: it
checks no permission, like the system methods of core.authz (ADR-0015). The trust boundary is the profile's module list,
and only a module that declares `core.settings` as a dependency can reach it. Use the value for the one call that needs
it (the OIDC code exchange) and put it nowhere else. A row that cannot be decrypted with the keys at hand throws
`SecretDecryptError` (a fixed message); `core.identity` lets that surface as a 500 that the log explains without a value.

### CLI

Both are commands of this module ([ADR-0009](../../docs/adr/0009-module-cli-commands.md)); they go through the secrets
service and never print a value.

```bash
# The value is asked for (no echo) or read from standard input; it is never taken from an argument.
pnpm scorpion set-secret oidc.keycloak.client-secret
printf '%s\n' "$VALUE" | docker run -i --rm … scorpion set-secret oidc.keycloak.client-secret

pnpm scorpion rotate-secrets [--batch-size 100]
```

### Rotating the key

`rotate-secrets` moves every row from the current key to a new one, with both keys at hand. The environment holds
`SECRETS_KEY` (the key the rows are on) and **`SECRETS_KEY_NEXT`** (the new one). While `SECRETS_KEY_NEXT` is set the
process **reads rows of either key and writes new values with `SECRETS_KEY_NEXT`**, so nothing written during the
rotation is left behind.

1. Generate the new key: `openssl rand -base64 32`. Back it up.
2. Set `SECRETS_KEY_NEXT` for every process (web, worker) and restart them. Everything still works: rows are on the old
   key and read with it.
3. Run `scorpion rotate-secrets`. It re-encrypts the rows that are not on the new key, **one transaction per batch**, and for
   each row decrypts the new ciphertext and compares it with the plaintext **before the batch commits**. It prints how
   many rows moved and how many remain. It is **resumable**: stop it (or let it fail) and run it again. A row that
   cannot be decrypted with the two keys at hand stops the run with the secret's name; the rows before it stay readable
   and nothing is half-written.
4. When it reports `0 remain`, set `SECRETS_KEY` to the new key, remove `SECRETS_KEY_NEXT`, and restart. The old key is no
   longer needed (keep it until a backup that used it is gone).

At every moment each row decrypts with one of the keys the processes hold; tests prove old-key rows still read in the
middle of a run and that a failed run changes nothing it could not verify.

## User preferences

A per-user key/value, for what the interface remembers (theme, language, page size). A module **registers** its keys in
the registry `settings.userPreference` (it depends on `core.settings` to contribute):

```ts
contributes: {
  'settings.userPreference': [
    { key: 'core.ui.theme', description: 'Colour scheme', schema: z.enum(['light', 'dark']) },
  ],
},
```

- Keys are dot-separated lower-case segments, unique across the profile (a duplicate stops the start-up); by convention
  they start with the registering module's id. The schema validates every value; `null` is refused (remove the
  preference for the default); a value is at most 8 KiB as JSON.
- **Own preferences only, enforced in the service**: no method and no route takes a user id; the owner is always the actor
  (an Admin sees their own list too). Another user's preferences cannot be named.
- A stored preference whose registration is gone (its module left the profile) is kept and not shown.
- The event `settings.preference.changed@1` says which key of which user, never the value.

## Events

| Event                           | Payload                     | When                                                       |
| ------------------------------- | --------------------------- | ---------------------------------------------------------- |
| `settings.changed@1`            | `{ module, keys, version }` | A module's settings were saved. `keys`: names that changed |
| `settings.secret.changed@1`     | `{ name, removed }`         | A secret was set, replaced or removed (the CLI too)        |
| `settings.preference.changed@1` | `{ userId, key, removed }`  | A user set or removed a preference                         |

None carries a value, a secret or a key. Nothing subscribes yet; the audit trail (M4) will.

## Tables

| Table                      | Holds                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `settings_setting`         | `module_id` (primary key), `value` (jsonb), `version`, `updated_by`, `updated_at`                       |
| `settings_user_preference` | `id` (UUIDv7), `user_id` (no foreign key), `key`, `value`, unique `(user_id, key)`                      |
| `settings_secret`          | `id` (UUIDv7), unique `name`, `ciphertext`, `nonce`, `key_id`, `created_at`, `updated_at`, `updated_by` |

Upgrading from 0.3.x adds these tables with one migration and loses no data. Nothing is imported: OIDC secrets that were
in `OIDC_<ID>_CLIENT_SECRET` must be stored once with `scorpion set-secret`.

## Testing

`test/harness.ts` starts the real `core.authz` and this module over Postgres with a fixture module that has settings and
registers preferences. Factories `makeSetting`, `makeSecret`, `makePreference` and `makeSecretsKey` are in
`@scorpion/testing` (they know the secret format; a test proves the factory and the module agree). The route tests
(`apps/server/src/settings-routes.test.ts`), the denied cases (`defect-01.privilege-escalation.test.ts`) and the
two-process case (`defect-13.local-accounts.test.ts`) go through the whole pipeline.
