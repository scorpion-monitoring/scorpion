# Changelog

## 0.2.0

### Minor Changes

- 17021b0: Each profile image now contains only that profile's modules and their dependencies: nothing from other profiles, no tests and no dev tools, so images are smaller and a plugin that is not in the profile cannot run. The Docker build takes optional build arguments `PROFILE_FILE` and `MODULE_ROOTS` for profiles outside `profiles/`. CI checks every image for stray modules.
- f0fb4bf: The server has a request pipeline. Every response carries an `X-Request-Id` (an incoming valid one is kept) and security headers (HSTS, a strict Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy`, frame denial). Errors are RFC 9457 `application/problem+json` documents: invalid input is 422, a request body above 1 MiB is 413, and an unexpected error is a 500 that shows only the request id, never a stack trace. Routes are served under `BASE_PATH`, which can have any number of segments. Until the authorisation module exists, every route that is not explicitly public answers 403.
- a602078: The `scorpion` command line and the operational endpoints are here. `scorpion start` applies pending migrations and serves; `scorpion worker` runs jobs and events without HTTP; `scorpion migrate` migrates and exits. The server reads `DATABASE_URL` (required), `PROFILE`, `PORT`, `BASE_PATH`, `LOG_LEVEL`, `WORKER_MODE` (`inline` or `separate`) and `ORIGIN`, and stops at start-up with a list of everything that is wrong; secrets never appear in logs. `GET /healthz` says the process is alive and never touches the database, `GET /readyz` answers 503 until the database answers and all migrations are applied, and `GET /metrics` serves Prometheus metrics (process, HTTP duration by route, outbox lag, job durations). On SIGTERM the server finishes running requests, jobs and event handlers (up to 30 s) before it exits. An image refuses a `PROFILE` other than the one it was built for. Run the image with `DATABASE_URL` set.

### Patch Changes

- a6359d7: The project is licensed under the ISC licence. Every package now declares `"license": "ISC"` in its `package.json`.

## 0.1.1

### Patch Changes

- d6af528: The development stack and the integration tests now use pinned images (PostgreSQL 16.15 and Mailpit v1.31.3), so local and CI environments are reproducible. Pull requests that change only documentation no longer need a changeset. Nothing changes for running instances.

## 0.1.0

### Minor Changes

- 1bd1b73: M0: repository and toolchain bootstrap. The server answers `GET /healthz` with the active profile, the web app shows a placeholder page, and one container image is built per deployment profile (`full`, `denbi-registry`, `nfdi-onboarding`, `kpi-tracker`).
