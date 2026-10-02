---
'scorpion': minor
---

The server now rate-limits every module route (step 2 of the request pipeline). Each client address and each bearer token or API key gets a token bucket in PostgreSQL, so the limit holds across several server processes. A request over the limit is answered with `429` problem+json and a `Retry-After` header. Routes have two budgets, `default` (a burst of 120, then 120 a minute) and `strict` (a burst of 10, then 10 a minute) for login, register and token routes; `/healthz`, `/readyz` and `/metrics` are not limited. The new table `kernel_rate_bucket` is created by the migration that runs at start; idle buckets are pruned. Set the new `TRUSTED_PROXIES` variable (comma-separated IPs or CIDR ranges) when the server runs behind a reverse proxy: only a request from one of those addresses may tell the server the client's address through `X-Forwarded-For`. Without it the socket address is used, so every client behind a proxy would share one bucket.
