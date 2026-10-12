// Asking to join, withdrawing and leaving, over real Postgres: the state, the event, the mail and the
// inbox item of each, the cap, the type that has no members, and what a failure leaves behind.
import { Forbidden, Invalid, NotFound, Unauthorized, type Actor } from '@scorpion/contracts';
import { makeOrganisation } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import {
  breakDeliveries,
  breakOutbox,
  fixtureContributor,
  useOrganisations,
} from '../test/harness.ts';
import { startWorld } from '../test/world.ts';

const h = useOrganisations();
const anonymous: Actor = { kind: 'anonymous' };
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';

describe('request', () => {
  it('creates a request: the row, one event with ids only, and a mail and an inbox item for the managers and the administrators', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    const second = w.admin; // the one administrator of the world
    const person = await w.person();
    const { membership, created } = await w.memberships.request(person, w.org.id);
    expect(created).toBe(true);
    expect(membership).toMatchObject({
      organisation: { id: w.org.id, abbreviation: 'IPK' },
      state: 'requested',
      role: 'member',
      decidedAt: null,
      endedAt: null,
    });
    expect(await w.rowOf(person)).toMatchObject({ state: 'requested', role: 'member' });
    expect(await w.eventsNamed('registry.membership.requested@1')).toEqual([
      { membershipId: membership.id, organisationId: w.org.id, userId: person.userId },
    ]);
    // The manager and the administrator, once each; never the requester.
    const mails = await w.deliveries();
    expect(mails.map((m) => m.recipient_address).sort()).toEqual(
      [await w.emailOf(manager), await w.emailOf(second)].sort(),
    );
    for (const mail of mails) {
      expect(mail.template).toBe('registry.membership-requested');
      expect(mail.subject).toBe(`Membership request from ${person.username}`);
      expect(mail.text_body).toContain('Leibniz IPK');
      // Never the requester's address, nor anybody else's but the recipient's own.
      expect(mail.text_body).not.toContain(await w.emailOf(person));
    }
    const inbox = await w.inbox();
    expect(inbox.map((item) => item.user_id).sort()).toEqual(
      [manager.userId, second.userId].sort(),
    );
    expect(inbox.every((item) => item.template === 'registry.membership-requested')).toBe(true);
  });

  it('sends a manager to the screen of the organisation’s requests and an administrator to the administrators’ screen, and a person who is both gets one mail', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    // An administrator who also manages the organisation.
    const both = await w.actor('admin');
    await w.join(both, { role: 'manager' });
    const person = await w.person();
    await w.memberships.request(person, w.org.id);
    const mails = await w.deliveries();
    const byAddress = new Map(mails.map((m) => [m.recipient_address, m]));
    expect(mails).toHaveLength(3); // the manager, the world's administrator, the second administrator
    expect(byAddress.get(await w.emailOf(manager))!.text_body).toContain('/account/organisations');
    expect(byAddress.get(await w.emailOf(manager))!.text_body).not.toContain('/admin/memberships');
    expect(byAddress.get(await w.emailOf(both))!.text_body).toContain('/admin/memberships');
    expect(byAddress.get(await w.emailOf(w.admin))!.text_body).toContain('/admin/memberships');
    // The inbox items link to the same screens.
    const links = new Map((await w.inbox()).map((item) => [item.user_id, item.link]));
    expect(links.get(manager.userId)).toMatch(/\/account\/organisations$/);
    expect(links.get(both.userId)).toMatch(/\/admin\/memberships$/);
  });

  it('does not mail an administrator who asks themselves, and skips a deactivated account and an account without an address', async () => {
    const w = await startWorld(h);
    const ghost = await w.actor('admin');
    await w.pool.query("update identity_user set status = 'deactivated' where id = $1", [
      ghost.userId,
    ]);
    const nobody = await w.actor('admin');
    await w.pool.query('update identity_user set email = null where id = $1', [nobody.userId]);
    await w.memberships.request(w.admin, w.org.id);
    const mails = await w.deliveries();
    expect(mails.map((m) => m.recipient_user_id)).not.toContain(w.admin.userId);
    expect(mails.map((m) => m.recipient_user_id)).not.toContain(ghost.userId);
    expect(mails.map((m) => m.recipient_user_id)).not.toContain(nobody.userId);
    // The account without an address still has its inbox item.
    expect((await w.inbox()).map((item) => item.user_id)).toContain(nobody.userId);
    expect((await w.inbox()).map((item) => item.user_id)).not.toContain(ghost.userId);
  });

  it('writes each mail in the language its recipient chose, and the instance default otherwise', async () => {
    const w = await startWorld(h);
    const german = await w.manager();
    await w.setLocale(german, 'de');
    const english = await w.manager();
    const person = await w.person();
    await w.memberships.request(person, w.org.id);
    const mails = await w.deliveries();
    const of = (who: typeof german) => mails.find((m) => m.recipient_user_id === who.userId)!;
    expect(of(german).locale).toBe('de');
    expect(of(german).subject).toBe(`Mitgliedschaftsanfrage von ${person.username}`);
    expect(of(english).locale).toBe('en');
    expect(of(english).subject).toBe(`Membership request from ${person.username}`);
    // The inbox item of the German reader is German too.
    const item = (await w.inbox()).find((i) => i.user_id === german.userId)!;
    expect(item.title).toMatch(/Mitgliedschaftsanfrage/);
  });

  it('answers a repeated request with the current row: no second event, mail or row, also for a member', async () => {
    const w = await startWorld(h);
    await w.manager();
    const person = await w.person();
    const first = await w.memberships.request(person, w.org.id);
    const again = await w.memberships.request(person, w.org.id);
    expect(again.created).toBe(false);
    expect(again.membership.id).toBe(first.membership.id);
    expect(await w.eventsNamed('registry.membership.requested@1')).toHaveLength(1);
    const mailsBefore = (await w.deliveries()).length;
    const member = await w.member();
    const asMember = await w.memberships.request(member, w.org.id);
    expect(asMember).toMatchObject({ created: false, membership: { state: 'approved' } });
    expect((await w.deliveries()).length).toBe(mailsBefore);
    expect(
      (await w.pool.query('select 1 from org_membership where user_id = $1', [person.userId])).rows,
    ).toHaveLength(1);
  });

  it.each(['rejected', 'left'] as const)(
    'reopens a %s row: the same row, requested again, the role back at member and the old decision forgotten',
    async (state) => {
      const w = await startWorld(h);
      const person = await w.person();
      const old = await w.join(person, { state });
      await w.pool.query(
        `update org_membership set decided_at = now(), decided_by = $2, ended_at = now(), ended_by = $2 where id = $1`,
        [old.id, w.admin.userId],
      );
      const { membership, created } = await w.memberships.request(person, w.org.id);
      expect(created).toBe(true);
      expect(membership.id).toBe(old.id);
      expect(await w.rowOf(person)).toMatchObject({
        state: 'requested',
        role: 'member',
        decided_at: null,
        decided_by: null,
        ended_at: null,
        ended_by: null,
        role_changed_at: null,
      });
      expect(await w.eventsNamed('registry.membership.requested@1')).toHaveLength(1);
    },
  );

  it('refuses a type that has no members with the problem type membership-not-supported, and an unknown or malformed organisation', async () => {
    const funder = fixtureContributor({
      types: [{ id: 'funder', labels: { en: 'Funder' }, membership: false, order: 30 }],
    });
    const w = await startWorld(h, { extra: [funder] });
    const grant = await makeOrganisation(w.pool, { type: 'funder' });
    const person = await w.person();
    await expect(w.memberships.request(person, grant.id)).rejects.toMatchObject({
      status: 422,
      type: 'membership-not-supported',
    });
    await expect(w.memberships.request(person, ABSENT)).rejects.toBeInstanceOf(NotFound);
    await expect(w.memberships.request(person, 'not-a-uuid')).rejects.toBeInstanceOf(Invalid);
    expect((await w.pool.query('select 1 from org_membership')).rows).toEqual([]);
    // A consortium takes members, as a provider does.
    const consortium = await makeOrganisation(w.pool, { type: 'consortium' });
    expect((await w.memberships.request(person, consortium.id)).created).toBe(true);
  });

  it('caps the open requests per person with 409 too-many-pending, and frees a place when one is decided or withdrawn', async () => {
    const w = await startWorld(h);
    await w.configure({ membership: { maxPendingPerUser: 2 } });
    const third = await makeOrganisation(w.pool);
    const fourth = await makeOrganisation(w.pool);
    const person = await w.person();
    await w.memberships.request(person, w.org.id);
    await w.memberships.request(person, w.other.id);
    await expect(w.memberships.request(person, third.id)).rejects.toMatchObject({
      status: 409,
      type: 'too-many-pending',
    });
    // Another person is not affected.
    expect((await w.memberships.request(await w.person(), third.id)).created).toBe(true);
    // A repeated request is no new one.
    expect((await w.memberships.request(person, w.org.id)).created).toBe(false);
    // Withdrawing frees a place.
    await w.memberships.leave(person, w.other.id);
    expect((await w.memberships.request(person, third.id)).created).toBe(true);
    // So does a decision.
    const row = (await w.rowOf(person, w.org.id))!;
    await w.memberships.decide(w.admin, row.id, 'rejected');
    expect((await w.memberships.request(person, fourth.id)).created).toBe(true);
  });

  it('turns away an anonymous caller, and a person without the permission', async () => {
    const w = await startWorld(h);
    await expect(w.memberships.request(anonymous, w.org.id)).rejects.toBeInstanceOf(Unauthorized);
    const roleless = await w.actor();
    await expect(w.memberships.request(roleless, w.org.id)).rejects.toBeInstanceOf(Forbidden);
    // A token without the scope cannot ask, whatever its owner holds.
    const person = await w.person();
    const token = { ...person, via: 'token' as const, scopes: ['core.identity.me.read'] };
    await expect(w.memberships.request(token, w.org.id)).rejects.toBeInstanceOf(Forbidden);
    expect((await w.pool.query('select 1 from org_membership')).rows).toEqual([]);
  });

  it('rolls back when the mail cannot be stored: no row, no event, no mail', async () => {
    const w = await startWorld(h);
    await w.manager();
    const person = await w.person();
    const undo = await breakDeliveries(w.pool);
    await expect(w.memberships.request(person, w.org.id)).rejects.toThrow();
    await undo();
    expect(await w.rowOf(person)).toBeUndefined();
    expect(await w.eventsNamed('registry.membership.requested@1')).toEqual([]);
    expect(await w.deliveries()).toEqual([]);
    expect(await w.inbox()).toEqual([]);
  });

  it('rolls back when the event cannot be stored: no row, no mail', async () => {
    const w = await startWorld(h);
    await w.manager();
    const person = await w.person();
    const undo = await breakOutbox(w.pool);
    await expect(w.memberships.request(person, w.org.id)).rejects.toThrow();
    await undo();
    expect(await w.rowOf(person)).toBeUndefined();
    expect(await w.deliveries()).toEqual([]);
  });
});

