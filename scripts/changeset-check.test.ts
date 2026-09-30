import { describe, expect, it } from 'vitest';
import { needsChangeset } from './changeset-check.ts';

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
