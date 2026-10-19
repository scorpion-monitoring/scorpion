// Helpers of the service tests: an administrator, a plain user, and unique names (specs share a database).
import { DomainError, type UserActor } from '@scorpion/contracts';
import { makeMembership, makeOrganisation, makeService } from '@scorpion/testing';
import type { KpiStarted } from './harness.ts';

let counter = 0;
export const uniq = (prefix: string) =>
  `${prefix}-${++counter}-${Math.random().toString(36).slice(2, 7)}`;

export async function world(s: KpiStarted) {
  return { ...s, admin: await s.actor('admin'), plain: await s.actor('user') };
}
export type World = Awaited<ReturnType<typeof world>>;

/** The rejection of a promise as the error it threw (the test fails when it resolved). */
export async function rejection(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

/** Makes the outbox refuse an insert, so the event of a write cannot be stored. Returns the undo. */
export async function breakOutbox(pool: { query(text: string): Promise<unknown> }) {
  await pool.query(`
    create or replace function test_break_outbox() returns trigger as $$
    begin raise exception 'outbox is broken for this test'; end $$ language plpgsql;
    create trigger test_break_outbox before insert on kernel_outbox
      for each row execute function test_break_outbox();`);
  return () => pool.query('drop trigger test_break_outbox on kernel_outbox');
}

export const paths = (error: DomainError) => (error.errors ?? []).map((e) => e.path).sort();

interface Queryable {
  query<R = unknown>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

/** The payloads of the outbox events with this name, oldest first. */
export async function payloads(pool: Queryable, name: string): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
    'select payload from kernel_outbox where name = $1 order by id',
    [name],
  );
  return rows.map((row) => row.payload);
}

/** The number of rows of a table. */
export async function count(pool: Queryable, table: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return rows[0]!.n;
}

// ----- a service with a provider and the people who may or may not change its KPIs -----------------------

/** A service of one provider, another provider, and one person of each kind the policy has to tell apart. */
export async function serviceWorld(s: KpiStarted) {
  const provider = await makeOrganisation(s.pool, { type: 'provider' });
  const other = await makeOrganisation(s.pool, { type: 'provider' });
  const svc = await makeService(s.pool, { provider: provider.id });
  const people = {
    admin: await s.actor('admin'),
    manager: await s.actor('user'),
    member: await s.actor('user'),
    requested: await s.actor('user'),
    left: await s.actor('user'),
    elsewhere: await s.actor('user'),
    plain: await s.actor('user'),
  };
  const join = (who: UserActor, organisationId: string, state: string, role = 'member') =>
    makeMembership(s.pool, {
      organisationId,
      userId: who.userId,
      state: state as 'approved',
      role: role as 'member',
    });
  await join(people.manager, provider.id, 'approved', 'manager');
  await join(people.member, provider.id, 'approved');
  await join(people.requested, provider.id, 'requested');
  await join(people.left, provider.id, 'left');
  await join(people.elsewhere, other.id, 'approved', 'manager');
  return { ...s, provider, other, svc, people, join };
}
export type ServiceWorld = Awaited<ReturnType<typeof serviceWorld>>;

/** The set id and the extra ids stored for a service, read straight from the tables. */
export async function stored(pool: Queryable, serviceId: string) {
  const set = await pool.query<{ set_id: string }>(
    'select set_id from kpif_service_set where service_id = $1',
    [serviceId],
  );
  const extras = await pool.query<{ indicator_id: string }>(
    'select indicator_id from kpif_service_extra_indicator where service_id = $1 order by indicator_id',
    [serviceId],
  );
  return {
    setId: set.rows[0]?.set_id ?? null,
    extras: extras.rows.map((row) => row.indicator_id),
  };
}
