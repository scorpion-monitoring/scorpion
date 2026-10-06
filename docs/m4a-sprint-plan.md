# M4a Sprint Plan: Security assurance tooling

Status: proposed, 2026-10-05. Decisions 1 to 8 (§9) were answered on 2026-10-05; every answer took the recommendation.
Scope source: [implementation.md](implementation.md) §3, M4a, and §8 (security assurance signals). Closes no defect of FEATURES §5.
Releases with `0.6.0` (Decision 1), together with M5.

M4a is size S (about 1 week for one developer). It adds no runtime code. It makes the claims of §8 true and checkable: a repository
that is hardened, a Scorecard run, a Best Practices registration, and an ASVS 5.0 assessment tool whose output CI verifies. It runs
before M5 so that M5's login screens, cookie handling and CSRF forms are assessed as they land, and Gate 1 is a check, not a one-off audit.
This plan splits it into two sprints, each one `feature/m4a-*` branch and one pull request into `dev`. The first changes the repository and
its workflows; the second adds the tool and the assessment data.

## 0. Before sprint 1

1. `dev` carries `0.5.0` (tag `v0.5.0`, merge-back #50). Both sprints start from `dev`.
2. §9 is answered. Two answers decide the shape of the work: Dependabot (Decision 2) and the tracking-issue rule for `fail` entries
   (Decision 5).
3. **What the repository looks like today** (checked 2026-10-05, so the plan starts from facts):
   - Public repository `scorpion-monitoring/scorpion`, default branch `dev`. Secret scanning is enabled; push protection, Dependabot
     security updates and private vulnerability reporting are not. Branch protection exists on neither `main` nor `dev`.
   - No `SECURITY.md`, `CODEOWNERS`, `dependabot.yml`, CodeQL or Scorecard workflow. One workflow, `ci.yml`, with top-level
     `permissions: contents: read`.
   - Actions are pinned by major tag (`actions/checkout@v7`), not by SHA. `docker/Dockerfile` uses `node:${NODE_VERSION}` and
     `node:${NODE_VERSION}-slim` with no digest.
   - Vitest and Playwright write no JUnit report, and no `docs/security/` or `tools/asvs-report/` exists.
   - Defect regression tests exist for defects 1, 3, 4, 5 and 13. Defects 11 and 12 are M5.
4. **A path in the docs is wrong.** §8.4 and `CLAUDE.md` name `packages/contracts/src/create-route.ts` as security-scoped. The file is
   `packages/contracts/src/route.ts`. Sprint 1 fixes both documents and `scope.ts` uses the real path.
5. Add the lines in §10 to M4a's scope in `implementation.md`.
6. Some steps are repository settings that need the maintainer's rights (branch protection, push protection, private vulnerability reporting,
   registering on bestpractices.dev). The plan lists them as **maintainer actions**. They publish or lock things on a public repository, so
   they are done with the maintainer's go-ahead, one at a time, and recorded in `docs/security/README.md` with the date.

## 1. What earlier milestones and documents hand to M4a

