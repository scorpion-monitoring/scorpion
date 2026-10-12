// Reads of `org_membership` that the organisation record and the membership service share: the member
// count of a page of organisations and the caller's own row per organisation. Grouped in SQL, so a
// list of 100 organisations is two queries, not 200.
import type { Db, DbTx } from '@scorpion/kernel';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { membership } from '../db/schema.ts';
import type { Role, State } from './membership-state.ts';

type Reader = Pick<Db | DbTx, 'select'>;

/** Approved members per organisation (a manager is a member). Organisations without any are 0. */
export async function approvedCounts(
  db: Reader,
  organisationIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>(organisationIds.map((id) => [id, 0]));
  if (organisationIds.length === 0) return counts;
  const rows = await db
    .select({ id: membership.organisationId, n: sql<number>`count(*)::int` })
    .from(membership)
    .where(
      and(
        inArray(membership.organisationId, [...organisationIds]),
        eq(membership.state, 'approved'),
      ),
    )
    .groupBy(membership.organisationId);
  for (const row of rows) counts.set(row.id, row.n);
  return counts;
}

/** The caller's own row per organisation, for the badges of a list. */
export async function ownRows(
  db: Reader,
  userId: string,
  organisationIds: readonly string[],
): Promise<Map<string, { state: State; role: Role }>> {
  if (organisationIds.length === 0) return new Map();
  const rows = await db
    .select({ id: membership.organisationId, state: membership.state, role: membership.role })
    .from(membership)
    .where(
      and(eq(membership.userId, userId), inArray(membership.organisationId, [...organisationIds])),
    );
  return new Map(
    rows.map((row) => [row.id, { state: row.state as State, role: row.role as Role }]),
  );
}
