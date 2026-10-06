# M4b Sprint Plan: Close the ASVS gaps in identity and authorization

Status: proposed, 2026-10-06. Decisions 1 to 10 (§9) are open; each has a recommendation.
Scope source: the `fail` entries of `docs/security/asvs/v6-authentication.yaml`, `v7-session-management.yaml` and `v8-authorization.yaml` after
M4a sprint 2 ([m4a-sprint-plan.md](m4a-sprint-plan.md)), and [implementation.md](implementation.md) §8 and Gate 1. Closes no defect of FEATURES §5.
Proposed release: `0.6.0` (Decision 1). M5 then releases as `0.7.0`.

M4a made the claims checkable and found what is not true yet. Gate 1 needs every ASVS chapter with **no `fail` entry**, and the first
pass by the maintainer is only worth making once the gaps are closed. M4b fixes the gaps that are about code and documentation of
`core.identity`, `core.authz` and the pipeline. It changes runtime behaviour (session lifetime, password rules, reset link lifetime, account linking),
so unlike M4a it has user-visible changes and a release of its own. It runs before M5, so that the screens of M5 (session list, password
change, re-authentication prompt, user management) are built on routes that already exist.

M4b is size M (about 2 weeks for one developer). Three sprints, each one `feature/m4b-*` branch and one pull request into `dev`.

## 0. Before sprint 1

1. M4a sprint 2 is merged. The four chapter files exist, and every `fail` entry links to an issue.
2. **How the `fail` notes are linked while M4b is open (Decision 2).** The tool needs a `#<number>` in each `fail` note. Recommended: the three
   chapter tracking issues of M4a, each checklist item pointing at the section of this plan that fixes it, instead of ten separate gap issues. M4b
   closes the checklist; each sprint's pull request updates the YAML and ticks it off.
3. The 3 requirements that need a browser are **not** M4b: 6.2.6 and 6.2.7 (password fields, paste, password managers) and 7.4.4 (logout on every
   authenticated page). They stay `fail` until M5 ships the screens and a Playwright test (M5 sprints 2 and 3).
4. Add the lines in §10 to `implementation.md` (an M4b entry, the overview row, the M5 release number). Add the M4b sections to the M5 plan hand-off table (§1 of
   [m5-sprint-plan.md](m5-sprint-plan.md)) for the routes M5 now consumes.
5. ADRs: the M5 plan reserves ADR-0025 for the shell. M4b takes the next free numbers at the time (written ADR-00xx below), written as the first commit of the sprint that needs them, and amends ADR-0007 and ADR-0011.

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
| 6.8.1         | A first OIDC sign-in links to an account with the same verified email, so a provider can take over that account | Per-provider setting that allows linking by email, off by default                              | 2      |
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
- No new runtime dependency without a reason in the pull request description (Decision 3 may need none).
- Secrets and tokens never go to logs or responses. The new documents live in `docs/security/` and are scoped, so the `asvs-impact` workflow applies to them too.

## 3. Sprint overview

| Sprint | Branch                    | Theme                                                                                 | Fixes (requirement ids)                                                       |
| ------ | ------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1      | `feature/m4b-sessions`    | Absolute lifetime, session list and end, admin termination, re-authentication, policy | 7.1.1, 7.1.2, 7.1.3, 7.3.1, 7.3.2, 7.4.5, 7.5.1, 7.5.2, 7.6.1 (and 6.8.4)     |
| 2      | `feature/m4b-credentials` | Password blocklist, per-account throttle, reset lifetime, link trust, MFA rationale   | 6.1.1, 6.1.2, 6.1.3, 6.2.4, 6.2.11, 6.2.12, 6.3.1, 6.3.3, 6.3.4, 6.5.5, 6.8.1 |
| 3      | `feature/m4b-authz-docs`  | Authorization rules and field-level audit, closing the assessment                     | 8.1.2, 8.2.3                                                                  |

Order matters. Sprint 1 first, because re-authentication is used by sprint 2's link trust change and by M5's screens. Sprint 3 is small and closes the milestone.

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

