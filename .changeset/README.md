# Changesets

Every pull request adds a changeset, except one that only changes documentation (`docs/**`,
`**/*.md` other than `CHANGELOG.md`, `.github/ISSUE_TEMPLATE/**`). CI checks this
(`pnpm changeset:check`).

- `pnpm changeset`: describe a change for `CHANGELOG.md`. Pick the package `scorpion` (the
  product; the internal `@scorpion/*` packages are not versioned separately) and a bump:
  `patch` for fixes, `minor` for features, `major` only for a breaking change.
- `pnpm changeset --empty`: for a change that does not belong in the changelog (tests, CI,
  refactoring).

Write the summary for operators and API users: what changed and what they have to do, not how
it was implemented.

At a release, `pnpm changeset version` consumes the changesets, bumps the version in the root
`package.json` and writes `CHANGELOG.md`. See CONTRIBUTING.md, "Releases".