describe('leave', () => {
  it('withdraws a request: requested becomes left, the event says by member, and nobody is mailed', async () => {
    const w = await startWorld(h);
    const { who, row } = await w.requester();
    const result = await w.memberships.leave(who, w.org.id);
    expect(result).toMatchObject({ id: row.id, state: 'left' });
    expect(await w.rowOf(who)).toMatchObject({ state: 'left', ended_by: who.userId });
    expect(await w.eventsNamed('registry.membership.left@1')).toEqual([
      {
        membershipId: row.id,
        organisationId: w.org.id,
        userId: who.userId,
        by: 'member',
        actorId: who.userId,
        organisationHasManager: false,
      },
    ]);
    expect(await w.deliveries()).toEqual([]);
  });

  it('ends a membership; a manager who leaves loses the role, and the event says whether a manager is left', async () => {
    const w = await startWorld(h);
    await w.manager();
    const leaving = await w.manager();
    const result = await w.memberships.leave(leaving, w.org.id);
    expect(result).toMatchObject({ state: 'left', role: 'member' });
    expect(await w.rowOf(leaving)).toMatchObject({ state: 'left', role: 'member' });
    const [event] = await w.eventsNamed('registry.membership.left@1');
    expect(event).toMatchObject({ by: 'member', organisationHasManager: true });
    // A plain member leaves too.
    const member = await w.member();
    await w.memberships.leave(member, w.org.id);
    expect((await w.rowOf(member))!.state).toBe('left');
  });

  it('answers 404 when there is nothing to end: no row, a rejected or a left one, and for the row of somebody else', async () => {
    const w = await startWorld(h);
    const nobody = await w.person();
    await expect(w.memberships.leave(nobody, w.org.id)).rejects.toBeInstanceOf(NotFound);
    for (const state of ['rejected', 'left'] as const) {
      const who = await w.person();
      await w.join(who, { state });
      await expect(w.memberships.leave(who, w.org.id)).rejects.toBeInstanceOf(NotFound);
    }
    // The route names an organisation, never a membership: another person's row cannot be reached.
    const member = await w.member();
    await expect(w.memberships.leave(nobody, w.org.id)).rejects.toBeInstanceOf(NotFound);
    expect((await w.rowOf(member))!.state).toBe('approved');
    await expect(w.memberships.leave(anonymous, w.org.id)).rejects.toBeInstanceOf(Unauthorized);
    await expect(w.memberships.leave(nobody, 'nope')).rejects.toBeInstanceOf(Invalid);
  });

  it('rolls back when the event cannot be stored: the membership stays approved', async () => {
    const w = await startWorld(h);
    const member = await w.member();
    const undo = await breakOutbox(w.pool);
    await expect(w.memberships.leave(member, w.org.id)).rejects.toThrow();
    await undo();
    expect(await w.rowOf(member)).toMatchObject({ state: 'approved', ended_at: null });
  });
});

describe('listOwn', () => {
  it('lists the caller’s own rows in every state, by abbreviation, with the organisation and the role', async () => {
    const w = await startWorld(h);
    const person = await w.person();
    await w.join(person, { organisationId: w.org.id, role: 'manager' });
    await w.join(person, { organisationId: w.other.id, state: 'rejected' });
    await w.member(); // somebody else's row is not listed
    const { items, total } = await w.memberships.listOwn(person, { page: 0, pageSize: 10 });
    expect(total).toBe(2);
    expect(items.map((i) => [i.organisation.abbreviation, i.state, i.role])).toEqual([
      ['DKFZ', 'rejected', 'member'],
      ['IPK', 'approved', 'manager'],
    ]);
    const page = await w.memberships.listOwn(person, { page: 1, pageSize: 1 });
    expect(page.items.map((i) => i.organisation.abbreviation)).toEqual(['IPK']);
    await expect(
      w.memberships.listOwn(anonymous, { page: 0, pageSize: 10 }),
    ).rejects.toBeInstanceOf(Unauthorized);
    await expect(
      w.memberships.listOwn(await w.actor(), { page: 0, pageSize: 10 }),
    ).rejects.toBeInstanceOf(Forbidden);
  });
});
