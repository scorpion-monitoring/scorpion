# @scorpion/testing

Test helpers shared by all packages and modules.

- M0: `startPostgres()` starts a PostgreSQL 16 Testcontainer and returns `{ url, stop }`. Needs a running Docker daemon.
- M1: factories for every entity and contract-test helpers.
