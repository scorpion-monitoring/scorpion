# Security assurance

What this project claims about its security, how each claim is backed, and how to challenge it. The design is in
[docs/implementation.md](../implementation.md) §8; this page is the current state. The signals are badges at the top of the
[README](../../README.md). OWASP does not certify projects, and this project has one maintainer, so the ASVS badges say
**self-assessed** at best, never "compliant" or "verified".

## ASVS scope

One assessment per ASVS 5.0.0 chapter, Level 2 (which includes every Level 1 requirement). The requirement ids and texts come from the
[pinned source file](asvs/source/README.md), not from a list in the tool.

| Badge | Chapter            | Scope                                                                                                                                                                                                              | Requirements (L1+L2) | Assessment                                                                       |
| ----- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | -------------------------------------------------------------------------------- |
| V6    | Authentication     | Full chapter                                                                                                                                                                                                       | 35                   | [data](asvs/v6-authentication.yaml), [report](asvs/v6-authentication.md)         |
| V7    | Session Management | Full chapter                                                                                                                                                                                                       | 18                   | [data](asvs/v7-session-management.yaml), [report](asvs/v7-session-management.md) |
| V8    | Authorization      | Full chapter                                                                                                                                                                                                       | 7                    | [data](asvs/v8-authorization.yaml), [report](asvs/v8-authorization.md)           |
| V10   | OAuth and OIDC     | Requirements for an OAuth client and an OIDC relying party. Requirements for authorization servers, OpenID Providers and resource servers are `n/a`: Scorpion is none of these, and its PATs are not OAuth tokens. | 29                   | [data](asvs/v10-oauth-oidc.yaml), [report](asvs/v10-oauth-oidc.md)               |

**V9 (self-contained tokens) does not apply:** sessions and personal access tokens are opaque reference tokens, checked against the database
on every request (ADR-0007, ADR-0008). No JWT is used for a session. Other chapters are not claimed (see the backlog).

## Where things stand

The four chapters are **in progress**. The entries are filled in from what the code and tests of M2 to M4b show; the human fields
(`assessor`, `assessed_commit`, `assessed_on`, `second_pass`, `assessment_type`) are the maintainer's: the first pass was recorded on 2026-10-09 and `second_pass` stays empty until it is made on 2026-10-16 or later (ADR-0031), so
the badges cannot turn green before then. M4b closed the gaps in identity, authorization and the pipeline. Two `fail` entries remain, both for M5 because they need a browser (the [M5 plan](../m5-sprint-plan.md) schedules each): 6.2.6 and 6.2.7 (password fields, paste and password managers). M5 sprint 1 closed 7.4.4 (a logout control on every page) with a Playwright test.

