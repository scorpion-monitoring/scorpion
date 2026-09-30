# @scorpion/testing

Test helpers shared by all packages and modules.

- `startPostgres()` starts a PostgreSQL 16 Testcontainer and returns `{ url, createDatabase, stop }`. `createDatabase()` makes an empty database next to the default one and returns its URL, so tests that share a container do not see each other's tables. Needs a running Docker daemon.
- Later: factories for every entity and contract-test helpers.

The kernel's own integration tests use a wider helper (`packages/kernel/test/helpers.ts`, `useKernels()`), which starts one container per test file and closes the kernels a test created. The [kernel guide](../kernel/README.md#testing-a-module) shows how to test a module.
