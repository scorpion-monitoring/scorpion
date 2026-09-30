# Lint fixtures

Two fake modules that prove the module boundary rule works. They are **not** workspace
packages, are ignored by the normal `pnpm lint`, and are not type-checked or built. The test in
`tools/eslint-plugin/test/module-boundaries.test.ts` lints them with the real `eslint.config.js`.

- `mod-a` declares `@scorpion/mod-b` as a dependency.
- `mod-b` declares nothing.

| File                             | Expected                                                     |
| -------------------------------- | ------------------------------------------------------------ |
| `mod-a/src/public-import.ts`     | passes: imports `@scorpion/mod-b/public`                     |
| `mod-a/src/deep-import.ts`       | fails: imports `@scorpion/mod-b/src/internal`                |
| `mod-a/src/relative-import.ts`   | fails: imports `../../mod-b/src/internal.ts`                 |
| `mod-b/src/undeclared-import.ts` | fails: imports `@scorpion/mod-a/public` without declaring it |

`mod-c` declares `mod-b` as an optional peer dependency and `mod-a` only as a dev dependency:

| File                           | Expected                                                 |
| ------------------------------ | -------------------------------------------------------- |
| `mod-c/src/optional-import.ts` | passes: an optional peer dependency counts as declared   |
| `mod-c/src/dev-import.ts`      | fails: a dev dependency is not a module dependency       |
| `mod-c/src/manifest-import.ts` | fails: only the generated profile file imports `/module` |