Policies the assessments point to: [sessions.md](sessions.md) (lifetimes, concurrent sessions, the provider's session, recent authentication) and [authentication.md](authentication.md) (every pathway with its controls and strength, the password rules and the words they refuse, the throttle and the lockout stance, why there is no second factor of our own) and [authorization.md](authorization.md) (who may call each route, the checks in the service, and the fields each reader may see and change per object; its route table is generated from the live registry and tested).

## Method

1. **Evidence is mechanical where possible.** A test that proves a requirement carries the tag `[ASVS-<chapter>.<section>.<requirement>]` in its title,
   for example `[ASVS-7.4.1]`. The assessment file lists `test: ASVS-7.4.1`. A code or documentation pointer is used when a test cannot show it.
2. **`pnpm security:asvs`** (also in CI, and in the pull request's own run) checks the rules of implementation.md §8.2: every Level 1 and 2 requirement
   once and nothing else; `pass` needs evidence (a `test:` tag must belong to a test that **passed in the same run**, read from the Vitest and Playwright
   JUnit reports in `reports/`; `code:` and `doc:` paths must exist); `n/a` needs a reason that is its own, not a copied sentence; `fail` needs a note that
   links an issue or the sprint plan section that schedules the fix; the dates and reviewer rules; the SHA-256 of the pinned source. It then derives each chapter's status and checks that the chapter
   reports (`docs/security/asvs/*.md`) and the badge block in the README are exactly what `pnpm security:asvs --write` generates. Run it locally after
   `pnpm test` and `CI=true pnpm test:e2e`; without the reports it lists the tags it could not check and passes, and in CI a missing report is an error.
3. **`asvs-impact`** (a pull request check, [workflow](../../.github/workflows/asvs-impact.yml)): a pull request that changes a security-scoped path
   (`modules/core-identity/**`, `modules/core-authz/**`, `apps/server/src/pipeline/**`, `packages/contracts/src/route.ts`, `docs/security/**`) must change the
   matching chapter file in `docs/security/asvs/`, or carry the label `asvs-no-impact` and a line `ASVS impact: none because <reason>` in its
   description. The map from path to chapters is `tools/asvs-report/scope.ts`.
4. **A second pass** by the maintainer at least 7 days after the first re-checks every `pass` and `n/a` against the evidence alone. An AI-assisted review may feed
   it; it is noted and never counts as a peer review.
5. **Releases:** on a `release/*` or `hotfix/*` branch a chapter that has an `assessed_commit` and whose scoped paths changed after it is `stale`, and CI fails.

The statuses a chapter can have: `in progress` (any `fail`, a broken rule, or the human fields not filled in), `self-assessed`, `peer-reviewed`,
`externally verified`, and `stale`. The status is derived, never stored.

## Assessment history

| Date | Commit | Chapters | Type | Assessor | Reviewer |
| ---- | ------ | -------- | ---- | -------- | -------- |
|      |        |          |      |          |          |

Empty until Gate 1.

## OpenSSF Best Practices

Project [15237](https://www.bestpractices.dev/projects/15237), registered and in progress; the target is `passing` at Gate 1. The answers on
bestpractices.dev are the maintainer's. Where a criterion is answered with a link, it points to one of these files:

| Criterion area                               | Evidence in the repository                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Project description, contribution process    | [README.md](../../README.md), [CONTRIBUTING.md](../../CONTRIBUTING.md)                                                            |
| Licence                                      | [LICENSE](../../LICENSE)                                                                                                          |
| Reporting vulnerabilities, response times    | [SECURITY.md](../../SECURITY.md)                                                                                                  |
| Public version control, releases, changelog  | Git history, tags `v*`, [CHANGELOG.md](../../CHANGELOG.md), [CONTRIBUTING.md](../../CONTRIBUTING.md) "Releases"                   |
| Automated tests, tests required for new code | [ci.yml](../../.github/workflows/ci.yml), [CLAUDE.md](../../CLAUDE.md) "Testing rules"                                            |
| Static analysis                              | [codeql.yml](../../.github/workflows/codeql.yml), ESLint in `pnpm check`                                                          |
| Dependency monitoring, known vulnerabilities | [dependabot.yml](../../.github/dependabot.yml), `pnpm audit:check` and the allow-list in [CONTRIBUTING.md](../../CONTRIBUTING.md) |
| Secure design and coding practice            | [docs/architecture.md](../architecture.md), [CLAUDE.md](../../CLAUDE.md) "Security rules"                                         |

## OpenSSF Scorecard

The [Scorecard](https://scorecard.dev/viewer/?uri=github.com/scorpion-monitoring/scorpion) workflow runs on pushes to `dev`
(the default branch), weekly, and when branch protection changes. Targets: at least 6.5 at Gate 1, 7.0 at Gate 4.

Score **7.3** on 2026-10-06 (commit `70a64e8`, API `api.scorecard.dev`). Checks below 10:

| Check              | Score | Why                                                                                             |
| ------------------ | ----- | ----------------------------------------------------------------------------------------------- |
| Maintained         | 0     | The project was created within the last 90 days; it rises with time.                            |
| Code-Review        | 0     | One maintainer merges their own pull requests (see below).                                      |
| Fuzzing            | 0     | Not fuzzed; `fast-check` tests are planned for M10 and M11.                                     |
| Branch-Protection  | 4     | `main` and `dev` are protected, but with no required reviews, which one maintainer cannot give. |
| CII-Best-Practices | 5     | The Best Practices badge is registered and in progress.                                         |
| Vulnerabilities    | 9     | One known vulnerability is reported against the repository's dependencies.                      |
| Signed-Releases    | n/a   | No release assets yet; signed images are M18.                                                   |

**Single-maintainer note.** Code-Review and part of Branch-Protection stay low while one person writes and merges everything. That is why the
targets are lower than usual; they go up when a second maintainer joins.

## Repository settings (maintainer actions)

State on 2026-10-06 (from sprint 1 of M4a): secret-scanning push protection, Dependabot alerts and private vulnerability reporting are on; a ruleset protects `main`
and `dev` with the required checks `Lint, type check, test`, the four `Image (…)` jobs, `Dependency audit` and `CodeQL`; Best Practices project 15237 is registered.
The `ASVS impact` check is not required yet: a check becomes required for `main` only once it is on `main` (CONTRIBUTING.md, "Releases").

## How to challenge an entry

Every assessment is public. If an entry claims more than the code or the tests show, open an issue that names the requirement id, or report it as described in
[SECURITY.md](../../SECURITY.md) if it is a vulnerability. A requirement that turns out not to be met is changed to `fail` and linked to an issue; nobody
edits a badge or a generated report by hand, because CI would refuse it.
