# Authentication

Every way a person or a program proves who they are to Scorpion, the controls each one has and the strength it can claim, how a
password is judged, how guessing is slowed, why there is no second factor of our own, and which words a password may not contain. It
documents what the code does and why; the decisions are [ADR-0026](../adr/0026-credential-rules-throttling-and-mail-confirmed-linking.md)
(this page's rules), [ADR-0008](../adr/0008-personal-access-tokens.md), [ADR-0010](../adr/0010-first-run-token-and-bootstrap-admin.md),
[ADR-0011](../adr/0011-oidc-login.md), [ADR-0012](../adr/0012-mail-tokens-and-mail-ordering.md) and
[ADR-0025](../adr/0025-absolute-session-lifetime-and-recent-authentication.md). Sessions after sign-in are in
[sessions.md](sessions.md). The module's routes and settings are in [modules/core-identity/README.md](../../modules/core-identity/README.md).
This page backs ASVS 5.0 requirements 6.1.1, 6.1.2, 6.1.3, 6.3.1, 6.3.3 and 6.3.4
([docs/security/asvs/v6-authentication.yaml](asvs/v6-authentication.yaml)).

## The pathways (6.1.3, 6.3.4)

There are six ways to authenticate. Nothing else makes a request an authenticated one: the request pipeline has one authentication
step, which accepts a session cookie or a bearer token and nothing else, and every route denies by default (ADR-0005). The routes that
need a person with a session refuse an access token (403), whatever its scopes.

| Pathway                                             | Proves                                  | Controls                                                                                                                                                                                                                                                                                                                                  | Strength                                                                                                                       |
| --------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Password** (`POST /auth/login`)                   | Knowing the account's password          | Argon2id hash with a salt; the same answer and about the same time for an unknown name; the per-address `strict` bucket and the per-account throttle (below); a pending account is told to wait, a rejected one is told nothing; the session it starts is opaque, expires, and is replaced on every login                                 | One factor (a memorised secret): **AAL1**                                                                                      |
| **OIDC** (`/auth/oidc/{provider}/…`)                | The provider's word that this is `sub`  | Authorization code with PKCE (S256), a nonce, a single-use state bound to the browser, full `id_token` validation (signature, issuer, audience, `azp`, expiry, nonce), `auth_time` checked when a fresh login is asked for; an identity is keyed by (provider, `sub`), and never linked by an address without the mailbox (see "Linking") | What the provider did, which Scorpion cannot see. It does not read `acr` or `amr`, so it **assumes one factor (AAL1)** (below) |
| **Personal access token** (`Authorization: Bearer`) | Holding a secret the owner created      | `scp_<prefix>_<secret>`: found by prefix, checked against an Argon2id hash, shown once; scopes limit it to permissions its owner holds; optional expiry, revocation, rotation; failures count in a per-address bucket; it can never reach a session-only route                                                                            | One factor (a stored secret), for programs: not an AAL claim for a person                                                      |
| **First-run token**                                 | Console access to the server at install | 256 random bits, kept as a SHA-256 hash, printed once to the console, never logged; single use, one hour; ends when any administrator exists; one `strict` route; refused with one answer for every bad token                                                                                                                             | Possession of the server's console; creates only the first administrator                                                       |
| **Mail tokens** (reset, address confirmation, link) | Control of a mailbox                    | 256 random bits as a SHA-256 hash, single use (one conditional update), one outstanding per account and purpose, the same 400 for every bad token, sent only to the account's own address, bounded by a per-address mail budget; lifetimes below                                                                                          | The mailbox is one factor. A reset link authenticates (10 minutes); the other two do not authenticate anybody                  |
| **`scorpion create-admin`** (the command line)      | A shell on the server with its secrets  | Not reachable over the network; the password is read from the terminal or stdin and never from an argument; the account is created active with the Admin role by the system; the same password rules apply                                                                                                                                | Operator access to the host                                                                                                    |

The **session cookie** is not a pathway of its own: it continues one of the first two. Re-authentication (ADR-0025) uses the password,
or a fresh provider login, and is asked before changing the address, linking a provider, and ending sessions.

**Lifetimes of the mailed links** (ASVS 6.5.5). A **password reset link lives 10 minutes**: opening it lets the holder choose the
password, so it is an out-of-band authentication request. A **link that confirms a provider** lives 10 minutes for the same reason: it
adds a way to sign in. An **address confirmation link lives 24 hours**: it confirms that an address belongs to an account that
already exists, creates no session and grants nothing, so it authenticates nobody (ADR-0026, section 3). The first-run token lives one hour.

**Fallback for a provider that sends no `acr`.** Scorpion does not evaluate `acr` or `amr` and has no rule that depends on the
authentication strength a provider reports. Every provider sign-in is therefore treated as a single factor, whatever the provider
did. An operator who needs more requires multi-factor authentication at the provider; Scorpion neither checks nor weakens that.

**Linking an identity** (ASVS 6.8.1). An address a provider asserts is not enough to enter the account that holds it. A first sign-in
whose verified address belongs to an existing account links nothing and signs nobody in: the account's own address is mailed a link that
names the provider, and the identity is linked only when the account holder, signed in to that account and recently authenticated,
opens it within 10 minutes. The answer to the browser is the same whether or not a mail went out. There is no setting that trusts a
provider's `email_verified` for linking. An account that has no password signs in at a provider it already has, which counts as the
recent authentication.

## How a password is judged (6.1.2, 6.2.4, 6.2.11, 6.2.12)

Length is 8 to 255 characters, with no composition rule, no trimming and no truncation; the password reaches the check and the hash
exactly as it was typed. A new password is checked by one function at every place one is set: registration, reset, change, the
first-run token and `scorpion create-admin`. A refused password is a `422` that names the field and the reason, and nothing is
counted, written or mailed.

1. **Context words.** A password is refused when it is, or contains as a whole word, one of the words below, in any letter case.
   "Word" means a run of letters or digits, so `my-Scorpion-key` and `scorpion2024` both contain `scorpion`, and `scorpions` does not.
   A name of several words is matched as a phrase (`de.NBI` is `de` then `nbi`) and written together (`denbi`). A part of a longer
   name counts alone from 4 characters (a word of the instance name, a label of the host, a part of the address before the `@`).
2. **Breached and common passwords.** The password's SHA-1 prefix (its first 5 hex characters, and only those) is sent to the
   [Have I Been Pwned range API](https://haveibeenpwned.com/API/v3#PwnedPasswords) with `Add-Padding: true`; the password is refused when
   its suffix is in the answer. The set contains the common passwords that 6.2.4 asks about and the passwords of public leaks. The third
   party sees a 5-character hash prefix of every new password, nothing else, and not who it is for.

**The words** (the list of 6.1.2):

| Source                                 | Words                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| The project, fixed in the code         | `Scorpion`, `de.NBI`, `NFDI`, `IPK`                                                                 |
| The instance name and the product name | Both, from the branding settings of `core.settings`; each longer word of them alone                 |
| The public host                        | The host name of the configured origin (`ORIGIN`), and each label of it of 4 or more characters     |
| The person                             | Their username, and the part of their email address before the `@` (and each longer part of either) |

**The breach check fails open.** When the service does not answer within 2 seconds, or answers with an error, the password is
accepted, a warning without any password data is logged, and the counter `scorpion_password_breach_check_failures_total` (on `/metrics`)
goes up. Refusing every registration and reset during a third party's outage would be a denial of service. What is lost is that a
breached password is accepted during an outage, for the length of it; the context words, the length rule and the throttle still apply.
An operator watches the counter. The assessment says `pass` for the **default configuration**: the setting `passwordBreachCheck`
(default `true`) turns the call off for an installation that may not call out, and then 6.2.4 and 6.2.12 do not hold for it. An offline
floor of the 3000 most common passwords is in the [backlog](../backlog.md).

Passwords are not re-checked when a rule changes: an old password keeps working until its owner changes it, so no rule locks anybody out.

## Guessing and credential stuffing (6.1.1, 6.3.1)

Three controls apply to a password login, in the order a request meets them. The settings are in `core.settings` and `core.identity`.

1. **The per-address bucket.** Every authentication route is in the `strict` rate-limit group: a burst of 10 requests, then 10 a minute,
   per client address (the address behind `TRUSTED_PROXIES` is used, never a header from an untrusted peer). Over it the answer is
   `429` with `Retry-After`. The setting is `rateLimits.strict` of `core.settings`; the defaults are the numbers above. A bearer token
   that fails counts in a bucket of its own per address (a burst of 10, then 10 a minute).
2. **The per-account throttle.** A failed password attempt is counted under two keys: the submitted username with the client address,
   and the username alone. After the free attempts the key is blocked for a delay that doubles with every further failure, up to a
   ceiling. While a key is blocked the answer is **`429` with `Retry-After`, given before the password is looked at and without
   counting**, so waiting is all that helps. A successful login forgets the keys of that login; counters are forgotten after an hour
   without a failure. The keys are SHA-256 hashes of the submitted text, so the table holds no name and no address, and a name that
   does not exist is counted and answered exactly like one that does (the answer, its text and its time are the same; tests compare them).
   The password checks of a signed-in session (re-authentication and changing the password) count on the username alone.
3. **The cost of one guess.** Argon2id with 64 MiB, 3 passes and 1 lane (RFC 9106 second option), a unique salt per password.

| Setting `loginThrottle.…` | Default | Meaning                                                                           |
| ------------------------- | ------- | --------------------------------------------------------------------------------- |
| `freeAttempts`            | 5       | Failures for one account from one network before it is blocked                    |
| `freeAttemptsPerAccount`  | 20      | Failures for one account from anywhere before it is blocked (a rotating attacker) |
| `baseDelaySeconds`        | 15      | The first block; each further failure doubles it (15, 30, 60, 120, 240, 480, …)   |
| `maxDelaySeconds`         | 900     | The ceiling: no block is ever longer than 15 minutes                              |
| `forgetAfterSeconds`      | 3600    | A counter without a failure for this long starts again                            |

**Lockout stance: there is no hard lockout.** An account is never disabled by failed logins. A lockout lets anybody who knows a username
lock that person out, which is the malicious lockout that 6.1.1 names. A block ends by itself within the ceiling, and the person's own
login from their usual network is not affected by an attacker's failures from another (the first key is per network). What remains is
that someone who knows a name and controls many addresses can keep the account-wide key blocked, 15 minutes at a time; the person can
still reset the password by mail (which is throttled by the mail budget, not by this) or sign in at a provider. A notice mail on
repeated failures, a CAPTCHA and other alternatives to a lockout are in the [backlog](../backlog.md).

Registration, reset requests and resend are not password guesses and have no counter of this kind; they have the `strict` bucket and
the mail budget of the address (3 mails an hour, 5 for a signed-in user), which also stop somebody from using Scorpion to flood a mailbox.

## No second factor of our own (6.3.3)

ASVS 6.3.3 asks for multi-factor authentication, or a documented reason together with controls that make up for it. Scorpion has no TOTP,
WebAuthn or recovery codes in this milestone. Each would need a dependency, storage for a secret per person in the encrypted store,
recovery codes (which ASVS 6.5 then governs) and screens, and it would move the milestone from size M to L; for this data
classification (see [sessions.md](sessions.md)) that was not judged worth it. The controls that make up for it:

- Argon2id with a salt and the cost above; the length rule, the breach and context checks, so the passwords people choose are not the
  ones that are guessed first;
- the per-address bucket and the per-account throttle, so a guess costs time that grows with the number of failures;
- a reset link that lives 10 minutes, is single use, goes only to the account's mailbox and ends every session of the account;
- no way into an account by a claim: an identity is linked only after the account's mailbox and the signed-in holder confirm it;
- recent authentication before changing the address, linking a provider and ending sessions; a list of one's own sessions, and an
  administrator who can end one user's or every session (sessions.md);
- an operator who needs a second factor requires it **at the OIDC provider** and lists only that provider; Scorpion's own password login
  can be turned off with the setting `localAccounts`.

What would bring it back: a profile that serves a community with sensitive data, an operator who cannot require it at a provider, or a
Level 3 target. TOTP is in the [backlog](../backlog.md). This is the rationale the requirement allows; the entry in the assessment
passes on it and says so.

## Is every pathway the same? (6.3.4)

One code path per pathway, called by every entry point (the service layer is the only way to change data): the password login by
`accounts.login`, a provider login by `oidc.complete`, a token by the authenticator in the pipeline, the first-run token and the
command by `bootstrap`, mail tokens by `mail-tokens`. The walker test of defect 1 lists every route of the running server and fails when
a non-public route has no permission, or a public one has no stated reason; the same walker checks that a token caller is refused on
every session-only route. A new route cannot be an undocumented way in without failing it.

## Where the controls are tested

| Control                                       | Test                                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Context words                                 | `password-words.test.ts` (table), `password-policy.test.ts` (every entry point)                                            |
| Breach check: hit, miss, timeout, off         | `packages/integrations/src/pwned-passwords.test.ts` (the adapter), `password-policy.test.ts` (the service)                 |
| Throttle: slowed, not locked, the same answer | `login-throttle.test.ts` (clock, rollback, enumeration), `apps/server/src/credentials-routes.test.ts` (429, `Retry-After`) |
| Reset link of 10 minutes                      | `recovery.test.ts`                                                                                                         |
| Mail-confirmed linking                        | `oidc-accounts.test.ts`, `oidc-link.test.ts`, `oidc-accounts-routes.test.ts`, `oidc-keycloak.test.ts`                      |
| Every pathway is denied by default            | `apps/server/src/defect-01.privilege-escalation.test.ts`                                                                   |
