import { describe, expect, it } from 'vitest';
import { badgeKey, hasManager, rowNote, type RowFacts } from './membership-rows.ts';

const row = (change: Partial<RowFacts>): RowFacts => ({
  userId: 'other',
  state: 'approved',
  role: 'member',
  allowedActions: ['promote', 'remove'],
  ...change,
});

describe('rowNote', () => {
  it.each([
    [
      'the viewer’s own request',
      row({ userId: 'me', state: 'requested', allowedActions: [] }),
      'membership.note.ownRequest',
    ],
    [
      'the viewer’s own membership',
      row({ userId: 'me', allowedActions: [] }),
      'membership.note.ownMember',
    ],
    [
      'the viewer’s own manager role',
      row({ userId: 'me', role: 'manager', allowedActions: [] }),
      'membership.note.ownManager',
    ],
    [
      'a finished row of the viewer',
      row({ userId: 'me', state: 'left', allowedActions: [] }),
      undefined,
    ],
    [
      'another manager, whom a manager cannot remove',
      row({ role: 'manager', allowedActions: ['demote'] }),
      'membership.note.managerRemoval',
    ],
    [
      'another manager, whom an administrator can remove',
      row({ role: 'manager', allowedActions: ['demote', 'remove'] }),
      undefined,
    ],
    ['a plain member with the buttons', row({}), undefined],
    [
      'somebody else’s request',
      row({ state: 'requested', allowedActions: ['approve', 'reject'] }),
      undefined,
    ],
  ])('for %s', (_name, input, expected) => {
    expect(rowNote(input, 'me')).toBe(expected);
  });

  it('never calls a row the viewer’s own when the viewer is not known', () => {
    expect(rowNote(row({ userId: 'me', allowedActions: [] }), undefined)).toBeUndefined();
  });
});

describe('hasManager', () => {
  it('counts approved managers only', () => {
    expect(hasManager([])).toBe(false);
    expect(hasManager([{ state: 'approved', role: 'member' }])).toBe(false);
    expect(hasManager([{ state: 'requested', role: 'manager' }])).toBe(false);
    expect(hasManager([{ state: 'approved', role: 'manager' }])).toBe(true);
  });
});

describe('badgeKey', () => {
  it.each([
    ['requested', 'member', 'organisation.membership.state.requested'],
    ['approved', 'member', 'organisation.membership.state.member'],
    ['approved', 'manager', 'organisation.membership.state.manager'],
    ['rejected', 'member', 'organisation.membership.state.rejected'],
    ['left', 'manager', 'organisation.membership.state.left'],
  ] as const)('%s %s is %s', (state, role, key) => {
    expect(badgeKey(state, role)).toBe(key);
  });
});
