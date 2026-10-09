// The state machine over every state, role, action and actor (plan §7 item 3). The expectations are
// written as data (who may take each action, from which state, to what) and compared for every
// combination, so a new state, role or action breaks a test until somebody decides what it does.
import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  ACTORS,
  ROLES,
  STATES,
  allowedActions,
  transition,
  type Action,
  type By,
  type Current,
  type Outcome,
  type Role,
  type State,
} from './membership-state.ts';

/** The combinations that can exist in the table (a manager is always approved) and the absence of a row. */
const CURRENT: { label: string; current: Current }[] = [
  { label: 'no row', current: undefined },
  ...STATES.flatMap((state) =>
    ROLES.filter((role) => role === 'member' || state === 'approved').map((role) => ({
      label: `${state}/${role}`,
      current: { state, role } as Current,
    })),
  ),
];

/** Who may take each action. */
const WHO: Record<Action, By[]> = {
  request: ['self'],
  withdraw: ['self'],
  leave: ['self'],
  approve: ['admin', 'manager'],
  reject: ['admin', 'manager'],
  remove: ['admin', 'manager'],
  promote: ['admin', 'manager'],
  demote: ['admin', 'manager'],
};

/** The rows an action applies to, and what it does (state, role); `same` rows answer the current row. */
const RULES: Record<
  Action,
  {
    from: (c: Current) => boolean;
    to: { state: State; role: Role };
    same?: (c: Current) => boolean;
  }
> = {
  request: {
    from: (c) => c === undefined || c.state === 'rejected' || c.state === 'left',
    to: { state: 'requested', role: 'member' },
    same: (c) => c?.state === 'requested' || c?.state === 'approved',
  },
  approve: { from: (c) => c?.state === 'requested', to: { state: 'approved', role: 'member' } },
  reject: { from: (c) => c?.state === 'requested', to: { state: 'rejected', role: 'member' } },
  withdraw: { from: (c) => c?.state === 'requested', to: { state: 'left', role: 'member' } },
  leave: { from: (c) => c?.state === 'approved', to: { state: 'left', role: 'member' } },
  remove: { from: (c) => c?.state === 'approved', to: { state: 'left', role: 'member' } },
  promote: {
    from: (c) => c?.state === 'approved' && c.role === 'member',
    to: { state: 'approved', role: 'manager' },
    same: (c) => c?.state === 'approved' && c.role === 'manager',
  },
  demote: {
    from: (c) => c?.state === 'approved' && c.role === 'manager',
    to: { state: 'approved', role: 'member' },
    same: (c) => c?.state === 'approved' && c.role === 'member',
  },
};

function expected(current: Current, action: Action, by: By): Outcome {
  if (!WHO[action].includes(by)) return { kind: 'refused', reason: 'actor' };
  const rule = RULES[action];
  if (rule.same?.(current))
    return { kind: 'unchanged', state: current!.state, role: current!.role };
  if (!rule.from(current) && !rule.same?.(current)) {
    return { kind: 'refused', reason: 'state' };
  }
  if (action === 'remove' && by === 'manager' && current?.role === 'manager') {
    return { kind: 'refused', reason: 'manager-target' };
  }
  return { kind: 'change', ...rule.to };
}

describe('transition: every state, role, action and actor', () => {
  const cases = CURRENT.flatMap(({ label, current }) =>
    ACTIONS.flatMap((action) =>
      ACTORS.map((by) => ({ name: `${label} · ${action} · ${by}`, current, action, by })),
    ),
  );

  it('covers the whole space', () => {
    // 4 states with a member + approved manager + no row = 6 rows; 8 actions; 3 actors.
    expect(CURRENT).toHaveLength(6);
    expect(cases).toHaveLength(6 * 8 * 3);
  });

  it.each(cases)('$name', ({ current, action, by }) => {
    expect(transition(current, action, by)).toEqual(expected(current, action, by));
  });
});

