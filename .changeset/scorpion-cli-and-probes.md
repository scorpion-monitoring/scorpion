---
'scorpion': minor
---

The `scorpion` command line and the operational endpoints are here. `scorpion start` applies pending migrations and serves; `scorpion worker` runs jobs and events without HTTP; `scorpion migrate` migrates and exits. The server reads `DATABASE_URL` (required), `PROFILE`, `PORT`, `BASE_PATH`, `LOG_LEVEL`, `WORKER_MODE` (`inline` or `separate`) and `ORIGIN`, and stops at start-up with a list of everything that is wrong; secrets never appear in logs. `GET /healthz` says the process is alive and never touches the database, `GET /readyz` answers 503 until the database answers and all migrations are applied, and `GET /metrics` serves Prometheus metrics (process, HTTP duration by route, outbox lag, job durations). On SIGTERM the server finishes running requests, jobs and event handlers (up to 30 s) before it exits. An image refuses a `PROFILE` other than the one it was built for. Run the image with `DATABASE_URL` set.
