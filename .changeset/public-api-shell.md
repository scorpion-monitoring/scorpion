---
'scorpion': minor
---

The public API (`/api/v1`) has its shell, with no data routes yet.

- New module `public-api` (in the `registry` and `full` profiles). `GET /api/v1/openapi.json` returns the OpenAPI document of the API this instance
  serves, anonymously; its server URL is the address of the request, and its title, description and contact are settings.
- Browsers: the setting `corsOrigins` of `public-api` lists the origins whose pages may call `/api/v1` (empty by default: same origin only). Each entry
  is an origin such as `https://app.example.org`. A change applies at once. The answer names the caller's own origin, never `*`, and never allows
  credentials; `/api/internal` is never opened to another origin.
- Every call of a v1 route that is audited is recorded in the `api` channel of the audit trail (also 401, 403, 422 and 429), with the route, the
  status and the token's id. Plan about 0.5 MB of database per 1000 calls.
- Rate limits: a call with a token or an API key now has its own address bucket, ten times the size of the `default` limit, apart from the one the
  browsers on that address use. Two programs behind one address no longer share a bucket and a script no longer uses up the budget of the people on its
  network. No configured limit changed; the `strict` group is as before.
