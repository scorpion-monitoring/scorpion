# ADR-0029: A failed OIDC sign-in sends a browser to the sign-in page with a fixed code

- Status: Accepted
- Date: 2026-10-08

## Context

`GET /auth/oidc/{provider}/callback` is the one route a browser reaches by **navigation**: the provider redirects the person's
browser to it. When the sign-in fails, the route answered with problem+json (403 `account-pending`, 400 for an old or foreign state or a
provider that said no, 401 for an id_token that failed a check, 409 for an identity linked already, 502 for an unreachable provider), so
the person saw a page of JSON. That was acceptable while the API had no browser (M4b) and is not now (M5). The backlog proposed a redirect
to `/login?error=<code>`; it changes the answer of an API route, so the maintainer decided it (2026-10-08, M5 sprint 4).

Two things must not happen: text that the provider sent (`error_description`) reaching the address bar or a page, and a change that breaks a
client that is not a browser.

## Decision

1. **A browser is redirected; any other client keeps the problem answer.** When the callback fails with a failure of the sign-in itself and
   the request asks for `text/html` (every browser navigation does), the answer is `302` to the sign-in page under `BASE_PATH` with
   `?error=<code>`. A client that does not ask for HTML (a script, a test, `curl`) gets the same problem+json as before, so the OpenAPI
   document keeps its 4xx answers and nothing breaks for an existing caller. The change to the route is additive (a new 302 behaviour on
   a header the client chooses), not a v2.
2. **The code is from a fixed list and nothing else is in the address.** `account-pending`, `state-invalid`, `provider-denied`,
   `provider-unavailable`, `verification-failed`, `not-allowed`, `already-linked`. The mapping is one pure function of the error (status,
   problem type, the error class, and whether the provider itself sent an `error`); the detail text of the error is never read. A failure
   that is not one of the sign-in (a 500, a 404 for an unknown provider, a refused rate limit) keeps its answer; there is no catch-all code.
3. **The page owns the words.** The sign-in page reads `error`, keeps it only if it is on the list (anything else is ignored), and shows a
   translated message; `account-pending` shows the same pending-approval page as a password sign-in of such an account. The list lives in
   `core.identity`'s plain `problem-types.ts`, so the browser half and the server share it.
4. **Same hygiene as before.** The login cookie is cleared, the answer is `no-store` with `Referrer-Policy: no-referrer`, no session cookie is
   set on a failure, and the service still logs the reason code (never provider text).

## Consequences

- The sign-in page shows what went wrong in the person's language; no JSON in a browser tab.
- A failed re-authentication or link (the person is signed in) also ends on the sign-in page with a code. That is acceptable: the page
  says "you are signed in" and shows the message. A return to the page that asked is the re-authentication screen's backlog item.
- `GET /auth/oidc/{provider}/callback` now has two failure shapes by `Accept`; the contract tests and the e2e journey cover both.
- ASVS V10 (OIDC): the failure path leaks no provider text, which the tagged test proves.
