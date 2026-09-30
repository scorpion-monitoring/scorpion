---
'scorpion': minor
---

The server has a request pipeline. Every response carries an `X-Request-Id` (an incoming valid one is kept) and security headers (HSTS, a strict Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy`, frame denial). Errors are RFC 9457 `application/problem+json` documents: invalid input is 422, a request body above 1 MiB is 413, and an unexpected error is a 500 that shows only the request id, never a stack trace. Routes are served under `BASE_PATH`, which can have any number of segments. Until the authorisation module exists, every route that is not explicitly public answers 403.
