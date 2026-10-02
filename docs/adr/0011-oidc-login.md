# ADR-0011: OIDC login, login state and id_token validation

- Status: Accepted
- Date: 2026-10-02

## Context

Defect 5 (FEATURES §5): the old app's OIDC login had no PKCE, no nonce and no id_token validation, crashed on an
unknown state, and copied the client secret into its `auth_codes` table. Sprint 4 of M2 rebuilds it. Three things
had to be decided that the plan leaves open: what `arctic` does for us, where the PKCE verifier lives when there is
no secrets store yet (M3), and how the callback is protected against login CSRF.

`arctic` 3.7 (read, not assumed) builds the authorisation URL with PKCE S256, and posts the code exchange with
client authentication. It does **not** do discovery, does not verify an id_token signature or any claim
(`decodeIdToken` only decodes), and its token request has no timeout or abort signal.

## Decision

### Libraries

- `arctic`: authorisation URL with PKCE S256, `state`, the code exchange. We add `nonce` to the URL ourselves.
- `jose` (new, besides arctic): verification of the id_token signature and the registered claims. Hand-written
  JWS verification is the classic place for algorithm-confusion and key-selection bugs; `jose` is a small,
  dependency-free, widely audited library with an algorithm allow-list. We use `createLocalJWKSet` over a JWKS that
  we fetch ourselves (so the fetch has our timeout, size limit, cache and a test double), and `jwtVerify` with
  `algorithms: ['RS256', 'PS256', 'ES256']`, `issuer`, `audience`, `clockTolerance: 60`.
- Discovery (`/.well-known/openid-configuration`) is ours: the document's `issuer` must equal the configured one
  character for character, and the endpoints must be https (http only for localhost).

### Checks on the id_token (all must pass, otherwise 401 and no session, no user)

Signature by a key of the provider's JWKS selected by `kid` and `alg`; `alg` in the allow-list (so `none` and `HS*`
are refused, which also closes algorithm confusion); `iss`; `aud` contains our client id; `azp` equals our client id
when present and is required when `aud` has several entries; `exp` (required), `nbf`, and `iat` (required, not more
than 60 s in the future); `sub` a non-empty string of at most 255 characters; `nonce` equal to the one this login
sent (compared as SHA-256 hashes in constant time). Claims other than `sub`, `email`, `email_verified`,
`preferred_username` are not read, and `email_verified` counts only when it is the boolean `true`.

### Login state: nothing secret in the database

`identity_login_state` holds the provider id, the SHA-256 of `state`, the SHA-256 of `nonce`, an expiry (10 minutes)
and, for linking, the user id. The PKCE verifier is **not stored at all**: it is the value of a cookie
`__Host-oidc-login` (`Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`) in the browser that started the login,
and the table keeps only its SHA-256, which is the PKCE `code_challenge` (`binding_hash`).

- The verifier is recoverable at callback time (from the cookie), needs no encryption key and no secrets store, and
  a stolen database leaks nothing that completes a login. A client that has the authorisation code but not the
  cookie cannot redeem it, which is what PKCE is for. The cookie is HttpOnly, so scripts cannot read it.
- `SameSite=Lax` still sends the cookie on the top-level GET redirect back from the provider. It is a different
  cookie from the session cookie: the callback never depends on the session.
- Rejected alternatives: encrypting the verifier in the table (needs a key that does not exist before M3, and
  moves the problem); an HMAC-derived verifier (same key problem); keeping the verifier in the table in the clear
  (a database reader could redeem a code they also intercepted).

### Login CSRF

`state` alone does not stop login CSRF: an attacker can start a login, keep their own `state` and `code`, and make
the victim's browser open the callback, signing the victim in as the attacker. The `state` row is therefore also
bound to the browser: the callback needs the login cookie whose hash equals `binding_hash`. A callback from a
browser that did not start the login (no cookie, other cookie) is the same 400 as an unknown state.

- **Start is `POST`** and returns `{ authorizationUrl }`: it creates a row and sets a cookie, and ADR-0007 says a
  `GET` must never change state. The browser then navigates to the URL.
- **The callback is `GET`** (the provider redirects the browser) and completes the login this browser started; it
  does nothing else. It does not need the session cookie and ignores a stale one.
- **Consuming the state is one atomic `DELETE ... RETURNING`** of an unexpired row, so two parallel callbacks with
  the same `state` give one winner and one 400. An unknown, expired, replayed or other-browser state is a 400
  problem, never a crash. The state is consumed before anything else is checked, so a failed callback cannot be
  retried either.
- **A signed-in caller who starts a login** gets a normal login flow (switching accounts is legitimate); the
  session they hold is ended when the new one begins. Linking is a separate, session-only route.

### Provider configuration and the client secret

