// The membership state machine (plan §7 item 3, ADR-0033). Pure: no database, no clock, no identity.
// The service reads the row under a lock, asks `transition`, and writes what it says. The states and
// the roles are closed sets of code; the table has check constraints and no pg enum.
//
// "Who" is the actor's relationship to the organisation, not a person:
//   `self`     the person the row belongs to (request, withdraw, leave);
//   `admin`    holds the scoped permission globally (Admin);
//   `manager`  an approved manager of this organisation, holding it through the policy.
// Whether a caller is the person of the row (nobody approves their own request, changes their own role
// or removes themselves) is checked by the service before it asks; here `by` carries only the kind.

export const STATES = ['requested', 'approved', 'rejected', 'left'] as const;
export type State = (typeof STATES)[number];

export const ROLES = ['member', 'manager'] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  'request',
  'approve',
  'reject',
  'withdraw',
  'leave',
  'remove',
  'promote',
  'demote',
] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTORS = ['self', 'admin', 'manager'] as const;
export type By = (typeof ACTORS)[number];

/** The row as it is now; `undefined` when the person has no row yet. */
export type Current = { state: State; role: Role } | undefined;

export type Refusal =
  /** The action does not apply to the current state: 409 `membership-state`. */
  | 'state'
  /** This kind of actor may not take this action at all: 403. */
  | 'actor'
  /** A manager may not remove a manager: only an Admin does: 403. */
  | 'manager-target';

export type Outcome =
  | { kind: 'change'; state: State; role: Role }
  /** Already there: the answer is the current row (an idempotent request, a role change to the same role). */
  | { kind: 'unchanged'; state: State; role: Role }
  | { kind: 'refused'; reason: Refusal };

const change = (state: State, role: Role = 'member'): Outcome => ({ kind: 'change', state, role });
const refused = (reason: Refusal): Outcome => ({ kind: 'refused', reason });

/** Who may take each action. `remove` by a manager is narrowed to a plain member below. */
const ACTORS_OF: Record<Action, readonly By[]> = {
  request: ['self'],
  withdraw: ['self'],
  leave: ['self'],
  approve: ['admin', 'manager'],
  reject: ['admin', 'manager'],
  remove: ['admin', 'manager'],
  promote: ['admin', 'manager'],
  demote: ['admin', 'manager'],
};

/** What `action` does to `current` for `by`. The caller has already refused "oneself" where it matters. */
export function transition(current: Current, action: Action, by: By): Outcome {
  if (!ACTORS_OF[action].includes(by)) return refused('actor');
  const state = current?.state;
  const role = current?.role ?? 'member';
  switch (action) {
    case 'request':
      if (state === 'requested' || state === 'approved') return { kind: 'unchanged', state, role };
      return change('requested');
    case 'approve':
      return state === 'requested' ? change('approved') : refused('state');
    case 'reject':
      return state === 'requested' ? change('rejected') : refused('state');
    case 'withdraw':
      return state === 'requested' ? change('left') : refused('state');
    case 'leave':
      return state === 'approved' ? change('left') : refused('state');
    case 'remove':
      if (state !== 'approved') return refused('state');
      // Only an Admin ends a manager's membership; a manager can only demote them.
      return by === 'manager' && role === 'manager' ? refused('manager-target') : change('left');
    case 'promote':
      if (state !== 'approved') return refused('state');
      return role === 'manager'
        ? { kind: 'unchanged', state, role }
        : change('approved', 'manager');
    case 'demote':
      if (state !== 'approved') return refused('state');
      return role === 'member' ? { kind: 'unchanged', state, role } : change('approved', 'member');
  }
}

/** The actions a decider may take on somebody else's row, in the order a screen shows them. */
export const DECIDER_ACTIONS = ['approve', 'reject', 'promote', 'demote', 'remove'] as const;
export type DeciderAction = (typeof DECIDER_ACTIONS)[number];

/**
 * What `by` may do to this row now, so that a screen draws buttons from data. Every action is checked
 * again when it is taken. Nobody acts on their own row (`own`): not approve, not a role change, not
 * a removal (that is `leave`).
 */
export function allowedActions(
  current: Current,
  by: Exclude<By, 'self'>,
  own: boolean,
): DeciderAction[] {
  if (own) return [];
  return DECIDER_ACTIONS.filter((action) => transition(current, action, by).kind === 'change');
}
