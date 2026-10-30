# ADR-0047: The docs export (`scorpion docs:export`)

- Status: Accepted
- Date: 2026-10-30

## Context

The knowledge base (KB, issues #132 and #133, requests R1 and R2) documents each release and must not copy reference data by hand: it read module READMEs,
`docs/security/authorization.md` and `/api/v1/openapi.json`, which drift. It needs the facts of the modules, the environment, the CLI, the public API, the
profiles and the journeys as data, in a layout its `pnpm sync` can read: `src/data/generated/*.json` as arrays of rows (`readGenerated`), `permissions.json`
with an `id` per row, and `journey-steps.json` as an object from `jNN` to a list of step titles.

## Decision

1. **A command and a release asset.** `scorpion docs:export [--out <dir>] [--zip <file>] [--screenshots <dir>]` writes the export as files (default folder
   `docs-export`, default pictures `reports/doc-shots`); `--zip` also writes `docs-export.zip`. CI builds it on every run (job `Docs export`, artifact
   `docs-export`), and a release tag attaches the zip to the GitHub release (job `Release assets`, the only job with `contents: write`; it makes the
   release when there is none).
2. **Where it runs.** It is a build-time tool of a repository checkout, like `profile:generate`: it reads every `modules/*` package, `profiles/*.ts`,
   `docs/architecture.md`, the journey specs and the git history, none of which an image holds, so the code loads only for this command (`apps/server/src/docs-export/`).
3. **The manifests are the source.** Permissions, settings, events, registries, jobs, dependencies and commands come from the manifests; nothing is copied
   from a README. Two manifest fields serve the export: `displayName` (ADR-0045) and the new optional `env` (the variables a module reads beyond the kernel's,
   `{ description, secret?, required? }`; `core.settings` declares `SECRETS_KEY` and `SECRETS_KEY_NEXT`). The kernel's own variables come from its Zod
   `envSchema`, whose `.describe()` texts are the descriptions. The CLI table of the server (`apps/server/src/commands.ts`) feeds both the usage text and the
   export, and flags are read from the usage lines.
4. **Layout** (all JSON, UTF-8, keys sorted at every depth, two spaces, a final newline). A _table_ is an array of rows.

   | File                                                                      | Content                                                                                                                                                                                   |
   | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `docs-export.json`                                                        | `{ schemaVersion, scorpionVersion, profiles: [names of the defined profiles], files: [every other path] }`: the top of the export                                                         |
   | `modules.json`                                                            | table: `id, displayName, kind (core/optional), version, package, tablePrefix, dependencies, optionalDependencies, profiles, firstRelease`                                                 |
   | `permissions.json`                                                        | table: `id, module, scope, description`                                                                                                                                                   |
   | `settings.json`                                                           | table, one row per settings key: `module, key, title, description, required, default, schema` (JSON Schema, draft 2020-12, input side)                                                    |
   | `settings-schemas.json`                                                   | table: `module, schema` (the whole settings object)                                                                                                                                       |
   | `events.json`                                                             | table: `name, module (emitter, `kernel` for system.ready), payloadSchema, subscribers`                                                                                                    |
   | `registries.json`                                                         | table: `name, owner (`kernel` for the kernel's), entrySchema, contributors: [{ module, entries }]`                                                                                        |
   | `jobs.json`                                                               | table: `name, module, schedule, retryLimit, retryDelaySeconds, retryBackoff, timeoutSeconds, dataSchema`                                                                                  |
   | `env.json`, `env.schema.json`                                             | table: `name, module, type, required, default, secret, description, values`; and the JSON Schema of the kernel's variables. Never a value; a secret has no default                        |
   | `cli.json`                                                                | table: `name, module (`server` or a module), usage, description, flags: [{ name, value, required }]`                                                                                      |
   | `profiles.json`                                                           | table: `name, status (defined/planned), modules: [{ id, inclusion (included/optional) }]`. Defined = `profiles/*.ts`; planned = the other columns of the matrix in `docs/architecture.md` |
   | `journeys.json`, `journey-steps.json`                                     | table: `id, slug, title, file, steps`; and the object `{ "j06": ["Open the wizard from the catalogue", ...] }`                                                                            |
   | `screenshots.json`, `screenshots/jNN/NN-<slug>.light.png` and `.dark.png` | table: `journey, number, slug, light, dark`; the pictures of `docShot()` (#134), when the folder exists                                                                                   |
   | `openapi.json`, `openapi/<profile>.json`                                  | the public API (v1) as `GET /api/v1/openapi.json` serves it with the default settings and without `servers`; `openapi.json` is the `full` one                                             |

   The `firstRelease` of a module is the first `v*` tag (without the `v`) that contains the commit that added its `module.ts`, from git; `null` without tags.

5. **Schema.** Every file is checked against the Zod schemas of `apps/server/src/docs-export/schema.ts` before it is written, and the tests check the
   written files again. `schemaVersion` is 1; removing a file or changing what a field means raises it, adding a field or a file does not.
6. **Deterministic.** Sorted keys and rows, no time stamp, no machine path; the zip uses one fixed time stamp. A test exports twice and compares the bytes.
7. **Failure.** A journey spec without a `test.step` (or with a bad step title) fails the export, naming the file; so does any file that does not fit its schema.
8. **One asset.** The pictures are in `screenshots/` of the zip; there is no separate `docs-screenshots.zip` (ADR of #134: one asset for the KB).

## Consequences

- A fact that is not in a manifest is not in the docs: a module that reads an environment variable declares it in `env`. `docs/implementation.md` rule 8,
  CLAUDE.md and CONTRIBUTING.md say so.
- The KB's `pnpm sync` copies the files it knows into `src/data/generated/` and can rely on the shapes above; a new file does not break it.
- The export covers the whole workspace, so unreleased modules appear as soon as their package exists; the KB filters by `firstRelease` and `profiles`.
- `RESERVED_COMMANDS` gains `docs:export`.
