import { describe, expect, it } from 'vitest';
import { isDependencyUpdate, needsChangeset } from './changeset-check.ts';

describe('needsChangeset', () => {
  it.each([
    [['docs/architecture.md']],
    [['docs/adr/0002-x.md', 'docs/img/diagram.png']],
    [['README.md', 'CONTRIBUTING.md']],
    [['modules/kpi-ingestion/README.md']],
    [['.github/ISSUE_TEMPLATE/bug.yml', '.github/ISSUE_TEMPLATE/config.yml']],
    [['.github/pull_request_template.md']],
    [['docs/backlog.md', 'CLAUDE.md']],
    [[]],
  ])('exempts docs-only changes %j', (files) => {
    expect(needsChangeset(files)).toBe(false);
  });

  it.each([
    [['CHANGELOG.md']],
    [['packages/kernel/CHANGELOG.md']],
    [['docs/backlog.md', 'apps/server/src/index.ts']],
    [['README.md', '.github/workflows/ci.yml']],
    [['package.json']],
    [['.github/CODEOWNERS']],
    [['docs-tools/run.ts']],
    [['.github/ISSUE_TEMPLATE_old/x.yml']],
    [['scripts/notes.md.ts']],
  ])('requires a changeset for %j', (files) => {
    expect(needsChangeset(files)).toBe(true);
  });
});

describe('isDependencyUpdate', () => {
  const bot = 'dependabot[bot]';
  const branch = 'dependabot/npm_and_yarn/dev-deps-1a2b3c';

  it.each([
    [['pnpm-lock.yaml', 'package.json']],
    [['modules/core-identity/package.json', 'pnpm-lock.yaml']],
    [['.github/workflows/ci.yml', '.github/workflows/codeql.yml']],
    [['docker/Dockerfile']],
  ])('exempts a Dependabot update of %j', (files) => {
    expect(isDependencyUpdate(files, branch, bot)).toBe(true);
  });

  it.each([
    [
      'a bot change outside dependency files',
      ['pnpm-lock.yaml', 'apps/server/src/index.ts'],
      branch,
      bot,
    ],
    ['a bot change to a script', ['scripts/changeset-check.ts'], branch, bot],
    ['a bot change to CODEOWNERS', ['.github/CODEOWNERS'], branch, bot],
    ['a workflow in a subdirectory', ['.github/workflows/x/y.yml'], branch, bot],
    ['a human on a dependabot-looking branch', ['pnpm-lock.yaml'], branch, 'feserm'],
    ['a bot name on a feature branch', ['pnpm-lock.yaml'], 'feature/deps', bot],
    ['a lookalike author', ['pnpm-lock.yaml'], branch, 'dependabot-bot'],
    ['no author', ['pnpm-lock.yaml'], branch, undefined],
    ['no head ref', ['pnpm-lock.yaml'], undefined, bot],
    ['an empty diff', [], branch, bot],
  ])('requires a changeset for %s', (_name, files, head, author) => {
    expect(isDependencyUpdate(files, head, author)).toBe(false);
  });
});
