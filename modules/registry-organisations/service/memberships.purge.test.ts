// The purge of a person (`identity.user.purged@1`): their memberships go in one transaction, managers'
// too, and the handler can run twice. The event is delivered by the real dispatcher.
import { randomUUID } from 'node:crypto';
import { makeMembership, makeOrganisation } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { breakOutbox, useOrganisations } from '../test/harness.ts';
import { startWorld, type World } from '../test/world.ts';

const h = useOrganisations();

/** What `core.identity` writes when it purges a person: the outbox row and the delivery for this module. */
async function purged(w: World, userId: string) {
  const id = randomUUID();
  await w.pool.query(
    `insert into kernel_outbox (id, name, emitter, payload) values ($1, 'identity.user.purged@1', 'core.identity', $2::jsonb)`,
    [id, JSON.stringify({ userId, username: 'gone' })],
  );
  await w.pool.query(
    `insert into kernel_outbox_delivery (id, event_id, subscriber) values ($1, $2, 'registry.organisations')`,
    [randomUUID(), id],
  );
}

const rowsOf = async (w: World, userId: string) =>
  (await w.pool.query('select state, role from org_membership where user_id = $1', [userId])).rows;

describe('the purge subscriber', () => {
  it('deletes every membership of the person, in every state, and nobody else’s', async () => {
    const w = await startWorld(h);
    const gone = await w.person();
    const stays = await w.member();
    await w.join(gone);
    await w.join(gone, { organisationId: w.other.id, state: 'requested' });
    const third = await makeOrganisation(w.pool);
    await w.join(gone, { organisationId: third.id, state: 'rejected' });
    await purged(w, gone.userId);
    await w.dispatch();
    expect(await rowsOf(w, gone.userId)).toEqual([]);
    expect(await rowsOf(w, stays.userId)).toEqual([{ state: 'approved', role: 'member' }]);
    // An ended membership of an approved member is announced, as a system act (no actor).
    const events = await w.eventsNamed('registry.membership.left@1');
    expect(events).toEqual([
      expect.objectContaining({
        userId: gone.userId,
        by: 'system',
        actorId: null,
        organisationId: w.org.id,
      }),
    ]);
  });

  it('takes a purged manager away: the organisation falls back to the administrators, with the event and the inbox item', async () => {
    const w = await startWorld(h);
    const lone = await w.manager();
    await purged(w, lone.userId);
    await w.dispatch();
    expect(await rowsOf(w, lone.userId)).toEqual([]);
    const [event] = await w.eventsNamed('registry.membership.left@1');
    expect(event).toMatchObject({ by: 'system', organisationHasManager: false });
    const items = (await w.inbox()).filter(
      (i) => i.template === 'registry.organisation-without-manager',
    );
    expect(items.map((i) => i.user_id)).toEqual([w.admin.userId]);
    // A new request is still announced to the administrators, so the organisation is not stuck.
    const person = await w.person();
    await w.memberships.request(person, w.org.id);
    expect((await w.deliveries()).map((m) => m.recipient_address)).toEqual([
      await w.emailOf(w.admin),
    ]);
  });

  it('says nothing about a manager when another is left', async () => {
    const w = await startWorld(h);
    const first = await w.manager();
    await w.manager();
    await purged(w, first.userId);
    await w.dispatch();
    expect((await w.eventsNamed('registry.membership.left@1'))[0]).toMatchObject({
      organisationHasManager: true,
    });
    expect(
      (await w.inbox()).filter((i) => i.template === 'registry.organisation-without-manager'),
    ).toEqual([]);
  });

  it('is idempotent: delivered twice, or called again, it finds nothing and emits nothing more', async () => {
    const w = await startWorld(h);
    const gone = await w.member();
    await purged(w, gone.userId);
    await w.dispatch();
    await purged(w, gone.userId);
    await w.dispatch();
    await w.memberships.purgeUserAsSystem(gone.userId);
    await w.memberships.purgeUserAsSystem(randomUUID());
    await w.memberships.purgeUserAsSystem('not-a-uuid');
    expect(await w.eventsNamed('registry.membership.left@1')).toHaveLength(1);
  });

  it('rolls back with its transaction: when the event cannot be stored the rows stay', async () => {
    const w = await startWorld(h);
    const gone = await w.manager();
    await makeMembership(w.pool, {
      organisationId: w.other.id,
      userId: gone.userId,
      state: 'requested',
    });
    const undo = await breakOutbox(w.pool);
    await expect(w.memberships.purgeUserAsSystem(gone.userId)).rejects.toThrow();
    await undo();
    expect(await rowsOf(w, gone.userId)).toHaveLength(2);
    await w.memberships.purgeUserAsSystem(gone.userId);
    expect(await rowsOf(w, gone.userId)).toEqual([]);
  });

  it('writes no username and no address anywhere: the events hold ids only', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    const person = await w.person();
    const asked = await w.memberships.request(person, w.org.id);
    await w.memberships.decide(manager, asked.membership.id, 'approved');
    await w.memberships.setRole(w.admin, asked.membership.id, 'manager');
    await w.memberships.remove(w.admin, asked.membership.id);
    const text = JSON.stringify(await w.events());
    for (const who of [manager, person, w.admin]) {
      expect(text).not.toContain(who.username);
      expect(text).not.toContain(await w.emailOf(who));
    }
    expect(text).not.toMatch(/@example\.org/);
  });
});
