# M4b Sprint Plan: Close the ASVS gaps in identity and authorization

Status: proposed, 2026-10-06. Decisions 1 to 11 (§9) were taken on 2026-10-06. Nine took the recommendation; Decision 3 chose the Have I Been Pwned range API instead of an offline list, and Decision 11 replaced a per-provider setting with mail confirmation.
Scope source: the `fail` entries of `docs/security/asvs/v6-authentication.yaml`, `v7-session-management.yaml` and `v8-authorization.yaml` after
M4a sprint 2 ([m4a-sprint-plan.md](m4a-sprint-plan.md)), and [implementation.md](implementation.md) §8 and Gate 1. Closes no defect of FEATURES §5.
Release: `0.6.0` (Decision 1). M5 then releases as `0.7.0`.

M4a made the claims checkable and found what is not true yet. Gate 1 needs every ASVS chapter with **no `fail` entry**, and the first
pass by the maintainer is only worth making once the gaps are closed. M4b fixes the gaps that are about code and documentation of
`core.identity`, `core.authz` and the pipeline. It changes runtime behaviour (session lifetime, password rules, reset link lifetime, account linking),
so unlike M4a it has user-visible changes and a release of its own. It runs before M5, so that the screens of M5 (session list, password
change, re-authentication prompt, user management) are built on routes that already exist.

M4b is size M (about 2 weeks for one developer). Three sprints, each one `feature/m4b-*` branch and one pull request into `dev`.

## 0. Before sprint 1

1. M4a sprint 2 is merged. The four chapter files exist, and every `fail` entry links to a plan section: this plan for the M4b requirements, the M5 plan for the three browser ones.
2. **How the `fail` notes are linked while M4b is open (Decision 2).** No tracking issues and no gap issues are created: this plan is the tracking. Rule 3 of
   implementation.md §8.2 changes (in the M4a pull request, together with `tools/asvs-report` and the docs): a `fail` note links either an issue or the section of a sprint plan
   that schedules the fix (`docs/m4b-sprint-plan.md#5-sprint-2-credentials-throttling-and-linking`). The tool checks that the plan file and the heading exist, so a link cannot
   rot silently. Each sprint's pull request moves its requirements from `fail` to `pass`.
3. The 3 requirements that need a browser are **not** M4b: 6.2.6 and 6.2.7 (password fields, paste, password managers) and 7.4.4 (logout on every
   authenticated page). They stay `fail` until M5 ships the screens and a Playwright test (M5 sprints 2 and 3).
4. Add the lines in §10 to `implementation.md` (an M4b entry, the overview row, the M5 release number). The M5 plan already carries the three browser requirements in its hand-off
   table (6.2.6, 6.2.7, 7.4.4) and the release number `0.7.0`; its sprints consume the M4b routes.
5. ADRs: sprint 1 takes ADR-0025, so the M5 plan reserved ADR-0026 (the shell) and ADR-0027 (the inbox stream); sprint 2 takes ADR-0026 (credential rules, throttling and mail-confirmed linking), written as the first commit of the sprint, so the M5 plan now reserves ADR-0027 (the shell) and ADR-0028 (the inbox stream). It amends ADR-0010, ADR-0011 and ADR-0012.

## 1. The gaps and where they are closed

22 of the 25 `fail` entries are M4b. Requirement ids are those of the YAML files.