| Hand-off                                                                                                                          | Where it was recorded            | Sprint |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------ |
| Repo hardening: `SECURITY.md`, private vulnerability reporting, push protection, Dependabot alerts, branch protection, CODEOWNERS | implementation.md M4a, §8.3      | 1      |
| Workflow hygiene: pin by SHA, digest for base images, minimal `permissions`, update tool, CodeQL                                  | implementation.md M4a, CLAUDE.md | 1      |
| Scorecard workflow and badge; Best Practices registration                                                                         | implementation.md §8.3           | 1      |
| The `asvs-impact` rule (rule 10) is documented but not enforced                                                                   | implementation.md §1, §8.4, §8.6 | 2      |
| ASVS tool, pinned source, JUnit evidence, skeletons for V6, V7, V8, V10, generated reports and README badge block                 | implementation.md §8.2, §8.5     | 2      |
| Retro-tagging of the M2/M3/M4 tests (including every `defect-NN.*`) and moving matching requirements to `pass` or `n/a`           | implementation.md M4a            | 2      |
| An issue for every open `fail`, saying in its text whether it belongs to M5 or is a fix before G1                                 | implementation.md M4a acceptance | 2      |
| `docs/backlog.md`: "Origin check", Dependabot-style ideas, the signed-image work for M18 (cosign, SLSA)                           | ADR-0007, implementation.md §8.6 | 1, 2   |
| The intermittent `57P01` teardown error in CI (seen on #48 and #50)                                                               | M4 sprint 4 review               | 1      |

## 2. Cross-sprint rules

- Stay inside M4a. Fixing a gap the assessment finds in `core.identity` or `core.authz` is not M4a: record it as `fail` with an issue (or,
  if it is a one-line fix to a claim that is simply wrong, say so in the pull request). Fixes go to M5 or to a `fix/` change before G1.
- **One pull request per sprint** (CLAUDE.md). ADRs, READMEs, backlog lines and review fixes go into the sprint's pull request. Push and
  open the pull request when the sprint is complete and verified locally (`pnpm check`, tests of touched packages).
- **Never claim what is not true** (CLAUDE.md, "Security assurance"). Never mark a requirement `pass` without evidence that exists and runs.
  Never mark `n/a` to turn a badge green: `n/a` needs a reason why the requirement cannot apply. The human fields (`assessor`,
  `second_pass`, `reviewer`, `assessment_type`, `assessed_commit`) stay empty in this milestone: they are filled by the maintainer at Gate 1.
  A review by an AI assistant may be noted as input to the second pass; it is never recorded as `peer` or `external`.
- Workflows follow the Scorecard rules in CLAUDE.md: pin by full SHA, top-level `permissions: contents: read`, widen per job only,
  never check out pull-request code under `pull_request_target`, never put `${{ github.event.* }}` input straight into `run:` (pass it
  through `env:`).
- No new **runtime** dependency. The tool is a development tool. It needs a YAML parser (Node has none), which would be a development
  dependency of `tools/asvs-report`; Decision 4 asks. Everything else uses `node:` modules.
- The tool is TypeScript, run by Node's type stripping like `scripts/*.ts`, and is tested with table-driven unit tests (every rule of
  §8.2 has a failing fixture).
- Do not commit binaries. The pinned ASVS source is a JSON text file with its SHA-256 recorded next to it.
- Every pull request carries a changeset; both sprints use `pnpm changeset --empty` (nothing changes for operators or API users). Changes
  in `docs/**` and `*.md` alone would be exempt, but sprint 1 and 2 touch workflows and code.
- Update `CLAUDE.md`, `CONTRIBUTING.md` and the pull request template when a rule becomes enforced: the text must say what CI does.

## 3. Sprint overview

| Sprint | Branch                       | Theme                                                                                  | Closes |
| ------ | ---------------------------- | -------------------------------------------------------------------------------------- | ------ |
| 1      | `feature/m4a-repo-hardening` | `SECURITY.md`, CODEOWNERS, update tool, pinned workflows, CodeQL, Scorecard, settings  | none   |
| 2      | `feature/m4a-asvs-tool`      | `tools/asvs-report`, JUnit evidence, four chapter files, `asvs-impact`, badges, issues | none   |

Order matters. Sprint 1 first, because the Scorecard workflow, CodeQL and branch protection need to run on `main` before Gate 1 for
the score to be known, and because sprint 2's CI changes should be written against already pinned, least-privilege workflows. Sprint 2
does not depend on any setting of sprint 1 except the badge URLs, which need the repository path only.

## 4. Sprint 1: repository hardening

**Branch:** `feature/m4a-repo-hardening`. **Goal:** every Scorecard check that a file can fix is fixed, the settings that a person must
change are listed and done with approval, and the first Scorecard score is known.

Work items