1. **Password blocklist** (6.2.4, 6.2.12; Decision 3). A text file of common and breached passwords (at least the top 3000 that match the length rule, preferably a larger
   public set) under `modules/core-identity/data/`, loaded at start-up into a `Set`, and checked in the shared `password` validation used by register, reset, change and first-run. The
   compared form is exactly the password as received (6.2.8). A refusal is `422` with a message that does not echo the list. The file's origin, licence and SHA-256 are recorded next to
   it, like the ASVS source; it is data, not a binary. A table-driven test per entry point.
2. **Context words** (6.1.2, 6.2.11). The words are derived from settings (instance name, product name, public host, the user's own username and email local part) plus a short
   documented list for the project (Scorpion, de.NBI, NFDI, IPK). They are refused as the password or as a whole word inside it, case-insensitively. The documented list is part of
   `docs/security/authentication.md`.
3. **Per-account throttle** (6.3.1, 6.1.1; Decision 5). A counter keyed on the account (not only the IP) for failed password attempts, with exponential delay and a ceiling, **no
   hard lockout** (that is the malicious-lockout risk the requirement names). Over the limit the answer is `429` with `Retry-After`, the same answer for an unknown username (no user
   enumeration), and a successful login resets the counter. A notice mail on repeated failures is a backlog item, not M4b. Settings for the thresholds; integration test with
   injected time and a rollback case.
4. **Reset link lifetime** (6.5.5; Decision 7). `RESET_TTL_MS` becomes 10 minutes. The documented position on the verification link (24 h: it confirms an address, authenticates nobody) goes
   into the ADR; if the maintainer rejects that reading, the verification link also drops to 10 minutes and the mail text says "request a new link".
5. **Linking by email** (6.8.1). A boolean per provider in the `oidcProviders` setting, `trustEmailForLinking`, default `false`. When it is false, a first sign-in whose email matches
   an existing account does not link; it creates a pending account or refuses with the existing "sign in the usual way, then link this provider from your profile" message (sprint 1's
   re-authentication protects that profile route). Settings schema, README and tests for both values; a changeset that tells operators the default changed.
6. **MFA position** (6.3.3; Decision 8). ADR-00xx: why Scorpion has no own second factor in this milestone, the mitigating controls (Argon2id, strict and per-account throttling, the
   blocklist, short reset links, session list and termination, and the recommendation that operators enable MFA at the OIDC provider and set `trustEmailForLinking` false for providers
   that do not), and what would bring it back. 6.3.3 moves to `pass` only on the strength of this documented rationale, as the requirement itself allows, and the entry says so.
7. **Authentication document** `docs/security/authentication.md` (6.1.1, 6.1.3, 6.3.4, and the list of 6.1.2): every pathway (password, OIDC, PAT, first-run token, mail tokens, the
   `create-admin` command) with the controls and the authentication strength each one enforces, the rate-limit and throttle settings, the lockout stance, and the fallback assumption
   about the strength of a provider that sends no `acr` (single factor).
8. **Assessment.** Move the entries above to `pass` with tagged tests or document pointers; tags on `it.each` titles only where a dedicated test is not practical, and then say so in the note.

Definition of done as in sprint 1, plus: no password in any log, response or audit payload (existing tests stay), and the OIDC Keycloak test passes with `trustEmailForLinking` both ways.

## 6. Sprint 3: authorization rules and closing the assessment

**Goal:** the field-level rules are written down and the response side is audited, then the three chapter files are checked end to end.

1. **Authorization document** `docs/security/authorization.md` (8.1.2, and the single matrix of 8.1.1 that M4a left spread over several documents): per object (user, role, token, session,
   inbox item, setting, vocabulary, blob, audit entry) who may read and write which fields, which fields only a dedicated route may change (status, roles), and which are never returned
   (hashes, secrets, other users' tokens).
2. **Response-side audit** (8.2.3; Decision 9). Read every route's response schema; fix a leak in a one-line change or list it for a fix before Gate 1. Add a walker test over the route
   registry that fails when a response schema contains a forbidden property name (`secretHash`, `passwordHash`, `clientSecret`, `secret`, `token` on anything but the one-time creation response) —
   the same style as the deny-by-default walker of defect 1. 8.2.3 moves to `pass` only if the audit finds nothing left; otherwise it stays `fail` with the findings.
3. **Close the assessment.** Re-read every `pass` and `n/a` of the three files against the final code, fix notes that are no longer true, run `pnpm security:asvs --write`, and list the entries that are
   still `fail` (6.2.6, 6.2.7, 7.4.4 and whatever the audit found) with their M5 owner. The tracking issues are updated and closed where empty.
4. **Docs.** Module README of `core.identity` (new routes, permission, settings, events), `docs/backlog.md` (TOTP, notice mail on failed logins, a session list with device names, hard
   lockout alternatives, an admin UI for all of it), M5 plan hand-off table.

Definition of done: as before; the README badges still show `in progress`, because the human fields are empty, and the generated reports show 3 or fewer `fail` entries, all of them M5.

## 7. Acceptance mapped to checks

| Acceptance criterion                                                                                   | Where it is proved                                                                    |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| A session cannot outlive the absolute lifetime however often it is used                                | `sessions.test.ts` table-driven with a clock; defect-04 stays green                   |
| A user lists and ends their own sessions; cannot see or end another's                                  | integration test and the defect-01 style own-data test                                |
| An administrator ends one user's or all sessions; a plain User cannot                                  | denied-permission test; the walker of defect 1 includes the new routes                |
| Changing the email address, linking an identity or ending a session needs a recent authentication      | route tests for `401 reauthentication-required`, and the pass after re-authentication |
| A common, breached or context-specific password is refused on register, reset and change               | table-driven tests per entry point                                                    |
| Repeated failed logins for one account slow that account down without locking it, and enumerate nobody | integration test with injected time; same answer for an unknown name                  |
| A reset link older than 10 minutes is refused                                                          | `recovery.test.ts` with an injected clock                                             |
| A provider cannot take over an account by asserting its email unless `trustEmailForLinking` is set     | oidc service and Keycloak tests, both settings                                        |
| No response schema holds a forbidden field                                                             | the new walker test                                                                   |
| Every requirement M4b says it fixes is `pass` with evidence that runs                                  | `pnpm security:asvs` strict in CI; the pull requests' own runs                        |

## 8. Out of scope (goes to `docs/backlog.md` if not there)

- Own TOTP, WebAuthn or any second factor; step-up policies beyond recent authentication; a risk or location based login.
- Screens: the session list, the re-authentication dialog, the password fields and the logout control (M5). 6.2.6, 6.2.7 and 7.4.4.
- A notice mail on suspicious or repeated failed logins (6.3.5 and 6.3.7 are Level 3).
- Filling the human fields, the second pass and `self-assessed`: Gate 1.
- Other ASVS chapters, Best Practices silver and gold, signed images (M18).

## 9. Decisions (open)

1. **Release.** Recommended: M4b releases as `0.6.0` (it changes runtime behaviour, so "every milestone ends with a release" applies), M4a ships inside it, and M5 becomes `0.7.0`.
   This changes the release number named in the M5 plan. The alternative keeps `0.6.0` for M5 and ships M4b inside it, which mixes a security change set with a UI milestone.
2. **Where the `fail` notes point while M4b is open.** Recommended: the three tracking issues only, with a checklist item per requirement that names the M4b section. Ten gap issues would
   each be closed within two weeks and would publish the gaps one by one. The alternative is one issue per gap, as M4a sprint 2 §5 item 8 proposed.
3. **Password blocklist source.** Recommended: an offline text file of a widely published list of common and breached passwords (licence checked and recorded), loaded once, no network call.
   The alternative is the Have I Been Pwned range API through `packages/integrations` (adapter with cache, timeout and stub): the set is larger and current, but every register, reset and
   change sends a hash prefix to a third party, and an outage must then decide between refusing and allowing.
4. **Re-authentication.** Recommended: a recent-authentication window on the session (password for accounts that have one, a fresh OIDC login with `auth_time` for those that have not),
   5 minutes by default. The alternative is the password in every sensitive request, which leaves OIDC-only accounts unable to change anything.
5. **Brute-force control.** Recommended: per-account exponential delay with a ceiling and no hard lockout, plus the existing per-IP bucket. A hard lockout is simple but lets anyone lock any
   account, which 6.1.1 names as a defect. The alternative is a CAPTCHA, which adds a dependency and a third party.
6. **Concurrent sessions and what a session list shows.** Recommended: no limit, documented, with the list of 7.5.2 as the control; the list shows times and the current marker only (no
   user agent or address stored). The alternative caps sessions (for example 10, the oldest ended), which needs a UI message, and storing a device label needs a privacy text from M5.
7. **Lifetime of the verification link.** Recommended: only the reset link counts as an out-of-band authentication request and gets 10 minutes; the 24-hour verification link confirms an
   address and authenticates nobody, and the ADR says so. This is a reading of 6.5.5; the earlier assessment treated mail links as out-of-band for 6.5.1 to 6.5.4, so the ADR must
   explain the difference. The alternative is 10 minutes for both.
8. **Multi-factor authentication (6.3.3).** Recommended: a documented rationale with mitigating controls (the requirement allows it), MFA left to the OIDC provider, TOTP in the backlog. The alternative is
   TOTP in M4b: it adds a dependency, secret storage in the secrets store, recovery codes (6.5.x applies) and screens, and moves the milestone from M to L.
9. **8.2.3 outcome.** Recommended: documentation plus the response-schema audit and walker test; claim `pass` only if the audit finds nothing. The alternative is a field-level permission
   engine, which is not justified by the objects that exist today.
10. **Default lifetimes.** Recommended: 7 days of inactivity and 30 days absolute, both settings. A shorter absolute lifetime (for example 12 hours) fits a high-risk service better but
    would sign every user out daily; the policy document records the choice and the deviation from NIST SP 800-63B.

## 10. Additions to `implementation.md` (to approve with this plan)

- An M4b milestone entry after M4a: "Closing the ASVS gaps in `core.identity`, `core.authz` and the pipeline", size M, depends on M4a, closes no defect, with the goal and acceptance of §3 and §7.
- The overview table row M4b (Phase 1 Foundation, M, depends on M4a) and "M0–M5 incl. M4a and M4b" in the Gate 1 row.
- Gate 1's line on the ASVS chapters stays as it is: no `fail`, with 6.2.6, 6.2.7 and 7.4.4 closed by M5.
- M5 releases as `0.7.0` (Decision 1); the same line changes in [m5-sprint-plan.md](m5-sprint-plan.md).

## 11. Risks

| Risk                                                                             | Impact                                          | Mitigation                                                                                                                               |
| -------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A fix is marked `pass` on a test that does not prove it                          | The claim is false again                        | The tool needs the tagged test to pass; the second pass at Gate 1 re-reads each entry; dedicated tests, not `it.each` tags, for new work |
| Absolute lifetime logs out users who rely on a long-running session              | Complaints, support load                        | Both limits are settings; the changeset and README say what changes; no live data exists before M5                                       |
| Re-authentication breaks the OIDC-only flow (provider ignores `prompt=login`)    | Account changes impossible for those users      | Check `auth_time` and refuse a stale one; test against Keycloak; document providers that ignore it                                       |
| Per-account throttling is used to slow down a victim's own login                 | A denial of service by someone who knows a name | Exponential delay with a ceiling, keyed on account and network together with a higher account-only limit; no hard lockout                |
| A shipped blocklist is large or carries a licence that does not fit              | Repository bloat or a licence problem           | Check the licence and size before choosing the file; record origin and SHA-256; Decision 3's alternative is the fallback                 |
| The sprint grows into UI or MFA                                                  | M4b slips and M5 waits                          | §8 is the boundary; anything else goes to the backlog; sprint 3 is the buffer                                                            |
| `trustEmailForLinking` default `false` surprises operators who relied on linking | Users get a second account                      | Changeset text, README, the "link from your profile" message; the setting can be turned on per provider                                  |
