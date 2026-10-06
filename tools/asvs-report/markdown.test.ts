import { describe, expect, it } from 'vitest';
import { headingAnchors, slug } from './markdown.ts';

describe('slug', () => {
  it.each([
    ['4. Sprint 1: sessions and re-authentication', '4-sprint-1-sessions-and-re-authentication'],
    ['6. Sprint 3: `ui-kit` and administration', '6-sprint-3-ui-kit-and-administration'],
    [
      'Out of scope (goes to `docs/backlog.md` if not there)',
      'out-of-scope-goes-to-docsbacklogmd-if-not-there',
    ],
    ['Decisions taken (2026-10-05)', 'decisions-taken-2026-10-05'],
  ])('%s', (heading, expected) => {
    expect(slug(heading)).toBe(expected);
  });
});

describe('headingAnchors', () => {
  it('lists every heading, numbers a repeat, and skips code fences', () => {
    const md = '# A\n\n## B\n\n```\n# not a heading\n```\n\n## B\n\n### C ###\n';
    expect(headingAnchors(md)).toEqual(['a', 'b', 'b-1', 'c']);
  });
});