1. **`SECURITY.md`** at the repository root: supported versions (the latest release only, until 1.0), how to report (GitHub private
   vulnerability reporting, with a contact address from the maintainer as a fallback), what a reporter can expect (acknowledgement within
   a stated time, a fix or a decision in a stated time, credit if wanted), what is in scope (this repository, the images the project
   publishes), what is not (instances run by others, third-party dependencies, social engineering). Plain language, no promises the one
   maintainer cannot keep: ask the maintainer for the response times.
2. **`.github/CODEOWNERS`** listing the security-scoped paths of §8.4 (`modules/core-identity/**`, `modules/core-authz/**`,
   `apps/server/src/pipeline/**`, `packages/contracts/src/route.ts`, `docs/security/**`, `tools/asvs-report/**`, `.github/**`,
   `SECURITY.md`) with the maintainer's handle. Because required reviews stay at 0 (§8.3), this requests a review and blocks nothing.
3. **Update tool** (Decision 2): `.github/dependabot.yml` for `npm` (the pnpm workspace root, grouped weekly), `github-actions` and `docker`
   (digest bumps), with a limit on open pull requests so the batching rule in CLAUDE.md is not drowned. Dependabot pull requests need
   a changeset: the changeset check exempts them by author or the config adds an empty one (decide in the pull request; the check
   already has `isDocsFile`, extend it narrowly and test it).
4. **Pin every action by full SHA** in `ci.yml` with the tag in a trailing comment (`# v7.0.1`); Dependabot then updates both.
   `docker/Dockerfile`: pin `node` and `node-slim` by digest (`FROM node:24.x@sha256:…`), keep `NODE_VERSION` as a build argument only
   if the digest can still follow it; otherwise drop the argument and let the update tool move tag and digest together (Decision 3).
   Check `docker/` and `scripts/build.ts` for any other `FROM`, `curl | sh` or unpinned `npx`.
5. **Workflow permissions:** keep `permissions: contents: read` at the top. Per job, widen only where needed: `security-events: write`
   for CodeQL and Scorecard upload, `id-token: write` for Scorecard publishing, `pull-requests: read` for the `asvs-impact` job in sprint 2.
   Move any `${{ github.* }}` expression out of `run:` (the CI file already uses `env:` for `HEAD_REF` and `BASE_REF`; keep that pattern).
6. **CodeQL** (`.github/workflows/codeql.yml`) for `javascript-typescript` on pull requests into `dev` and `main`, on pushes to those
   branches, and weekly. It is a workflow file, not the repository's default setup, so Scorecard's SAST check detects it. Query suite
   `security-extended`. Triage the first run: fix a true finding in this pull request only if it is a one-line change in non-scoped code;
   otherwise open an issue and link it from the backlog.
7. **Scorecard** (`.github/workflows/scorecard.yml`): `ossf/scorecard-action` pinned by SHA, on pushes to `dev`, weekly, and on
   `branch_protection_rule`, with `publish_results: true` and a SARIF upload. The action aborts outside the default branch, and the repository's default branch is `dev`, so `main` cannot be the trigger (settled with the maintainer during sprint 1). The job asks only for what the action documents. Add the
   badge to the README (a plain Markdown badge line now; the generated block of §8.5 takes it over in sprint 2).
8. **Dependency audit in CI:** a `pnpm audit --audit-level high --prod` step in the `verify` job, or a separate job (Decision 7). It reads
   the lockfile only. A known-vulnerable transitive package that has no fix is recorded in an allow-list with a reason and an expiry, not
   silenced.
9. **The `57P01` teardown flake.** Required status checks make a flaky test cost a re-run of a 12-minute job on every affected pull
   request. Spend at most half a day finding the connection that is still open when the Postgres container stops (suspects:
   `core-notifications/service/inbox.test.ts` and `defect-04.logout-revokes.test.ts`, which share `listen`/`pg_notify` clients). If it
   is not found in that time, record what was tried in `docs/backlog.md` and tell the maintainer before branch protection is switched on.
10. **Fix the documents:** `route.ts` instead of `create-route.ts` in `CLAUDE.md` and `implementation.md` §8.4; the pull request template
    gets a line for `asvs-no-impact`; CONTRIBUTING.md names branch protection, the required checks and who can bypass them (nobody;
    the release flow already goes through pull requests).
