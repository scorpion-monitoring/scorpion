# @scorpion/integrations

Adapters for external services (SPDX licence list, DOI content negotiation, OpenAlex), each with a timeout, retry, a Postgres cache and a test stub.

**Filled in:** M4b (`pwned-passwords`), M7 (SPDX) and M16 (DOI, OpenAlex).

## `pwned-passwords` (M4b)

The Have I Been Pwned range API, for the password check of `core.identity` (ASVS 6.2.4, 6.2.12).

- `createPwnedPasswords(options)` sends only the first 5 hex characters of the password's SHA-1 (`GET /range/<prefix>`, `Add-Padding: true`); the password and the rest of the hash never leave the process. It times out after 2 seconds and keeps up to 1000 ranges in memory for 24 hours. No dependency: it uses Node's `fetch`.
- `check(password)` answers `breached`, `clean` or `unavailable`. `unavailable` (timeout, network, status) is counted in `pwnedPasswordFailures()`, which the server exposes as `scorpion_password_breach_check_failures_total`. The adapter does not decide what to do about it: `core.identity` accepts the password and logs a warning ([ADR-0026](../../docs/adr/0026-credential-rules-throttling-and-mail-confirmed-linking.md)).
- `createStubPwnedPasswords({ breached, unavailable })` never touches the network, for tests and for `NODE_ENV=test`.