| Requirement   | What is missing today                                                                                           | Fix                                                                                            | Sprint |
| ------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------ |
| 7.3.2         | `expiresAt` slides on every use and `createdAt` is never consulted: a used session never expires                | Absolute lifetime, enforced in `sessions.resolve`                                              | 1      |
| 7.3.1, 7.1.1  | The 7-day inactivity rule has no written risk analysis; no absolute lifetime documented                         | Session policy document with the analysis and the NIST SP 800-63B deviations                   | 1      |
| 7.1.2         | Concurrent sessions undocumented                                                                                | Decide and document the limit (Decision 6)                                                     | 1      |
| 7.5.2         | No list of own sessions, no end-one, no re-authentication                                                       | `GET /account/sessions`, `DELETE /account/sessions/{id}`, behind re-authentication             | 1      |
| 7.4.5         | An administrator cannot end the sessions of one user or all users                                               | Admin routes with a new permission, audited                                                    | 1      |
| 7.5.1         | Changing the email address or linking an OIDC identity needs only the session                                   | Re-authentication ("recent authentication") before both (Decision 4)                           | 1      |
| 7.1.3, 7.6.1  | Federated sessions undocumented; IdP not consulted after login                                                  | Document, and check `auth_time` where re-authentication is asked of the IdP                    | 1      |
| 6.2.4, 6.2.12 | No common or breached password check                                                                            | Offline list, checked on register, reset and change (Decision 3)                               | 2      |
| 6.1.2, 6.2.11 | No context-specific word list                                                                                   | A documented list built from settings (instance name, product name, host) and checked          | 2      |
| 6.3.1, 6.1.1  | Only a per-IP strict bucket; no per-account control; the brute-force stance is not documented                   | Per-account throttle without hard lockout (Decision 5), documented                             | 2      |
| 6.5.5         | Reset link lives 60 minutes, above the 10-minute maximum for out-of-band requests                               | 10 minutes for the reset link, interpretation of the verification link in the ADR (Decision 7) | 2      |
| 6.8.1         | A first OIDC sign-in links to an account with the same verified email, so a provider can take over that account | Link only after the account's own mailbox confirms it (Decision 11)                            | 2      |
| 6.3.3         | Password alone; no MFA and no written rationale                                                                 | Documented rationale with mitigating controls, TOTP into the backlog (Decision 8)              | 2      |
| 6.1.3, 6.3.4  | Authentication pathways are not documented together                                                             | One document listing every pathway with its controls and strength                              | 2      |
| 8.1.2         | Field-level rules are not documented                                                                            | `docs/security/authorization.md` with the rules per object                                     | 3      |
| 8.2.3         | The response side was never audited                                                                             | Audit of every route's response schema, plus a walker test (Decision 9)                        | 3      |

6.8.4 changes status inside sprint 1: the moment the application asks the provider for a recent authentication, it **expects recentness**, so `n/a` becomes
`pass` only if `auth_time` is validated (sprint 1 does that), and `fail` otherwise. The YAML entry is rewritten with the sprint.

## 2. Cross-sprint rules

- Stay inside M4b. A fix that needs a screen goes to M5; a new feature (TOTP, a risk-based login, an admin UI) goes to `docs/backlog.md`.
- **One pull request per sprint** (CLAUDE.md). ADRs, READMEs, backlog lines, the YAML updates and the issue checklists go into the sprint's pull request.
- These are scoped paths, so every pull request updates the matching chapter files in the same change (CLAUDE.md "Security assurance"). Each requirement a sprint
  fixes moves from `fail` to `pass` **only** with a tagged test that passes or a code or document pointer that exists; the tool refuses it otherwise.
  Nothing moves to `n/a` to make a count better. The human fields stay empty until Gate 1.
- Behaviour changes carry real changesets (`patch` for a fix, `minor` for a feature), written for operators and API users. Migrations are generated with
  `pnpm db:generate`; the module README is updated with every new permission, route, setting key and event (CLAUDE.md "Working style").
- Every service method has an integration test against real Postgres including a denied-permission case, and a rollback case for multi-row writes.
  Nobody may change their own role or approve their own request: the tests that prove it stay.