11. **Maintainer actions** (done after the pull request is merged, so the pull request itself is not blocked, in this order and
    each one confirmed with the maintainer first):
    1. Turn on secret-scanning push protection and Dependabot alerts and security updates.
    2. Turn on private vulnerability reporting (needed before `SECURITY.md` promises it).
    3. Protect `main` and `dev`: pull requests only, required checks `Lint, type check, test` and the CodeQL job, no force-push, no deletion,
       administrators included, required approvals 0. Release and merge-back pull requests must still merge: check the `release/*` →
       `main` and `feature/merge-main-*` → `dev` flows on the next release.
    4. Register the project on bestpractices.dev, answer the passing criteria with links to files in the repository, and add the badge
       id to the README. Passing needs a second look at each criterion, so this item is the long one; it can finish after the pull request.
    5. Run Scorecard once on `dev` (the default branch: the action refuses any other; it runs on the first push after the merge) and record the score and the checks below target
       in `docs/security/README.md` (created in sprint 2; hold the numbers until then).

Definition of done: `pnpm check` and the workflow files are valid (run `actionlint` locally if available, or let CI show it); no action or
base image in the repository is unpinned (a grep test in `scripts/` fails on `uses: x/y@v` without a SHA and on a `FROM` without a digest);
`SECURITY.md` and `CODEOWNERS` exist; CodeQL, Scorecard and the dependency audit run on the pull request and on `dev`; every maintainer
action is either done and dated or listed as open with a reason. The pull request description says which actions are open.

## 5. Sprint 2: ASVS tool, evidence and the four chapters

**Branch:** `feature/m4a-asvs-tool`. **Goal:** `pnpm security:asvs` validates four chapter files against the pinned ASVS 5.0.0 source, CI runs
it, the README shows four generated `in progress` badges, and the chapter files carry every claim that the code and tests of M2 to M4
already back, with an issue behind every open `fail`.

Work items

1. **Pinned source.** Fetch the official ASVS 5.0.0 JSON export from the OWASP ASVS repository (check the exact file name and the release
   tag first; do not guess), put it at `docs/security/asvs/source/OWASP_ASVS_5.0.0_en.json`, record its SHA-256 in a `source/README.md` next
   to the licence and attribution text (CC BY-SA 4.0), and verify in the tool that the hash still matches. Confirm that the chapter
   numbers V6, V7, V8 and V10 are the ones §8.1 names (the plan says the tool reads requirements from this file, not from a hard-coded list).
2. **`tools/asvs-report`** (`pnpm security:asvs [--write]`), a workspace package with its own Vitest project:
   - Parse the source and the four YAML files (Decision 4).
   - The six rules of §8.2: (1) every L1 and L2 requirement of the chapter appears exactly once and there are no unknown ids; (2) `pass`
     needs evidence, a `test:` tag must match a test that passed in this run, a `code:` or `doc:` path must exist; (3) `n/a` needs a
     `reason`, `fail` needs a `note` that links an issue; (4) `second_pass.on` at least 7 days after `assessed_on`, and `reviewer` set and
     different for `peer` and `external`; (5) the derived chapter status; (6) `--write` regenerates the `.md` report and the README block,
     and without `--write` the tool fails when either differs.
   - The `.md` report header and tables exactly as §8.2 specifies. The header uses the chapter's real `assessor`, `assessed_commit`
     and dates; while those fields are empty the report says "not yet assessed by a person" instead of printing blanks.
   - `scope.ts` maps each scoped path to its chapters: `core-identity` → V6, V7, V10; `core-authz` → V8; `pipeline` → V7, V8;
     `route.ts` → V8; `docs/security/**` → all four. Table-driven test that every path in `CODEOWNERS` and in the CLAUDE.md list appears.
   - **`stale` handling.** The status is derived only for a chapter with an `assessed_commit`. A chapter that has none is `in progress`
     and never `stale`, otherwise every release branch before Gate 1 would fail. Test both cases (Decision 6).