Providers are `settings.oidcProviders` (`id`, `displayName`, `issuer`, `clientId`, `scopes`); none by default,
which turns OIDC off. The redirect URI is fixed by the route:
`<ORIGIN><BASE_PATH>/api/internal/auth/oidc/<id>/callback`; the operator registers exactly that at the provider
(a configurable path could only point to something that is not the callback). The client secret is read from the
environment variable `OIDC_<ID>_CLIENT_SECRET` (the id upper-cased, `-` replaced by `_`) by one function,
`clientSecretFor()`; M3 changes that function to read the encrypted secrets store. Without a secret the client is
a public client (PKCE only). The secret is in no setting, log line, response, event or error message.

### OIDC and `localAccounts`

`localAccounts` governs the password only (defect 13). OIDC is a separate way in and has no setting of its own:
a provider listed in `oidcProviders` is on, an empty list is off.

### Provisioning and linking

- First login with an unknown `(provider, sub)` creates a user through `createUser`. The status comes from the
  `auth.approvalPolicy` registry with `provider` set to the provider id and `emailVerified` true only when the
  provider said `email_verified === true`. The email is stored **only when verified**; an unverified claim is
  ignored (no address, nothing to collide with).
- The username is derived from `preferred_username`, else the local part of the verified email, else `user`:
  normalised, reduced to `[a-z0-9_-]`, padded and cut to the length rules, made unique with a hash suffix of the
  provider and subject. Claims decide nothing else.
- **Linking by email** happens only when the provider says the address is verified and the existing account's
  address is verified too. When the existing account's address is **not** verified (a password account whose owner
  has not confirmed it), nothing is linked and the login is a 409: the person is told to sign in the usual way and
  link the provider from their profile. We never silently take over an account by an address nobody proved.
- **Linking from the profile**: a session-authenticated route (`core.identity.auth-method.link`; a token caller
  gets 403) starts a flow whose state carries the user id; the callback adds the identity to that user. An
  identity already linked to anyone, or a provider the user already has, is a 409.
- The provider's word on an address is trusted for linking and nothing else, so an operator lists only
  providers that verify email addresses (a provider that lets anyone claim any address as verified would let
  that person take over the accounts with a verified address). `email_verified` counts only as the boolean `true`.
- Pending accounts get no session (403 "waiting for approval"), rejected and soft-deleted accounts get a
  401 with the same text as a wrong login; neither says anything about other accounts.

### Bootstrap

OIDC provisioning never sets `is_bootstrap_admin` (ADR-0006, ADR-0010); `createUser` has no way to. "No
administrator yet" is "no active, non-deleted user". With the `manual` policy an OIDC account is `pending`, so
the first-run token stays available. An approval policy that activates OIDC accounts automatically (a later
contribution) makes the first such account an active user and ends the bootstrap path; that is the safe side
(nobody becomes administrator by it) and is stated here so a future policy author knows.

### Failures

| Situation                                                                                       | Answer |
| ----------------------------------------------------------------------------------------------- | ------ |
| Missing or oversized query parameter, bad provider id syntax                                    | 422    |
| Unknown, expired, replayed or other-browser `state`; provider returned an `error`; code refused | 400    |
| id_token fails any check, or the provider returned none                                         | 401    |
| Unknown provider id                                                                             | 404    |
| Discovery, JWKS or token endpoint unreachable, slow or answering rubbish                        | 502    |
| Existing local account with an unconfirmed address                                              | 409    |

Logs carry the provider id, a reason code and the user id; never a code, state, nonce, verifier, token, secret or
the provider's error text.

### Events

Provisioning emits `identity.user.registered@1` (it fits as is), in the transaction that creates the user and its
auth method. Linking emits the new `identity.authMethod.linked@1 { userId, username, provider, via }` with `via`
`email` or `profile`; it never holds the subject or an address. Logging in emits nothing, as with a password.

## Consequences

- A new dependency `jose` besides `arctic`.
- Arctic's token request cannot be aborted, so the code exchange is bounded by `Promise.race` with a timeout; the
  socket may live on in the background until it ends by itself.
- A login started in one browser cannot be finished in another; that is intended. Two logins started in one
  browser at the same time share the one login cookie, so only the later one can finish; the earlier gets a 400.
- Two `__Host-` cookies exist now; both need `Secure`, so local development over plain http needs a browser that
  treats `localhost` as secure (all current ones do).
- M3 changes `clientSecretFor()` and the settings source, and nothing else here.

## Update (M3 sprint 3)

`clientSecretFor()` is replaced by `clientSecretFrom(settings)`, which asks the secrets store of `core.settings` for
`oidc.<provider id>.client-secret`. There is no environment fallback: `OIDC_<ID>_CLIENT_SECRET` is not read
([ADR-0016](0016-secrets-store-and-key-rotation.md)).
