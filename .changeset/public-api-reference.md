---
'scorpion': minor
---

The documentation of the public API is now an interactive reference, and CI protects what was published.

- **The API reference at `/docs/reference`** (Scalar, served from the instance itself: nothing is loaded from another site and nothing is kept in the
  browser). It lists every `/api/v1` route with its parameters and answers, follows the light or dark choice of the site, and lets a person paste an access token
  and send a call from the page. It is public, like the description of the API; it is in English. The address of the document behind it and the server URL are
  the instance's own, also under a base path. Its policy differs from the other pages in one thing, `style-src 'unsafe-inline'`, which Scalar needs for its
  styles (ADR-0038); every other page keeps the strict policy.
- **The page `/docs` is now a landing page**: what v1 is, how to get a token in three steps (your profile, the permissions to tick, `Authorization: Bearer` or
  `X-API-Key`), the permission each route needs, the address of the OpenAPI document, a note that a browser application needs its origin in the `public-api`
  setting `corsOrigins`, and a link to the reference. English and German.
- **The OpenAPI document of v1 now says how to authenticate**: the security schemes `HTTPBearer` and `APIKeyHeader`, `security` on every route that needs a
  token, and "Needs the scope …" in each description. This is additive.
- **`pnpm openapi:diff`** compares the committed v1 document with the one of the last release tag and fails a breaking change (a removed path, field or enum value,
  a narrowed type, a new required request field, a removed security scheme); CI runs it. `pnpm test:contract` now runs the contract tests of the v1 routes.
- The web image carries the Scalar script (4.5 MB on disk, 1 MB as brotli, cached by the browser for a year); two new dependencies, `@scalar/sveltekit` and
  `@scalar/api-reference`, are pinned to exact versions.