3. **JUnit evidence.** Vitest gets `--reporter=default --reporter=junit --outputFile.junit=reports/vitest-junit.xml` in `scripts/test.ts`
   (one file for all projects), Playwright gets a `junit` reporter beside `html`; CI keeps both files for the tool. The tool matches a
   tag such as `ASVS-6.2.1` against test case names in those reports and counts only a `passed` case. A tag with no matching passed
   test makes `pass` invalid. Reports are ignored by git. When the tool runs without reports (a local `pnpm security:asvs`), it says
   which tags it could not check, and it exits non-zero in CI mode only (Decision 8).
4. **CI wiring.** In `ci.yml`, a step after the tests: `pnpm security:asvs` (read-only, no `--write`). A hand-edited report or badge fails.
5. **The `asvs-impact` job** (rule 10), a separate job on `pull_request`: list the changed files against the base, intersect with the scoped
   paths, and fail when a scoped path changed and the matching chapter YAML did not, unless the pull request has the label
   `asvs-no-impact` and a line `ASVS impact: none because …` in its description. Label names and the description arrive through `env:`
   as data, never inside `run:`. `permissions: pull-requests: read` on that job only. Tests for: no scoped change, scoped change with
   YAML, scoped change with label and reason, label without reason, and a description that tries to inject shell text. Create the label.
6. **Chapter skeletons** `v6-authentication.yaml`, `v7-session-management.yaml`, `v8-authorization.yaml`, `v10-oauth-oidc.yaml`, generated
   from the source with every L1 and L2 id present and `status: fail` as the starting state, then filled in item 7. V10 marks the
   authorization-server, provider and resource-server requirements `n/a` with the reason from §8.1 (one reason per
   requirement, not a copied sentence; the tool allows a shared `reason_ref` only if the text is identical and says why).
7. **Fill in what M2 to M4 delivered.** For each requirement, read the code and the tests, then choose `pass` (with a tagged test or a code
   pointer that really shows it), `n/a` (with a real reason), or leave `fail` with a note. Work chapter by chapter and in this order:
   V7 (cookie flags, session expiry, revocation: defect 4, ADR-0007), V8 (deny by default, defect 1, resource checks in the service),
   V6 (Argon2, reset, verification, rate limits, defects 3 and 13, ADR-0012, ADR-0013), V10 (PKCE, nonce, id_token validation, state:
   defect 5, ADR-0011). Add `[ASVS-x.y.z]` tags to existing test titles (including every `defect-NN.*` file). A tag edit must not
   change what a test asserts: the diff of those files is reviewed as renames only. Never weaken or delete a defect test.
8. **Tracking issues for `fail`** (Decision 5): one tracking issue per chapter listing the open requirement ids, linked from each `fail` note.
   The issue text says whether the work belongs to M5 or is a fix before Gate 1; use no GitHub milestone and no label for it. A requirement that is a real gap in the code gets its own issue.
   Create them with `gh issue create` after the maintainer agrees to the wording; the issue numbers go into the YAML in this pull
   request, so create the issues before the last commit.
9. **`docs/security/README.md`:** scope (the table of §8.1), V9 not applicable (opaque sessions and PATs), method, the assessment history
   table (empty until Gate 1), the Best Practices criteria-to-evidence map, the Scorecard score and checks below target from sprint 1,
   the single-maintainer note, and how to challenge an entry.
10. **README badge block** between the markers of §8.5, written by `--write`: Best Practices (in progress until registered), Scorecard,
    and the four ASVS badges at `in progress`. Remove the plain Scorecard line sprint 1 added. Status line of the README updated.
11. **Docs:** `CLAUDE.md` section "Security assurance" now states what CI enforces (`pnpm security:asvs`, `asvs-impact`, labels), the
    tooling sentence "lands in M4a" becomes present tense; `CONTRIBUTING.md` and the pull request template say the same; backlog gets the
    §8 items that are out of scope (other ASVS chapters, silver and gold, signed images for M18, fuzzing).

