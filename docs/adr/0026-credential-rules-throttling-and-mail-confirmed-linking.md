# ADR-0026: Credential rules, per-account throttling and mail-confirmed linking

- Status: Accepted
- Date: 2026-10-06
- Amends: [ADR-0011](0011-oidc-login.md) (a first sign-in no longer links by itself),
  [ADR-0012](0012-mail-tokens-and-mail-ordering.md) (a third mail-token purpose, the lifetime of the reset link),
  [ADR-0010](0010-first-run-token-and-bootstrap-admin.md) (the first administrator's password is checked)

## Context

M4a found eleven gaps in chapter V6 of the ASVS that are about the credentials of `core.identity`:

- A password is only checked for its length (6.2.4, 6.2.11, 6.2.12, 6.1.2).
- Brute force is limited per client address only. An attacker with many addresses can try as many passwords for one
  account as they like, and nothing documents the stance on lockout (6.3.1, 6.1.1).
- The reset link lives 60 minutes (6.5.5).
- A first OIDC sign-in whose provider says `email_verified` links to the account with that address and signs the person
  in. A provider, or anybody who runs one that is configured, can take over any account by asserting its address (6.8.1).
- There is no second factor and no written reason (6.3.3), and no document lists the pathways (6.1.3, 6.3.4).

Decisions 3, 5, 7, 8 and 11 of the M4b plan are taken. This ADR records how they are built and the readings of the
requirements they rest on.

## Decision

### 1. Password rules

Every code path that sets a password calls one function, `passwordPolicy.check(password, subject)`, before it opens a
transaction or hashes anything: register, reset, change, first-run token and `create-admin` (both of which end in the
bootstrap service). It runs on the password exactly as received (6.2.8). A refused password is a `422` that names the
field and the reason ("is a common or leaked password", "contains a word that is easy to guess") and never a count.
It is checked **before** the address's mail budget is spent and before the taken-address branch of registration, so a
refused password costs the caller nothing else and the two registration paths still answer alike.

**Breach check** (6.2.4, 6.2.12). The adapter `pwned-passwords` in `packages/integrations` asks the Have I Been Pwned
range API (`GET /range/<first 5 hex characters of SHA-1>`, `Add-Padding: true`). Only the 5 characters leave the server;
the password and the rest of the hash are never sent, logged or put in an event. It has a timeout (2 seconds) and an
in-memory cache of ranges (24 hours, bounded). The top 3000 passwords that 6.2.4 asks about are in that set.

The check **fails open**: when the service does not answer in time or with a success status, the password is accepted, a
warning without any password data is logged and the counter `scorpion_password_breach_check_failures_total` is
increased. Failing closed would turn an outage of a third party into a denial of service for every registration and
reset. The risk is that a breached password is accepted during an outage; the other rules and the throttle still apply,
and an offline floor of the 3000 most common passwords goes to the backlog. The setting `passwordBreachCheck` (default
`true`) turns the call off for an installation that may not call out. The assessment says `pass` for the default
configuration only, and `docs/security/authentication.md` says so.

The counter lives in the adapter, because a module cannot reach the server's metrics registry: `packages/integrations`
counts, and the server's `/metrics` reads the count. This avoids a new kernel API for one counter.

**Context words** (6.1.2, 6.2.11). A password is refused when it is, or contains as a whole word, one of: the instance
name, the product name and the public host from the settings and the configuration; the user's own username and the local
part of their address; and the documented list `Scorpion`, `de.NBI`, `NFDI`, `IPK`. Matching is case-insensitive on the
words of the password, split at everything that is not a letter or a digit and at letter-digit borders (`scorpion2024`
is the word `scorpion` and the number `2024`). A multi-word term matches as a phrase. A derived part (a word of an
instance name, a label of the host, a part of the local part) counts from 4 characters; a whole term from 3.
The list is in `docs/security/authentication.md`.

### 2. Per-account throttle without lockout (6.3.1, 6.1.1; M4b Decision 5)

A failed password login is counted in table `identity_login_throttle`, under two keys: the **account** (the submitted
username, lower-cased, whether it exists or not) together with the **network** (the client address), and the account
alone. Both keys are stored as SHA-256 hashes, so a mistyped password never ends up there and the table holds no
usernames.

After `freeAttempts` failures the key is blocked: failure number `f` beyond the free ones blocks it for
`baseDelaySeconds · 2^(f − freeAttempts − 1)` seconds, never more than `maxDelaySeconds`. The defaults are 5 free attempts
for an account on one network and 20 for the account alone, a first delay of 15 seconds that doubles (15, 30, 60, 120,
240, 480) up to a ceiling of 15 minutes, and counters that are forgotten after an hour without a failure. All of it is
the setting `loginThrottle`. The password checks of a signed-in session (re-authentication, change of password) count on
the account alone, because guessing the current password through a stolen session is the same attack.

While a key is blocked, a login answers **429 with `Retry-After`** before the password is looked at and without counting,
so waiting is the only thing that works and a blocked key cannot be extended by hammering it. The answer, its body and its
time are the same for a name that exists and one that does not, because the keys are made from the submitted text alone.
A successful login deletes both keys of that login.

There is **no hard lockout**: the block ends by itself and the ceiling is short. A hard lockout lets anyone who knows a
username lock that person out (the malicious lockout that 6.1.1 names). The residual risk is that someone who knows a
name can keep the account-only key blocked from many addresses; the person can still use the reset link and a provider,
and the delay is at most the ceiling. The pipeline's per-address bucket stays as it is; the throttle is in addition.

The service needs the client address, which only the pipeline can resolve (trusted proxies, `TRUSTED_PROXIES`): the pipeline sets
a request variable `clientIp`, and the route passes it to `login`. A domain error may carry `retryAfterSeconds`, which the
error mapper writes as `Retry-After`.

### 3. Lifetime of the mailed links (6.5.5; M4b Decision 7)

The **reset link** authenticates: whoever opens it may set the password and so becomes the account. It is an out-of-band
authentication request and lives 10 minutes (`RESET_TTL_MS`). The mail and the module README say so.

The **verification link** (24 hours) confirms that an address belongs to an account that already exists. Opening it
authenticates nobody: it creates no session, grants nothing, and can only mark the address as verified, which is what
the owner of the mailbox would do. 6.5.5 limits the lifetime of requests, codes and tokens that _authenticate_; the
earlier assessment of 6.5.1 to 6.5.4 counted mail links as out-of-band because they are single use and claimed by one
update, which is a property of any mail token and does not make the verification link an authentication request. If the
maintainer rejects this reading, the verification link also drops to 10 minutes and the mail says "request a new link";
that is a one-line change of `VERIFICATION_TTL_MS`. The new `oidc-link` token below does authenticate (it
adds a way to sign in), and lives 10 minutes.

### 4. A first OIDC sign-in no longer links (6.8.1; M4b Decision 11)

When a provider returns `email_verified` for an address that an existing account holds and the `sub` is not known, the
sign-in **links nothing and signs nobody in**. Instead the service stores a mail token of purpose `oidc-link` and mails it
to the **existing account's own address** (never to the address in the claims, which is the same text but is not the
provider's to choose), then answers the browser with the same neutral redirect whatever it found.

- **The token.** Purpose `oidc-link`, `sol_` and 43 base64url characters, hashed like every mail token (ADR-0012), single
  use, 10 minutes, one outstanding per account (a new one replaces the old). The table `identity_mail_token` gets the
  columns `provider` and `subject`; the check `identity_mail_token_purpose_known` gets the new purpose, a check ties
  `provider` and `subject` to that purpose, and `identity_mail_token_verification_has_email` stays as it is: only
  `email-verification` has an address.
- **The mail** is the new template `identity.oidc-link`, in every locale of the others. It names the provider and says
  "if you did not just try to sign in with <provider>, ignore this email". An attacker can make the mail go out by asserting
  someone's address at a provider they run, so the mail must not read as an alarm and must change nothing by itself.
- **Before any mail**: `email_verified` must be true; the address's mail budget is spent (so a flood is bounded); an account
  that is rejected or deleted gets no mail. The answer is the same in every one of these cases, the same redirect with the
  same body, and takes about the same time, because the work is a token insert and a queued mail.
- **The confirmation** is `POST /account/oidc-link/confirm` with the token, by a **signed-in** session of that account
  and after `requireRecentAuth` (ADR-0025). Only then is the identity linked (`identity.authMethod.linked@1`, `via:
email`). The token is claimed by one conditional update that also requires the caller's user id, so a token used
  from another account's session is refused without being spent, and a token used twice links once. A claim that finds
  the identity already linked elsewhere is a `409`, and the provider must still be configured.
- **What is not changed**: linking from the profile while signed in (it needs the recent authentication of ADR-0025), and
  the creation of a pending account for an address that no account holds. There is no `trustEmailForLinking` setting.

The neutral redirect cannot be indistinguishable from "no account matched": that path creates an account and, depending
on the approval policy, signs the person in or tells them to wait. The unavoidable difference only tells somebody who
already controls a verified address at a configured provider that an account with that address exists; that is the
same information the register-without-revealing mail (ADR-0022) gives to the owner and is acceptable.

### 5. No second factor of our own (6.3.3; M4b Decision 8)

ASVS 6.3.3 asks for multi-factor authentication or a documented reason. Scorpion has no TOTP, WebAuthn or recovery codes in
this milestone, because each needs a dependency, secret storage, recovery codes (which 6.5.x then governs) and screens, and
moves M4b from size M to L. The rationale and the compensating controls are in `docs/security/authentication.md`:
Argon2id with a unique salt; the breach and context checks; the per-address bucket and the per-account throttle;
10-minute reset links that end every session; the session list, its termination by the person and by an administrator
(ADR-0025); no linking by claim (this ADR); and the recommendation that an operator who needs a second factor requires it
at the OIDC provider, which Scorpion cannot see and treats as single factor unless the `acr` claim says otherwise.
What would bring it back: a profile that serves a regulated community, a request from an operator for TOTP at the
application, or an ASVS Level 3 target. TOTP is in `docs/backlog.md`.

## Consequences

- Passwords that were accepted before are not re-checked: nobody is locked out by the new rules. The rules apply when a
  password is set.
- An installation with no outbound network has to set `passwordBreachCheck` to `false`; the default calls out.
- A person whose provider asserts an address that an account holds has to confirm in their mailbox, signed in to the
  account. Operators need a changeset line for this.
- The reset link lives 10 minutes, which is short for a slow mail relay. The mail text says the time.
- ADR numbers: this ADR takes 0026, so the M5 plan's reserved numbers move to 0027 (the shell) and 0028 (the inbox stream).
