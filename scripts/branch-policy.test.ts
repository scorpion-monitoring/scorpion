import { describe, expect, it } from 'vitest';
import { checkPullRequest } from './branch-policy.ts';

describe('checkPullRequest', () => {
  it.each([
    ['feature/m1-module-loader', 'dev'],
    ['feature/fix-healthz', 'release/0.2.0'],
    ['release/0.2.0', 'main'],
    ['release/0.2.0', 'dev'],
    ['hotfix/0.2.1', 'main'],
    ['hotfix/0.2.1', 'dev'],
    ['main', 'dev'],
  ])('allows %s → %s', (head, base) => {
    expect(checkPullRequest(head, base)).toBeUndefined();
  });

  it.each([
    ['feature/m1-module-loader', 'main', 'may not be merged'],
    ['dev', 'main', 'may not be merged'],
    ['hotfix/0.2.1', 'release/0.3.0', 'may not be merged'],
    ['feature/a', 'feature/b', 'may not target a feature branch'],
    ['my-branch', 'dev', 'naming policy'],
    ['feature/Upper_Case', 'dev', 'naming policy'],
    ['release/next', 'main', 'naming policy'],
    ['feature/a', 'gh-pages', "may not target 'gh-pages'"],
  ])('rejects %s → %s', (head, base, reason) => {
    expect(checkPullRequest(head, base)).toContain(reason);
  });
});
