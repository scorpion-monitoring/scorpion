import { describe, expect, it } from 'vitest';
import { MAX_NAMED_REQUESTS, ownView, type OwnRow } from './membership-card.ts';

const own = (state: string, name: string, abbreviation = name.toUpperCase()): OwnRow => ({
  state,
  organisation: { name, abbreviation },
});

describe('ownView', () => {
  it('counts the waiting requests and the memberships, and ignores rejected and ended rows', () => {
    expect(
      ownView([
        own('requested', 'Alpha'),
        own('approved', 'Beta'),
        own('approved', 'Gamma'),
        own('rejected', 'Delta'),
        own('left', 'Epsilon'),
      ]),
    ).toEqual({ requested: ['Alpha'], waiting: 1, member: 2 });
  });

  it('is empty for a person with no rows', () => {
    expect(ownView([])).toEqual({ requested: [], waiting: 0, member: 0 });
  });

  it('names at most a few requests, counts them all, and falls back to the abbreviation', () => {
    const rows = Array.from({ length: MAX_NAMED_REQUESTS + 2 }, (_, i) =>
      own('requested', i === 0 ? '' : `Org ${i}`, `O${i}`),
    );
    const view = ownView(rows);
    expect(view.waiting).toBe(MAX_NAMED_REQUESTS + 2);
    expect(view.requested).toHaveLength(MAX_NAMED_REQUESTS);
    expect(view.requested[0]).toBe('O0');
  });
});