describe('transition: the rules in words', () => {
  const approved: Current = { state: 'approved', role: 'member' };
  const manager: Current = { state: 'approved', role: 'manager' };
  const requested: Current = { state: 'requested', role: 'member' };

  it('reopens a rejected or left row with the role back at member', () => {
    for (const state of ['rejected', 'left'] as const) {
      expect(transition({ state, role: 'member' }, 'request', 'self')).toEqual({
        kind: 'change',
        state: 'requested',
        role: 'member',
      });
    }
    expect(transition(undefined, 'request', 'self')).toEqual({
      kind: 'change',
      state: 'requested',
      role: 'member',
    });
  });

  it('answers a repeated request with the current row, role included', () => {
    expect(transition(requested, 'request', 'self')).toEqual({ kind: 'unchanged', ...requested });
    expect(transition(manager, 'request', 'self')).toEqual({ kind: 'unchanged', ...manager });
  });

  it('resets the role when a manager leaves or is removed by an Admin', () => {
    expect(transition(manager, 'leave', 'self')).toEqual({
      kind: 'change',
      state: 'left',
      role: 'member',
    });
    expect(transition(manager, 'remove', 'admin')).toEqual({
      kind: 'change',
      state: 'left',
      role: 'member',
    });
  });

  it('lets a manager remove a plain member and never another manager', () => {
    expect(transition(approved, 'remove', 'manager').kind).toBe('change');
    expect(transition(manager, 'remove', 'manager')).toEqual({
      kind: 'refused',
      reason: 'manager-target',
    });
  });

  it('never removes a request: it is decided or withdrawn', () => {
    expect(transition(requested, 'remove', 'admin')).toEqual({ kind: 'refused', reason: 'state' });
    expect(transition(requested, 'remove', 'manager')).toEqual({
      kind: 'refused',
      reason: 'state',
    });
  });

  it('promotes and demotes only an approved member, and is idempotent on the same role', () => {
    for (const state of ['requested', 'rejected', 'left'] as const) {
      for (const action of ['promote', 'demote'] as const) {
        expect(transition({ state, role: 'member' }, action, 'admin')).toEqual({
          kind: 'refused',
          reason: 'state',
        });
      }
    }
    expect(transition(undefined, 'promote', 'admin')).toEqual({ kind: 'refused', reason: 'state' });
    expect(transition(manager, 'promote', 'manager').kind).toBe('unchanged');
    expect(transition(approved, 'demote', 'manager').kind).toBe('unchanged');
  });

  it('never lets the person decide, change a role or remove through the deciders’ actions', () => {
    for (const action of ['approve', 'reject', 'remove', 'promote', 'demote'] as const) {
      expect(transition(approved, action, 'self')).toEqual({ kind: 'refused', reason: 'actor' });
    }
    for (const action of ['request', 'withdraw', 'leave'] as const) {
      for (const by of ['admin', 'manager'] as const) {
        expect(transition(approved, action, by)).toEqual({ kind: 'refused', reason: 'actor' });
      }
    }
  });
});

describe('allowedActions', () => {
  const member: Current = { state: 'approved', role: 'member' };
  const manager: Current = { state: 'approved', role: 'manager' };
  it.each([
    ['admin', { state: 'requested', role: 'member' }, ['approve', 'reject']],
    ['manager', { state: 'requested', role: 'member' }, ['approve', 'reject']],
    ['admin', member, ['promote', 'remove']],
    ['manager', member, ['promote', 'remove']],
    ['admin', manager, ['demote', 'remove']],
    ['manager', manager, ['demote']],
    ['admin', { state: 'rejected', role: 'member' }, []],
    ['admin', { state: 'left', role: 'member' }, []],
  ] as const)('%s on %j: %j', (by, current, actions) => {
    expect(allowedActions(current, by, false)).toEqual(actions);
  });

  it('offers nothing on the caller’s own row', () => {
    for (const current of CURRENT.map((c) => c.current)) {
      expect(allowedActions(current, 'admin', true)).toEqual([]);
      expect(allowedActions(current, 'manager', true)).toEqual([]);
    }
  });
});
