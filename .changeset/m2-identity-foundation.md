---
'scorpion': minor
---

New module `core.identity` (profiles `full` and `kpi-tracker`): the migration that runs at start creates the tables `identity_user`, `identity_auth_method`, `identity_session`, `identity_login_state` and `identity_token`. They hold users, the ways they sign in, sessions and personal access tokens; secrets are stored only as hashes (argon2id for passwords and token secrets). Nothing uses them yet: there are no sign-in routes in this release, so an instance behaves as before. The request pipeline gains an authentication step (a registry `kernel.authenticator`, filled by this module from the next release on): a request without credentials is anonymous, bad credentials are a 401 except on public routes. Until the authorisation module arrives, every route that is not public still answers 403.
