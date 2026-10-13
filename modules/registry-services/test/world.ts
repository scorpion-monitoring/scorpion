// A world for the access tests of sprint 2: one provider with one service and the people of every kind that
// the policy `service.member` must tell apart, on a database of its own. Real Postgres, the real authoriser.
import type { Actor, DomainError, UserActor } from '@scorpion/contracts';
import { makeMembership, makeOrganisation, makeService } from '@scorpion/testing';
import type { ServicesHarness } from './harness.ts';

/** The error a promise rejects with; the test fails when it resolves. */
export async function rejection(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    return error as DomainError;
  }
  throw new Error('the call resolved; it should have been refused');
}

let sequence = 0;
/** A slug and a name that no other test uses (the specs of a run share one server). */
export const uniq = (prefix = 'svc') =>
  `${prefix}-${++sequence}-${Math.random().toString(36).slice(2, 7)}`;

export const anonymous: Actor = { kind: 'anonymous' };

export async function world(h: ServicesHarness, options?: Parameters<ServicesHarness['start']>[0]) {
  const s = await h.start(options);
  const provider = await makeOrganisation(s.pool, { type: 'provider' });
  const other = await makeOrganisation(s.pool, { type: 'provider' });
  const consortium = await makeOrganisation(s.pool, { type: 'consortium' });
  const consortium2 = await makeOrganisation(s.pool, { type: 'consortium' });
  const svc = await makeService(s.pool, { provider: provider.id, consortia: [consortium.id] });
  const people = {
    admin: await s.actor('admin'),
    reviewer: await s.actor('reviewer'),
    manager: await s.actor('user'),
    member: await s.actor('user'),
    requested: await s.actor('user'),
    rejected: await s.actor('user'),
    left: await s.actor('user'),
    managerElsewhere: await s.actor('user'),
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
  await join(people.rejected, provider.id, 'rejected');
  await join(people.left, provider.id, 'left');
  await join(people.managerElsewhere, other.id, 'approved', 'manager');
  const resource = (id = svc.id) => ({ type: 'service', id });
  const row = async (id = svc.id) =>
    (
      await s.pool.query<{
        slug: string;
        name: string;
        stage: string;
        description: string | null;
        url: string | null;
        same_as: string[];
        license: string | null;
        contact_email: string | null;
        contact_type: string | null;
        public: boolean;
        published_by: string | null;
        updated_by: string | null;
        icon_blob_id: string | null;
        icon_hash: string | null;
      }>('select * from svc_service where id = $1', [id])
    ).rows[0]!;
  const links = async (id = svc.id) =>
    (
      await s.pool.query<{ role: string; organisation_id: string }>(
        'select role, organisation_id from svc_service_organisation where service_id = $1 order by role, organisation_id',
        [id],
      )
    ).rows;
  const history = async (id = svc.id) =>
    (
      await s.pool.query<{ slug: string }>(
        'select slug from svc_slug_history where service_id = $1 order by created_at, id',
        [id],
      )
    ).rows.map((r) => r.slug);
  return {
    ...s,
    provider,
    other,
    consortium,
    consortium2,
    svc,
    people,
    join,
    resource,
    row,
    links,
    history,
  };
}

export type World = Awaited<ReturnType<typeof world>>;