Definition of done: `pnpm security:asvs` passes locally with the CI reports and in CI, and fails in a unit test for each rule of §8.2. A
hand-edited badge, a hand-edited report, a `pass` with a tag that matches no passed test, an unknown id, a missing id and a `fail`
without an issue each make it fail. The four badges show `in progress`. An `asvs-impact` run on a test pull request that touches
`modules/core-authz/**` fails, and passes with the label and a reason. `pnpm check` and the tests of every touched package pass,
and no defect test lost an assertion.

## 6. Acceptance (from implementation.md) mapped to checks

| Acceptance criterion                                                                    | Where it is proved                                                                               |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| CI runs `pnpm security:asvs` on every pull request                                      | `ci.yml` step; the pull request's own run                                                        |
| A hand-edited badge fails it                                                            | `tools/asvs-report` unit test (README block differs from the generated one)                      |
| README shows Scorecard, Best Practices (in progress) and four ASVS badges `in progress` | the generated README block, checked by the tool                                                  |
| Every open `fail` links to an issue that says whether it is M5 or a fix before G1       | tool rule 3 (issue link present); the issues exist (checked by hand, listed in the pull request) |
| `SECURITY.md` published, private vulnerability reporting on                             | file in the repository; maintainer action 11.2, dated in `docs/security/README.md`               |
| Actions pinned by SHA, base images by digest, minimal permissions                       | grep test in `scripts/`; Scorecard Pinned-Dependencies and Token-Permissions                     |
| `asvs-impact` enforces rule 10                                                          | job tests in sprint 2 (scoped change without YAML, with label, with injection attempt)           |

Additional gates this plan adds: no secret or token in a workflow file or an issue; the pinned ASVS source hash is verified on each run; no
human field is filled by this milestone; no defect test is weakened.

## 7. Out of scope (goes to `docs/backlog.md` if not there)

- Filling the human fields, the second pass and the `self-assessed` status: Gate 1.
- Fixing the gaps the assessment finds in `core.identity`, `core.authz` or the pipeline: M5 or a fix before Gate 1.
- Chapters other than V6, V7, V8 and V10; Best Practices silver and gold; two-person review; Scorecard targets above 6.5.
- Signed images, SLSA provenance and SBOM: M18 and Gate 4.
- Fuzzing with `fast-check`: M10 and M11.
- Dependency review action on pull requests, and licence checks of dependencies.
- An external or peer review of the assessments.

## 8. Cost and timing

Sprint 1 is about two days, most of it the SHA and digest pinning, CodeQL triage and the Best Practices answers. Sprint 2 is about three
days: the tool is one day, and the honest pass through roughly a hundred requirements (the count comes from the pinned file) is the rest.
If the assessment pass alone passes two days, split it: merge the tool with the skeletons (all `fail`, all with a tracking issue) as sprint
2, and send the retro-tagging and the `pass` entries as a third pull request, so the tool is not held up by the reading.

## 9. Decisions taken (2026-10-05)

All eight took the recommendation.

1. **Does M4a get its own release?** Recommended: no. It changes no runtime behaviour, and every pull request carries an empty changeset, so
   `changeset version` would not bump anything. It ships inside `0.6.0` with M5. This departs from "every milestone ends with a
   release" (implementation.md §1) and needs one sentence there. The alternative is a `0.5.1` with a hand-written changeset about
   `SECURITY.md`, which is a user-visible fact.
2. **Dependabot or Renovate.** Recommended: Dependabot. No extra app or token, it is built into the repository settings, it covers npm
   (pnpm), Actions and Docker digests, and Scorecard's Dependency-Update-Tool check accepts it. Renovate groups better and is more
   configurable, but it needs a hosted app or a workflow with a token.
3. **Base image pinning.** Recommended: pin by digest and let Dependabot move the tag and the digest together. Keep `NODE_VERSION` in
   `.nvmrc` as the one source for local use, and have a test check that the Dockerfile's tag major matches it. The alternative (a build
   argument that the digest ignores) hides a stale digest.
