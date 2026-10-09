// A small world for the membership tests: an Admin, an organisation, a second one, and helpers that
// make people with a membership in any state and role. Rows are set up with the factories of
// `packages/testing`; everything under test goes through the service and the real authoriser.
import type { UserActor } from '@scorpion/contracts';
import { makeMembership, makeOrganisation } from '@scorpion/testing';
import {
  type OrganisationsHarness,
  type OrganisationsStartOptions,
  type OrganisationsStarted,
} from './harness.ts';

export type World = OrganisationsStarted & Awaited<ReturnType<typeof buildWorld>>;

async function buildWorld(s: OrganisationsStarted) {
  const admin = await s.actor('admin');
  const org = await makeOrganisation(s.pool, { abbreviation: 'IPK', name: 'Leibniz IPK' });
  const other = await makeOrganisation(s.pool, { abbreviation: 'DKFZ', name: 'DKFZ Heidelberg' });
  /** A plain signed-in person (role `user`) with no membership. */
  const person = () => s.actor('user');
  const join = async (
    who: UserActor,
    options: {
      organisationId?: string;
      state?: 'requested' | 'approved' | 'rejected' | 'left';
      role?: 'member' | 'manager';
    } = {},
  ) =>
    makeMembership(s.pool, {
      organisationId: options.organisationId ?? org.id,
      userId: who.userId,
      state: options.state ?? 'approved',
      role: options.role ?? 'member',
    });
  const manager = async (organisationId = org.id) => {
    const who = await person();
    await join(who, { organisationId, role: 'manager' });
    return who;
  };
  const member = async (organisationId = org.id) => {
    const who = await person();
    await join(who, { organisationId });
    return who;
  };
  /** A person with an open request, and the row. */
  const requester = async (organisationId = org.id) => {
    const who = await person();
    const row = await join(who, { organisationId, state: 'requested' });
    return { who, row };
  };
  const rowOf = async (who: UserActor, organisationId = org.id) =>
    (
      await s.pool.query<{
        id: string;
        state: string;
        role: string;
        requested_at: Date;
        decided_at: Date | null;
        decided_by: string | null;
        ended_at: Date | null;
        ended_by: string | null;
        role_changed_at: Date | null;
        role_changed_by: string | null;
      }>('select * from org_membership where organisation_id = $1 and user_id = $2', [
        organisationId,
        who.userId,
      ])
    ).rows[0];
  const eventsNamed = async (name: string) =>
    (await s.events()).filter((event) => event.name === name).map((event) => event.payload);
  return { admin, org, other, person, join, manager, member, requester, rowOf, eventsNamed };
}

export async function startWorld(h: OrganisationsHarness, options?: OrganisationsStartOptions) {
  const s = await h.start(options);
  return { ...s, ...(await buildWorld(s)) };
}
