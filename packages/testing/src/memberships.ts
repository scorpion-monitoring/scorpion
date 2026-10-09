// A factory for `org_membership` (registry.organisations). It inserts a row directly, so a test can
// set up a membership in any state and role without going through the service. It knows the column
// names: a change to the schema breaks the integration tests, which is the point. It needs the
// module's migrations to have run.
import { randomUUID } from 'node:crypto';
import type { Queryable } from './identity.ts';

export interface MakeMembership {
  id?: string;
  organisationId: string;
  userId: string;
  /** `requested`, `approved`, `rejected` or `left`. Default `approved`. */
  state?: 'requested' | 'approved' | 'rejected' | 'left';
  /** `member` or `manager` (a manager must be `approved`: the table checks it). Default `member`. */
  role?: 'member' | 'manager';
  requestedAt?: Date;
}

export interface MembershipRow {
  id: string;
  organisation_id: string;
  user_id: string;
  state: string;
  role: string;
  requested_at: Date;
  decided_at: Date | null;
  decided_by: string | null;
  ended_at: Date | null;
  ended_by: string | null;
  role_changed_at: Date | null;
  role_changed_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function makeMembership(
  db: Queryable,
  overrides: MakeMembership,
): Promise<MembershipRow> {
  const { rows } = await db.query<MembershipRow>(
    `insert into org_membership (id, organisation_id, user_id, state, role, requested_at)
     values ($1, $2, $3, $4, $5, coalesce($6, now()))
     returning *`,
    [
      overrides.id ?? randomUUID(),
      overrides.organisationId,
      overrides.userId,
      overrides.state ?? 'approved',
      overrides.role ?? 'member',
      overrides.requestedAt ?? null,
    ],
  );
  return rows[0]!;
}
