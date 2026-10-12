// What a screen says about one row of the membership lists, from data. The API puts the actions the caller may
// take into `allowedActions`; this module only decides which sentence explains a missing button, so the page
// never decides a right from a role (the server does). Pure, so it is unit tested.

export type RowAction = 'approve' | 'reject' | 'promote' | 'demote' | 'remove';

export interface RowFacts {
  userId: string;
  state: 'requested' | 'approved' | 'rejected' | 'left';
  role: 'member' | 'manager';
  allowedActions: readonly RowAction[];
}

/**
 * The key of the sentence that says why the caller cannot act on this row, or `undefined` when there is
 * nothing to explain (the buttons are there, or the row is finished and nothing is offered anyway).
 */
export function rowNote(row: RowFacts, viewerId: string | undefined): string | undefined {
  if (viewerId !== undefined && row.userId === viewerId) {
    if (row.state === 'requested') return 'membership.note.ownRequest';
    if (row.state === 'approved') {
      return row.role === 'manager' ? 'membership.note.ownManager' : 'membership.note.ownMember';
    }
    return undefined;
  }
  // A manager cannot remove another manager; only an administrator can. An administrator is offered the button.
  if (
    row.state === 'approved' &&
    row.role === 'manager' &&
    !row.allowedActions.includes('remove')
  ) {
    return 'membership.note.managerRemoval';
  }
  return undefined;
}

/** Whether an approved list names at least one manager (the notice "No manager: administrators decide"). */
export const hasManager = (rows: readonly Pick<RowFacts, 'state' | 'role'>[]): boolean =>
  rows.some((row) => row.state === 'approved' && row.role === 'manager');

/** The catalogue key of the badge for a membership: always a word, never a colour alone. */
export function badgeKey(state: RowFacts['state'], role: RowFacts['role']): string {
  const word = state === 'approved' ? role : state;
  return `organisation.membership.state.${word}`;
}

/** The DaisyUI class of the badge; the text carries the meaning, the colour only helps. */
export function badgeClass(state: RowFacts['state'], role: RowFacts['role']): string {
  if (state === 'requested') return 'badge-warning';
  if (state === 'approved') return role === 'manager' ? 'badge-info' : 'badge-success';
  return 'badge-ghost';
}
