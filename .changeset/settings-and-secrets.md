---
'scorpion': minor
---

Settings, preferences and secrets are stored by the application instead of fixed in code or the environment. **This release
needs a new environment variable, `SECRETS_KEY`, and stops reading `OIDC_<ID>_CLIENT_SECRET`.**

- **`SECRETS_KEY` is required** by every profile that includes `core.settings` (`full` and `kpi-tracker`, and every profile
  with `core.identity`). It is 32 random bytes, base64 encoded: generate one with `openssl rand -base64 32`. Without a valid
  one `scorpion start`, `scorpion worker` and every module command stop with `Cannot start core.settings:` and say how to
  make one; `scorpion migrate` does not need it. Keep it with your backups of the database: without it the stored secrets
  cannot be read (set them again). `pnpm dev` generates one into `.env`; the image smoke test and `docker-compose.dev.yml`
  pass it through.
- **OIDC client secrets move to an encrypted store.** `OIDC_<ID>_CLIENT_SECRET` is no longer read, with no fallback. After
  upgrading, store each secret once: `scorpion set-secret oidc.<provider id>.client-secret` (the value is asked for or read
  from standard input, never taken from an argument). Until then a provider is a public client (PKCE only), which most
  providers refuse for a confidential client, and the start-up log names the providers that have no stored secret. Values
  are AES-256-GCM encrypted, write-only through the API, and in no log, event, error or response.
- **New commands.** `scorpion set-secret <name>` and `scorpion rotate-secrets [--batch-size <n>]`. To change the key: set
  `SECRETS_KEY_NEXT` to the new key everywhere and restart, run `scorpion rotate-secrets` (resumable; each row is verified
  before its batch commits), then set `SECRETS_KEY` to the new key, remove `SECRETS_KEY_NEXT` and restart. Steps in the
  README of `core.settings`.
- **New routes** (internal API). `GET /settings`, `GET /settings/{module}`, `GET /settings/{module}/schema` (JSON Schema for
  the admin form) and `PUT /settings/{module}` (validated by the module's own schema, `422` with the failing fields, `409`
  when the version is stale); `GET /secrets`, `PUT /secrets/{name}` and `DELETE /secrets/{name}` (names only, never a
  value); `GET /preferences`, `PUT /preferences/{key}` and `DELETE /preferences/{key}` (your own, for keys that modules
  register).
- **New permissions.** `core.settings.read`, `core.settings.write` and `core.settings.secret.write` belong to Admin only.
  `core.settings.preference.read` and `.write` are held by the role `user` (and Admin). New events:
  `settings.changed@1` (module and the names of the changed keys), `settings.secret.changed@1` and
  `settings.preference.changed@1`; none carries a value.
- **Settings take effect without a restart.** A change is seen at once by the process that saved it and by the other server
  processes within 5 seconds. Turning off `localAccounts` through `PUT /settings/core.identity` now makes register and
  login answer `403` everywhere within that time. The numbers that were fixed in code are now settings with the same
  values as defaults: the server's rate limits (`core.settings`: `rateLimits`), the retention of the cleanup job and the
  mail budgets (`core.identity`: `retention`, `mailBudgets`).
- **Database.** One new migration in the new module `core.settings` adds the tables `settings_setting`,
  `settings_user_preference` and `settings_secret`. An existing 0.3.x database loses nothing and needs no manual step
  except the two above (`SECRETS_KEY`, the OIDC secrets).
