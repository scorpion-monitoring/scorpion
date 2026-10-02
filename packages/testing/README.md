# @scorpion/testing

Test helpers shared by all packages and modules.

- `startPostgres()` starts a PostgreSQL 16 Testcontainer and returns `{ url, createDatabase, stop }`. `createDatabase()` makes an empty database next to the default one and returns its URL, so tests that share a container do not see each other's tables. Needs a running Docker daemon.
- `testAuthorizer(permissions)` is a stand-in for `core.authz` until M3: it lets a signed-in caller through for the permissions you list (`"*"` for all), 401 for anonymous, 403 otherwise. `testAuthorizerEntry()` is the same as a `kernel.authorizer` registry entry.
- `makeUser`, `makeAuthMethod`, `makeSession`, `makeToken` insert rows of `core.identity` for tests; the module must be migrated.
- Later: factories for the other modules and contract-test helpers.

The kernel's own integration tests use a wider helper (`packages/kernel/test/helpers.ts`, `useKernels()`), which starts one container per test file and closes the kernels a test created. The [kernel guide](../kernel/README.md#testing-a-module) shows how to test a module.
