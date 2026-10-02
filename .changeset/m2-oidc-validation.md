---
'scorpion': minor
---

First step of OpenID Connect sign-in (defect 5): `core.identity` gets a setting `oidcProviders` (a list of `id`, `displayName`, `issuer`, `clientId`, `scopes`; empty by default, which keeps OIDC off), the checks an id_token must pass (signature by the provider's keys with RS256, PS256 or ES256, issuer, audience, expiry and nonce), a client for the provider's discovery document and keys (timeouts, size limit, caching), and the single-use login state. New migration: the table `identity_login_state` gets the columns `nonce_hash`, `binding_hash` and `link_user_id` (a login state lives 10 minutes, so no data is lost). New runtime dependencies `arctic` and `jose`. Nothing is reachable yet: the sign-in routes follow in the next releases of this series.