- No new runtime dependency without a reason in the pull request description (Decision 3 uses Node's `fetch`).
- Secrets and tokens never go to logs or responses. The new documents live in `docs/security/` and are scoped, so the `asvs-impact` workflow applies to them too.

## 3. Sprint overview

| Sprint | Branch                    | Theme                                                                                           | Fixes (requirement ids)                                                       |
| ------ | ------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1      | `feature/m4b-sessions`    | Absolute lifetime, session list and end, admin termination, re-authentication, policy           | 7.1.1, 7.1.2, 7.1.3, 7.3.1, 7.3.2, 7.4.5, 7.5.1, 7.5.2, 7.6.1 (and 6.8.4)     |
| 2      | `feature/m4b-credentials` | Password blocklist, per-account throttle, reset lifetime, mail-confirmed linking, MFA rationale | 6.1.1, 6.1.2, 6.1.3, 6.2.4, 6.2.11, 6.2.12, 6.3.1, 6.3.3, 6.3.4, 6.5.5, 6.8.1 |
| 3      | `feature/m4b-authz-docs`  | Authorization rules and field-level audit, closing the assessment                               | 8.1.2, 8.2.3                                                                  |

Order matters. Sprint 1 first, because re-authentication is used by sprint 2's linking change and by M5's screens. Sprint 3 is small and closes the milestone.

## 4. Sprint 1: sessions and re-authentication

**Goal:** a session has an end, a user can see and end their sessions, an administrator can end anyone's, and sensitive changes need a recent authentication.

1. **Absolute lifetime** (7.3.2). Migration: `identity_session.absolute_expires_at` (set from `createdAt` on create, backfilled for existing rows). `sessions.resolve` refuses a
   session past it and never slides `expiresAt` beyond it. The two limits are settings of `core.identity` with defaults (Decision 10: 7 days inactivity, 30 days absolute),
   read through the settings port, not constants. Table-driven unit tests with an injected clock; an integration test that a session used every day still dies at the cap.
2. **Recent authentication** (7.5.1; Decision 4). A column `identity_session.authenticated_at` (set at login, updated by re-authentication) and a service method
   `reauthenticate(session, credential)`: the current password for an account that has one, a fresh OIDC login (`prompt=login`, `max_age=0`, `auth_time` checked
   against the request time, ADR-0011 amended) for an account that has none. `core.identity` exposes `ctx`-level `requireRecentAuth(actor, maxAgeSeconds)` that
   throws a domain error the error mapper turns into `401` with a stable `problem+json` type (`reauthentication-required`). Used before: changing the email
   address, linking an OIDC identity, ending sessions from the list (7.5.2), and changing the password (which already asks for it). The window is a setting (default 5 minutes).
3. **Session list and end** (7.5.2). `GET /account/sessions` (id, created, last seen, current flag; no secret, no hash) and `DELETE /account/sessions/{id}`,
   scoped to the caller (resource check in the service, not only the route permission). The list shows times and the current marker only (Decision 6); no user agent or address is stored. Own-data tests, including that another user's session id answers like an
   unknown one.
4. **Administrator termination** (7.4.5). New permission `core.identity.session.manage-any`, held by Admin only. `POST /users/{id}/sessions/revoke` and
   `POST /system/sessions/revoke-all` (the second needs the permission and is audited with the count). Both call `SessionService.revokeAll` and drop the 5-second cache entry
   for those sessions, so the effect is not delayed (this also closes the caveat of 7.4.2). Denied-permission and rollback tests; the Admin cannot be locked out by `revoke-all`
   (the caller's own session survives, stated in the route text).
5. **Session policy document** `docs/security/sessions.md` (7.1.1, 7.1.2, 7.1.3, 7.3.1, 7.6.1): the two lifetimes with the risk analysis behind them and each deviation from
   NIST SP 800-63B, the concurrent-session decision and what happens at a limit (Decision 6), how an OIDC session relates to the provider's (independent after login,
   re-authentication through `auth_time`, no back-channel logout and why), and the cache bound. ADR-0007 is amended (absolute lifetime, recent authentication).
6. **Assessment.** 7.1.1, 7.1.2, 7.1.3, 7.3.1, 7.3.2, 7.4.5, 7.5.1, 7.5.2 and 7.6.1 move to `pass` with tags and document pointers; 7.4.2's note loses its caveat; 6.8.4 is rewritten
   as described in §1. Tag the new tests `[ASVS-x.y.z]`.

Definition of done: `pnpm check`, the tests of `core-identity` and `apps/server`, the full `pnpm test`, and `pnpm security:asvs` in strict mode. The pull request description lists the
`pass` entries it added and what evidence each one has.

## 5. Sprint 2: credentials, throttling and linking

**Goal:** the password rules, the brute-force controls and the account-linking rule match the ASVS, and the authentication pathways are written down once.

1. **Password breach check** (6.2.4, 6.2.12; Decision 3). An adapter `pwned-passwords` in `packages/integrations` (the pattern of the SPDX, DOI and OpenAlex adapters: cache, timeout,
   stub) calls the Have I Been Pwned range API. Only the first 5 hex characters of the SHA-1 of the password leave the server (k-anonymity), with `Add-Padding: true`, over TLS, with a short
   timeout and an in-memory cache of ranges; the password itself is never sent or logged. The check runs in the service that sets a password (register, reset, change, first-run, the
   `create-admin` command), on the password exactly as received (6.2.8). A password that appears in the set is refused with `422` and a message that does not say how often. The
   most common passwords (the top 3000 that 6.2.4 asks about) are in that set. **When the service does not answer** the check fails open: the password is accepted, a warning is logged and
   `scorpion_password_breach_check_failures_total` counts it, because refusing every registration and reset during a third-party outage would be a denial of service. A setting
   `passwordBreachCheck` (`on` by default, `off` for an installation that may not call out) is read through the settings port; the assessment says `pass` for the default configuration
   only. The privacy text (M5) names the third party. No new runtime dependency (Node's `fetch`). Tests use the stub adapter: a hit, a miss, a timeout (accepted and counted), the
   `off` setting, and one test per entry point.
2. **Context words** (6.1.2, 6.2.11). The words are derived from settings (instance name, product name, public host, the user's own username and email local part) plus a short
   documented list for the project (Scorpion, de.NBI, NFDI, IPK). They are refused as the password or as a whole word inside it, case-insensitively. The documented list is part of
   `docs/security/authentication.md`.
3. **Per-account throttle** (6.3.1, 6.1.1; Decision 5). A counter keyed on the account (not only the IP) for failed password attempts, with exponential delay and a ceiling, **no
   hard lockout** (that is the malicious-lockout risk the requirement names). Over the limit the answer is `429` with `Retry-After`, the same answer for an unknown username (no user
   enumeration), and a successful login resets the counter. A notice mail on repeated failures is a backlog item, not M4b. Settings for the thresholds; integration test with
   injected time and a rollback case.
4. **Reset link lifetime** (6.5.5; Decision 7). `RESET_TTL_MS` becomes 10 minutes. The documented position on the verification link (24 h: it confirms an address, authenticates nobody) goes
   into the ADR; if the maintainer rejects that reading, the verification link also drops to 10 minutes and the mail text says "request a new link".
5. **Linking by mail confirmation** (6.8.1; Decision 11). A first sign-in through a provider whose verified email matches an existing account no longer links and no longer signs in. The
   service creates a single-use mail token (purpose `oidc-link`, stored hashed like the other mail tokens of ADR-0012, 10 minutes, so it also meets 6.5.5) that remembers the provider and
   the subject, and mails it to the **existing account's own address**. The browser gets the same neutral "check your mail" answer whether or not an account matched (ADR-0022, no
   enumeration). The link opens a page that names the provider and asks the account holder to confirm while **signed in to that account**; only then is the identity linked. The mail says
   "if you did not just try to sign in with <provider>, ignore this", because an attacker can trigger the mail by asserting someone's address at a provider they run; the signed-in
   confirmation and the mail budget per address (already in `core.identity`) limit what a careless click can do. A sign-in with an address that matches no account creates the pending
   account as today. Linking from the profile page while signed in stays, behind the re-authentication of item 2. There is no `trustEmailForLinking` setting. Tests: a provider that
   asserts a victim's address links nothing and signs nobody in; the confirmation links exactly once, expires after 10 minutes, and is refused for another account's session; the Keycloak
   test covers the whole flow. The `email_verified` claim is still required before any mail is sent. A changeset tells operators that sign-in no longer links by itself.
6. **MFA position** (6.3.3; Decision 8). ADR-0026: why Scorpion has no own second factor in this milestone, the mitigating controls (Argon2id, strict and per-account throttling, the
   blocklist, short reset links, session list and termination, and the recommendation that operators enable MFA at the OIDC provider), and what would bring it back. 6.3.3 moves to `pass` only on the strength of this documented rationale, as the requirement itself allows, and the entry says so.
7. **Authentication document** `docs/security/authentication.md` (6.1.1, 6.1.3, 6.3.4, and the list of 6.1.2): every pathway (password, OIDC, PAT, first-run token, mail tokens, the
   `create-admin` command) with the controls and the authentication strength each one enforces, the rate-limit and throttle settings, the lockout stance, and the fallback assumption
   about the strength of a provider that sends no `acr` (single factor).
8. **Assessment.** Move the entries above to `pass` with tagged tests or document pointers; tags on `it.each` titles only where a dedicated test is not practical, and then say so in the note.

Definition of done as in sprint 1, plus: no password in any log, response or audit payload (existing tests stay), and the OIDC Keycloak test passes, including the mail-confirmed linking.

## 6. Sprint 3: authorization rules and closing the assessment

**Goal:** the field-level rules are written down and the response side is audited, then the three chapter files are checked end to end.

1. **Authorization document** `docs/security/authorization.md` (8.1.2, and the single matrix of 8.1.1 that M4a left spread over several documents): per object (user, role, token, session,
   inbox item, setting, vocabulary, blob, audit entry) who may read and write which fields, which fields only a dedicated route may change (status, roles), and which are never returned
   (hashes, secrets, other users' tokens).
2. **Response-side audit** (8.2.3; Decision 9). Read every route's response schema; fix a leak in a one-line change or list it for a fix before Gate 1. Add a walker test over the route
   registry that fails when a response schema contains a forbidden property name (`secretHash`, `passwordHash`, `clientSecret`, `secret`, `token` on anything but the one-time creation response) —
   the same style as the deny-by-default walker of defect 1. 8.2.3 moves to `pass` only if the audit finds nothing left; otherwise it stays `fail` with the findings.
3. **Close the assessment.** Re-read every `pass` and `n/a` of the three files against the final code, fix notes that are no longer true, run `pnpm security:asvs --write`, and list the entries that are
   still `fail` (6.2.6, 6.2.7, 7.4.4 and whatever the audit found) with their M5 owner (the links to the M5 plan stay; the M4b links are gone).
4. **Docs.** Module README of `core.identity` (new routes, permission, settings, events), `docs/backlog.md` (TOTP, notice mail on failed logins, a session list with device names, hard
   lockout alternatives, an admin UI for all of it), M5 plan hand-off table.

Definition of done: as before; the README badges still show `in progress`, because the human fields are empty, and the generated reports show 3 or fewer `fail` entries, all of them M5.

## 7. Acceptance mapped to checks

| Acceptance criterion                                                                                          | Where it is proved                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A session cannot outlive the absolute lifetime however often it is used                                       | `sessions.test.ts` table-driven with a clock; defect-04 stays green                   |
| A user lists and ends their own sessions; cannot see or end another's                                         | integration test and the defect-01 style own-data test                                |
| An administrator ends one user's or all sessions; a plain User cannot                                         | denied-permission test; the walker of defect 1 includes the new routes                |
| Changing the email address, linking an identity or ending a session needs a recent authentication             | route tests for `401 reauthentication-required`, and the pass after re-authentication |
| A breached or context-specific password is refused on register, reset, change, first-run and create-admin     | stub-adapter tests and table-driven tests per entry point                             |
| Repeated failed logins for one account slow that account down without locking it, and enumerate nobody        | integration test with injected time; same answer for an unknown name                  |
| A reset link older than 10 minutes is refused                                                                 | `recovery.test.ts` with an injected clock                                             |
| A provider cannot take over an account by asserting its email; linking needs the mailbox owner's confirmation | oidc service and Keycloak tests                                                       |
| No response schema holds a forbidden field                                                                    | the new walker test                                                                   |
| Every requirement M4b says it fixes is `pass` with evidence that runs                                         | `pnpm security:asvs` strict in CI; the pull requests' own runs                        |

## 8. Out of scope (goes to `docs/backlog.md` if not there)

- Own TOTP, WebAuthn or any second factor; step-up policies beyond recent authentication; a risk or location based login.
- Screens: the session list, the re-authentication dialog, the password fields and the logout control (M5). 6.2.6, 6.2.7 and 7.4.4.
- A notice mail on suspicious or repeated failed logins (6.3.5 and 6.3.7 are Level 3).
- Filling the human fields, the second pass and `self-assessed`: Gate 1.
- Other ASVS chapters, Best Practices silver and gold, signed images (M18).

## 9. Decisions taken (2026-10-06)

1. **Release.** Taken, as recommended: M4b releases as `0.6.0` (it changes runtime behaviour, so "every milestone ends with a release" applies), M4a ships inside it, and M5 becomes `0.7.0`.
   This changes the release number named in the M5 plan. The alternative keeps `0.6.0` for M5 and ships M4b inside it, which mixes a security change set with a UI milestone.
2. **Where the `fail` notes point while M4b is open.** Taken: no issues. A `fail` links the plan section that fixes it, and the tool accepts that (§0 item 2). The alternatives were three tracking issues, one umbrella issue, or ten gap issues.
3. **Password check source.** Taken, against the recommendation: the Have I Been Pwned range API, not an offline list. The set is larger and current; the cost is a third party that sees a 5-character hash prefix of every new password, and a policy for an
   outage (fail open, §5 item 1). The recommended alternative was an offline text file in the repository with its licence and SHA-256 recorded.
4. **Re-authentication.** Taken 2026-10-06, as recommended: a recent-authentication window on the session (password for accounts that have one, a fresh OIDC login with `auth_time` for those that have not),
   5 minutes by default. The alternative is the password in every sensitive request, which leaves OIDC-only accounts unable to change anything. A confirmation mail to the current address for OIDC-only accounts was considered and not taken: it is a good control against a stolen session, but ASVS 7.5.1 asks for full re-authentication, and a mail is not that by the letter.
5. **Brute-force control.** Taken, as recommended: per-account exponential delay with a ceiling and no hard lockout, plus the existing per-IP bucket. A hard lockout is simple but lets anyone lock any
   account, which 6.1.1 names as a defect. The alternative is a CAPTCHA, which adds a dependency and a third party.
6. **Concurrent sessions and what a session list shows.** Taken, as recommended: no limit, documented, with the list of 7.5.2 as the control; the list shows times and the current marker only (no
   user agent or address stored). The alternative caps sessions (for example 10, the oldest ended), which needs a UI message, and storing a device label needs a privacy text from M5.
7. **Lifetime of the verification link.** Taken, as recommended: only the reset link counts as an out-of-band authentication request and gets 10 minutes; the 24-hour verification link confirms an
   address and authenticates nobody, and the ADR says so. This is a reading of 6.5.5; the earlier assessment treated mail links as out-of-band for 6.5.1 to 6.5.4, so the ADR must
   explain the difference. The alternative is 10 minutes for both.
8. **Multi-factor authentication (6.3.3).** Taken, as recommended: a documented rationale with mitigating controls (the requirement allows it), MFA left to the OIDC provider, TOTP in the backlog. The alternative is
   TOTP in M4b: it adds a dependency, secret storage in the secrets store, recovery codes (6.5.x applies) and screens, and moves the milestone from M to L.
9. **8.2.3 outcome.** Taken, as recommended: documentation plus the response-schema audit and walker test; claim `pass` only if the audit finds nothing. The alternative is a field-level permission
   engine, which is not justified by the objects that exist today.
10. **Default lifetimes.** Taken, as recommended: 7 days of inactivity and 30 days absolute, both settings. A shorter absolute lifetime (for example 12 hours) fits a high-risk service better but
    would sign every user out daily; the policy document records the choice and the deviation from NIST SP 800-63B.

11. **How a first OIDC sign-in links to an existing account.** Taken 2026-10-06 (the maintainer's proposal, replacing the recommended per-provider `trustEmailForLinking` setting): a mail with a single-use
    10-minute link goes to the existing account's own address, and the identity is linked only after the account holder confirms while signed in. It proves control of the mailbox instead of
    trusting a provider's `email_verified`, and it reuses the mail-token machinery of ADR-0012.

## 10. Additions to `implementation.md` (to approve with this plan)

- An M4b milestone entry after M4a: "Closing the ASVS gaps in `core.identity`, `core.authz` and the pipeline", size M, depends on M4a, closes no defect, with the goal and acceptance of §3 and §7.
- The overview table row M4b (Phase 1 Foundation, M, depends on M4a) and "M0–M5 incl. M4a and M4b" in the Gate 1 row.
- Gate 1's line on the ASVS chapters stays as it is: no `fail`, with 6.2.6, 6.2.7 and 7.4.4 closed by M5.
- M5 releases as `0.7.0` (Decision 1); the same line changes in [m5-sprint-plan.md](m5-sprint-plan.md).

## 11. Risks

| Risk                                                                          | Impact                                                                             | Mitigation                                                                                                                                                |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A fix is marked `pass` on a test that does not prove it                       | The claim is false again                                                           | The tool needs the tagged test to pass; the second pass at Gate 1 re-reads each entry; dedicated tests, not `it.each` tags, for new work                  |
| Absolute lifetime logs out users who rely on a long-running session           | Complaints, support load                                                           | Both limits are settings; the changeset and README say what changes; no live data exists before M5                                                        |
| Re-authentication breaks the OIDC-only flow (provider ignores `prompt=login`) | Account changes impossible for those users                                         | Check `auth_time` and refuse a stale one; test against Keycloak; document providers that ignore it                                                        |
| Per-account throttling is used to slow down a victim's own login              | A denial of service by someone who knows a name                                    | Exponential delay with a ceiling, keyed on account and network together with a higher account-only limit; no hard lockout                                 |
| The breach check is unavailable or unwanted                                   | A breached password is accepted during an outage; a third party sees hash prefixes | Fail open with a warning and a metric; the `off` setting; only a 5-character hash prefix leaves the server; an offline top-3000 floor goes to the backlog |
| The sprint grows into UI or MFA                                               | M4b slips and M5 waits                                                             | §8 is the boundary; anything else goes to the backlog; sprint 3 is the buffer                                                                             |
| A victim clicks a link-confirmation mail that an attacker triggered           | An attacker's identity is linked to the victim's account                           | The mail names the provider and says to ignore it otherwise; the link needs the victim's signed-in session; 10 minutes; mail budget per address           |
