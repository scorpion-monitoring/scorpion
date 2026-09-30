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
