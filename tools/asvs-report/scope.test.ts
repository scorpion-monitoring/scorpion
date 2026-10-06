import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chaptersForFiles, chaptersForPath, SCOPED_PATHS } from './scope.ts';

describe('chaptersForPath', () => {
  it.each([
    ['modules/core-identity/service/sessions.ts', ['V6', 'V7', 'V10']],
    ['modules/core-authz/service/authz.ts', ['V8']],
    ['apps/server/src/pipeline/authorize.ts', ['V7', 'V8']],
    ['packages/contracts/src/route.ts', ['V8']],
    ['packages/contracts/src/route.test.ts', []],
    ['packages/contracts/src/other.ts', []],
    ['docs/security/README.md', ['V6', 'V7', 'V8', 'V10']],
    ['docs/security/asvs/source/OWASP_ASVS_5.0.0_en.json', ['V6', 'V7', 'V8', 'V10']],
    ['modules/core-identity-extra/x.ts', []],
    ['modules/kpi-ingestion/x.ts', []],
  ])('%s', (file, chapters) => {
    expect(chaptersForPath(file)).toEqual(chapters);
  });

  it.each([
    'docs/security/asvs/v6-authentication.yaml',
    'docs/security/asvs/v6-authentication.md',
    'docs/security/asvs/v10-oauth-oidc.yaml',
  ])('treats the assessment file %s as the update, not as a scoped change', (file) => {
    expect(chaptersForPath(file)).toEqual([]);
  });
});

describe('chaptersForFiles', () => {
  it('unites the chapters in chapter order', () => {
    expect(chaptersForFiles(['modules/core-authz/a.ts', 'modules/core-identity/b.ts'])).toEqual([
      'V6',
      'V7',
      'V8',
      'V10',
    ]);
  });
});

describe('the lists of scoped paths', () => {
  const codeowners = readFileSync(new URL('../../.github/CODEOWNERS', import.meta.url), 'utf8');
  const claude = readFileSync(new URL('../../CLAUDE.md', import.meta.url), 'utf8');

  it.each(SCOPED_PATHS.map((s) => [s.path]))('%s is in CODEOWNERS', (path) => {
    expect(codeowners).toContain(`/${path}`);
  });

  it.each(SCOPED_PATHS.map((s) => [s.path]))('%s is in CLAUDE.md', (path) => {
    expect(claude).toContain(`\`${path}\``);
  });
});