4. **YAML parser.** Node has none. Recommended: `yaml` as a development dependency of `tools/asvs-report` only (small, no
   dependencies of its own, widely used; named in the pull request). The alternative is to store the assessments as JSON, which §8.2
   does not specify and which is harder for people to edit and review. A hand-written YAML subset parser is a source of bugs in a tool whose
   job is to be trusted.
5. **What counts as an issue behind a `fail`.** Recommended: one tracking issue per chapter (a checklist of the open ids) for the
   skeleton state, and a separate issue for each real code gap. A hundred near-empty issues would bury the real ones, and the tool only
   needs a link. The alternative is one issue per requirement.
6. **When `stale` applies.** Recommended: only to a chapter that has an `assessed_commit`. Before Gate 1 the field is empty, so no
   release branch fails. After the maintainer records the first assessment, a scoped change after that commit on a release branch fails
   CI, as §8.4 says.
7. **Dependency audit: blocking or not.** Recommended: blocking at `high` and above for production dependencies, with an allow-list that
   needs a reason and an expiry date; moderate and low are reported only. A blocking audit can fail a pull request that touched
   nothing, because an advisory appeared overnight. Accept it: the alternative (a weekly non-blocking job) leaves the Vulnerabilities
   check red without anyone being told.
8. **Where the ASVS check fails when reports are missing.** Recommended: strict in CI (a missing JUnit report is an error, so a broken
   reporter cannot silently turn evidence into "unverified"), lenient locally with a list of tags it could not verify.

## 10. Additions to M4a's scope in `implementation.md` (to approve with this plan)

- `packages/contracts/src/route.ts` replaces the non-existent `create-route.ts` in the scoped-path list (§8.4, CLAUDE.md).
- M4a ships without a release of its own and is released with M5 (Decision 1).
- The `asvs-impact` job reads the label and the reason as data, with `pull-requests: read` on that job only.
- Vitest and Playwright write JUnit reports that the ASVS tool reads; a `test:` evidence tag counts only if its test passed in the same run.
- `stale` applies only to a chapter that has an `assessed_commit` (Decision 6).
- A tracking issue per chapter satisfies "a `fail` links to an issue" for the skeleton state (Decision 5).
- The dependency audit and CodeQL are required checks on `main` and `dev`.
- A grep test fails on an unpinned action or base image.

## 11. Risks

| Risk                                                                          | Impact                                             | Mitigation                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch protection with required checks blocks the release and merge-back flow | A release cannot merge                             | Protect after sprint 1 merges, test the next release flow with the maintainer present, keep the check names stable                                                                       |
| The `57P01` flake makes required checks fail at random                        | Re-runs of a 12-minute job, merges delayed         | Half a day in sprint 1 to find it; the maintainer is told before protection is switched on                                                                                               |
| The assessment is optimistic, so a badge says more than the code proves       | The claim is false, which is worse than no badge   | Evidence must run; `pass` only with a tagged passing test or a code pointer that shows it; reads are by requirement, not by chapter; the second pass is a person's, not this milestone's |
| Tagging tests changes them by accident                                        | A defect regression test is weakened               | Tag edits are renames only; review the diff of every touched test; run the full suite before and after                                                                                   |
| The pinned ASVS file differs in structure or numbering from what §8.1 assumes | The chapter map is wrong                           | Read the file before writing the tool; the tool takes ids from the file; fix the doc, not the data                                                                                       |
| Pinning by SHA and digest adds update noise                                   | Many small pull requests against the batching rule | Dependabot groups weekly with a limit on open pull requests; merge them in one batch                                                                                                     |
| CodeQL or Scorecard report findings in code the milestone must not change     | Scope creep                                        | Triage into issues and the backlog; fix only one-line changes outside the scoped paths                                                                                                   |
| Registering on bestpractices.dev takes longer than the sprint                 | The badge stays `in progress` longer               | It is not on the critical path; the target is `passing` at Gate 1                                                                                                                        |
