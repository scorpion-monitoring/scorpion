// Deciding, changing roles and removing, over real Postgres and the real authoriser: who may, who may
// not, what each change writes (row, event, mail, inbox item) and what a failure leaves behind. The
// concurrency cases are in memberships.concurrency.test.ts; the self cases of defect 1 are also in
// apps/server/src/defect-01.membership.test.ts.
import { Forbidden, NotFound, Unauthorized, type Actor, type UserActor } from '@scorpion/contracts';
import { makeOrganisation, makeRole, makeRoleAssignment } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { breakDeliveries, breakInbox, breakOutbox, useOrganisations } from '../test/harness.ts';
import { startWorld } from '../test/world.ts';

const h = useOrganisations();
const anonymous: Actor = { kind: 'anonymous' };
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';
const asToken = (actor: UserActor, scopes: string[]): UserActor => ({
  ...actor,
  via: 'token',
  scopes,
});

const DECIDE = 'registry.organisations.membership.decide';
const ROLES = 'registry.organisations.membership.manage-roles';
const REMOVE = 'registry.organisations.membership.remove';
const READ = 'registry.organisations.organisation.read';

describe('decide', () => {
  it('lets an Admin approve: the row, one event with ids only, and the requester’s mail and inbox item in English', async () => {
    const w = await startWorld(h);
    const { who, row } = await w.requester();
    const result = await w.memberships.decide(w.admin, row.id, 'approved');
    expect(result).toMatchObject({ id: row.id, state: 'approved', role: 'member' });
    expect(await w.rowOf(who)).toMatchObject({ state: 'approved', decided_by: w.admin.userId });
    expect(await w.eventsNamed('registry.membership.decided@1')).toEqual([
      {
        membershipId: row.id,
        organisationId: w.org.id,
        userId: who.userId,
        state: 'approved',
        by: 'admin',
        actorId: w.admin.userId,
      },
    ]);
    // Approving mails the requester, read from the queue.
    const [mail] = await w.deliveries();
    expect(mail).toMatchObject({
      template: 'registry.membership-decided',
      recipient_address: await w.emailOf(who),
      recipient_user_id: who.userId,
      locale: 'en',
      subject: 'Your membership of Leibniz IPK was approved',
    });
    expect(mail!.text_body).toContain(`/organisations/${w.org.id}`);
    // Never the decider's address or username.
    expect(mail!.text_body).not.toContain(await w.emailOf(w.admin));
    expect(mail!.text_body).not.toContain(w.admin.username);
    const [item] = await w.inbox();
    expect(item).toMatchObject({
      user_id: who.userId,
      template: 'registry.membership-decided',
      title: 'You are a member of Leibniz IPK',
    });
    expect(item!.link).toContain(`/organisations/${w.org.id}`);
  });

  it('lets a manager of the organisation approve, with by: manager, and writes the mail in the requester’s German', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    const { who, row } = await w.requester();
    await w.setLocale(who, 'de');
    const result = await w.memberships.decide(manager, row.id, 'approved');
    expect(result.state).toBe('approved');
    const [event] = await w.eventsNamed('registry.membership.decided@1');
    expect(event).toMatchObject({ by: 'manager', actorId: manager.userId });
    const [mail] = await w.deliveries();
    expect(mail).toMatchObject({
      locale: 'de',
      subject: 'Ihre Mitgliedschaft bei Leibniz IPK wurde bestätigt',
    });
    expect((await w.inbox())[0]!.title).toBe('Sie sind Mitglied von Leibniz IPK');
  });

  it('rejects: the state, the event, a mail without a link, and the person can ask again', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    const { who, row } = await w.requester();
    const result = await w.memberships.decide(manager, row.id, 'rejected');
    expect(result.state).toBe('rejected');
    expect(await w.rowOf(who)).toMatchObject({ state: 'rejected', decided_by: manager.userId });
    const [event] = await w.eventsNamed('registry.membership.decided@1');
    expect(event).toMatchObject({ state: 'rejected', by: 'manager' });
    const [mail] = await w.deliveries();
    expect(mail!.subject).toBe('Your membership request for Leibniz IPK was not approved');
    expect(mail!.text_body).not.toContain('/organisations/');
    expect((await w.memberships.request(who, w.org.id)).created).toBe(true);
  });

  it('refuses everybody’s own request, an Admin and a manager included, and lets a second Admin decide it [ASVS-8.2.1]', async () => {
    const w = await startWorld(h);
    // An Admin asks.
    const own = await w.memberships.request(w.admin, w.org.id);
    await expect(
      w.memberships.decide(w.admin, own.membership.id, 'approved'),
    ).rejects.toBeInstanceOf(Forbidden);
    expect((await w.rowOf(w.admin))!.state).toBe('requested');
    // A manager of another organisation asks here: they cannot approve it for themselves, as a manager
    // of the organisation they ask to join does not exist yet.
    const elsewhere = await w.manager(w.other.id);
    const asked = await w.memberships.request(elsewhere, w.org.id);
    await expect(
      w.memberships.decide(elsewhere, asked.membership.id, 'approved'),
    ).rejects.toBeInstanceOf(Forbidden);
    // A manager of this organisation who has also asked for another one cannot decide that one either.
    const manager = await w.manager();
    const theirs = await w.memberships.request(manager, w.other.id);
    await expect(
      w.memberships.decide(manager, theirs.membership.id, 'approved'),
    ).rejects.toBeInstanceOf(Forbidden);
    // A second Admin can.
    const second = await w.actor('admin');
    expect((await w.memberships.decide(second, own.membership.id, 'approved')).state).toBe(
      'approved',
    );
  });

  it('keeps a manager of one organisation out of another: 403, and nothing changes [ASVS-8.2.2]', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    const { who, row } = await w.requester(w.other.id);
    await expect(w.memberships.decide(manager, row.id, 'approved')).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(w.memberships.decide(manager, row.id, 'rejected')).rejects.toBeInstanceOf(
      Forbidden,
    );
    expect(await w.rowOf(who, w.other.id)).toMatchObject({ state: 'requested', decided_by: null });
    expect(await w.eventsNamed('registry.membership.decided@1')).toEqual([]);
    expect(await w.deliveries()).toEqual([]);
  });

  it('turns away a plain member, a plain person and anybody who may act nowhere, before it looks the id up [ASVS-8.2.1] [ASVS-8.3.1]', async () => {
    const w = await startWorld(h);
    const { row } = await w.requester();
    const member = await w.member();
    const plain = await w.person();
    for (const caller of [member, plain]) {
      await expect(w.memberships.decide(caller, row.id, 'approved')).rejects.toBeInstanceOf(
        Forbidden,
      );
      // An id that exists nowhere answers the same: no difference to learn.
      await expect(w.memberships.decide(caller, ABSENT, 'approved')).rejects.toBeInstanceOf(
        Forbidden,
      );
    }
    // A person who holds nothing at all, and an anonymous caller.
    await expect(w.memberships.decide(await w.actor(), row.id, 'approved')).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(w.memberships.decide(anonymous, row.id, 'approved')).rejects.toBeInstanceOf(
      Unauthorized,
    );
    // Those who may act somewhere get a 404 for an unknown id.
    await expect(w.memberships.decide(w.admin, ABSENT, 'approved')).rejects.toBeInstanceOf(
      NotFound,
    );
    await expect(
      w.memberships.decide(await w.manager(), ABSENT, 'approved'),
    ).rejects.toBeInstanceOf(NotFound);
    expect(
      (await w.pool.query("select 1 from org_membership where state = 'requested'")).rows,
    ).toHaveLength(1);
  });

  it('answers 409 membership-state when the row is no longer a request', async () => {
    const w = await startWorld(h);
    const { row } = await w.requester();
    await w.memberships.decide(w.admin, row.id, 'approved');
    await expect(w.memberships.decide(w.admin, row.id, 'rejected')).rejects.toMatchObject({
      status: 409,
      type: 'membership-state',
    });
    await expect(w.memberships.decide(w.admin, row.id, 'approved')).rejects.toMatchObject({
      status: 409,
    });
    expect(await w.eventsNamed('registry.membership.decided@1')).toHaveLength(1);
  });

  it('limits a token to its scopes: without the scope neither Admin nor manager decides, with it a manager does [ASVS-8.2.1]', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    const { row } = await w.requester();
    for (const owner of [w.admin, manager]) {
      await expect(
        w.memberships.decide(asToken(owner, [READ]), row.id, 'approved'),
      ).rejects.toBeInstanceOf(Forbidden);
    }
    expect(
      (await w.memberships.decide(asToken(manager, [READ, DECIDE]), row.id, 'approved')).state,
    ).toBe('approved');
    // A plain person's token that names the scope gets nothing the person lacks.
    const { row: next } = await w.requester();
    await expect(
      w.memberships.decide(asToken(await w.person(), [READ, DECIDE]), next.id, 'approved'),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it('rolls back when the mail cannot be stored, when the inbox item cannot, and when the event cannot: the request stays a request', async () => {
    const w = await startWorld(h);
    const { who, row } = await w.requester();
    for (const [name, breakIt] of [
      ['mail', breakDeliveries],
      ['inbox', breakInbox],
      ['event', breakOutbox],
    ] as const) {
      const undo = await breakIt(w.pool);
      await expect(w.memberships.decide(w.admin, row.id, 'approved'), name).rejects.toThrow();
      await undo();
      expect(await w.rowOf(who), name).toMatchObject({ state: 'requested', decided_at: null });
    }
    expect(await w.eventsNamed('registry.membership.decided@1')).toEqual([]);
    expect(await w.deliveries()).toEqual([]);
    // After the faults the same decision works.
    expect((await w.memberships.decide(w.admin, row.id, 'approved')).state).toBe('approved');
  });
});

describe('setRole', () => {
  it('lets an Admin promote and demote, writes the event, tells the person in their inbox and mails nobody [ASVS-8.2.1]', async () => {
    const w = await startWorld(h);
    const member = await w.member();
    const row = (await w.rowOf(member))!;
    const promoted = await w.memberships.setRole(w.admin, row.id, 'manager');
    expect(promoted).toMatchObject({ role: 'manager', state: 'approved' });
    expect(await w.rowOf(member)).toMatchObject({
      role: 'manager',
      role_changed_by: w.admin.userId,
    });
    expect(await w.eventsNamed('registry.membership.roleChanged@1')).toEqual([
      {
        membershipId: row.id,
        organisationId: w.org.id,
        userId: member.userId,
        from: 'member',
        to: 'manager',
        by: 'admin',
        actorId: w.admin.userId,
        organisationHasManager: true,
      },
    ]);
    expect(await w.deliveries()).toEqual([]); // an inbox item only
    expect(await w.inbox()).toEqual([
      expect.objectContaining({
        user_id: member.userId,
        template: 'registry.membership-role-changed',
        title: 'You are a manager of Leibniz IPK',
      }),
    ]);
    // Demoting: the role goes back, the person keeps the membership.
    const demoted = await w.memberships.setRole(w.admin, row.id, 'member');
    expect(demoted).toMatchObject({ role: 'member', state: 'approved' });
    expect((await w.inbox())[1]!.title).toBe('Your role in Leibniz IPK changed');
  });

  it('lets a manager promote a member and demote another manager (Decision 18), by manager', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    const peer = await w.manager();
    const member = await w.member();
    await w.memberships.setRole(manager, (await w.rowOf(member))!.id, 'manager');
    await w.memberships.setRole(manager, (await w.rowOf(peer))!.id, 'member');
    const events = await w.eventsNamed('registry.membership.roleChanged@1');
    expect(events.map((e) => [e.from, e.to, e.by])).toEqual([
      ['member', 'manager', 'manager'],
      ['manager', 'member', 'manager'],
    ]);
  });

  it('is idempotent for the role the row already has: 200, no event, no inbox item', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    const member = await w.member();
    const memberRow = (await w.rowOf(member))!;
    expect((await w.memberships.setRole(w.admin, memberRow.id, 'member')).role).toBe('member');
    expect(
      (await w.memberships.setRole(w.admin, (await w.rowOf(manager))!.id, 'manager')).role,
    ).toBe('manager');
    expect(await w.eventsNamed('registry.membership.roleChanged@1')).toEqual([]);
    expect(await w.inbox()).toEqual([]);
  });

  it('refuses everybody to change their own role, a manager and an Admin who is a member included [ASVS-8.2.1]', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    const own = (await w.rowOf(manager))!;
    await expect(w.memberships.setRole(manager, own.id, 'member')).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(w.memberships.setRole(manager, own.id, 'manager')).rejects.toBeInstanceOf(
      Forbidden,
    );
    expect((await w.rowOf(manager))!.role).toBe('manager');
    // An Admin who is a member cannot make themselves manager; another Admin can.
    const admin = await w.actor('admin');
    const row = await w.join(admin);
    await expect(w.memberships.setRole(admin, row.id, 'manager')).rejects.toBeInstanceOf(Forbidden);
    expect((await w.rowOf(admin))!.role).toBe('member');
    expect((await w.memberships.setRole(w.admin, row.id, 'manager')).role).toBe('manager');
    expect(await w.eventsNamed('registry.membership.roleChanged@1')).toHaveLength(1);
  });

  it('refuses a person who is not an approved member with 409 membership-state', async () => {
    const w = await startWorld(h);
    for (const state of ['requested', 'rejected', 'left'] as const) {
      const who = await w.person();
      const row = await w.join(who, { state });
      for (const role of ['manager', 'member'] as const) {
        await expect(
          w.memberships.setRole(w.admin, row.id, role),
          `${state} ${role}`,
        ).rejects.toMatchObject({
          status: 409,
          type: 'membership-state',
        });
      }
    }
  });

  it('stops a promotion over membership.maxManagersPerOrganisation with 409 too-many-managers', async () => {
    const w = await startWorld(h);
    await w.configure({ membership: { maxManagersPerOrganisation: 2 } });
    await w.manager();
    await w.manager();
    const member = await w.member();
    await expect(
      w.memberships.setRole(w.admin, (await w.rowOf(member))!.id, 'manager'),
    ).rejects.toMatchObject({ status: 409, type: 'too-many-managers' });
    expect((await w.rowOf(member))!.role).toBe('member');
    // Another organisation has its own count.
    const elsewhere = await w.member(w.other.id);
    expect(
      (await w.memberships.setRole(w.admin, (await w.rowOf(elsewhere, w.other.id))!.id, 'manager'))
        .role,
    ).toBe('manager');
  });

  it('keeps a plain member, a person of another organisation and a plain person out [ASVS-8.2.1] [ASVS-8.2.2]', async () => {
    const w = await startWorld(h);
    const member = await w.member();
    const target = await w.member();
    const row = (await w.rowOf(target))!;
    const elsewhere = await w.manager(w.other.id);
    for (const caller of [member, elsewhere, await w.person()]) {
      await expect(w.memberships.setRole(caller, row.id, 'manager')).rejects.toBeInstanceOf(
        Forbidden,
      );
    }
    await expect(w.memberships.setRole(anonymous, row.id, 'manager')).rejects.toBeInstanceOf(
      Unauthorized,
    );
    await expect(w.memberships.setRole(w.admin, ABSENT, 'manager')).rejects.toBeInstanceOf(
      NotFound,
    );
    expect((await w.rowOf(target))!.role).toBe('member');
    // A token without the scope cannot, with a manager as owner either.
    const manager = await w.manager();
    await expect(
      w.memberships.setRole(asToken(manager, [READ, DECIDE]), row.id, 'manager'),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(
      (await w.memberships.setRole(asToken(manager, [READ, ROLES]), row.id, 'manager')).role,
    ).toBe('manager');
  });

  it('rolls back a role change when the event or the inbox item cannot be stored: the role is unchanged', async () => {
    const w = await startWorld(h);
    const member = await w.member();
    const row = (await w.rowOf(member))!;
    for (const [name, breakIt] of [
      ['event', breakOutbox],
      ['inbox', breakInbox],
    ] as const) {
      const undo = await breakIt(w.pool);
      await expect(w.memberships.setRole(w.admin, row.id, 'manager'), name).rejects.toThrow();
      await undo();
      expect(await w.rowOf(member), name).toMatchObject({ role: 'member', role_changed_at: null });
    }
    expect(await w.eventsNamed('registry.membership.roleChanged@1')).toEqual([]);
  });
});

describe('a custom role that holds one of the permissions globally', () => {
  it('lets its holder do that action on any organisation, and only that one, with no membership at all', async () => {
    const w = await startWorld(h);
    const role = await makeRole(w.pool, { permissions: [READ, ROLES] });
    const who = await w.actor();
    await makeRoleAssignment(w.pool, { id: who.userId }, role);
    const member = await w.member();
    const row = (await w.rowOf(member))!;
    expect((await w.memberships.setRole(who, row.id, 'manager')).role).toBe('manager');
    await expect(w.memberships.remove(who, row.id)).rejects.toBeInstanceOf(Forbidden);
    const { row: request } = await w.requester();
    await expect(w.memberships.decide(who, request.id, 'approved')).rejects.toBeInstanceOf(
      Forbidden,
    );
  });
});

describe('remove', () => {
  it('lets an Admin remove a member and a manager: state left, role member, by admin, no mail to the person', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    await w.manager();
    const member = await w.member();
    await w.memberships.remove(w.admin, (await w.rowOf(member))!.id);
    const result = await w.memberships.remove(w.admin, (await w.rowOf(manager))!.id);
    expect(result).toMatchObject({ state: 'left', role: 'member' });
    expect(await w.rowOf(manager)).toMatchObject({
      state: 'left',
      role: 'member',
      ended_by: w.admin.userId,
    });
    const events = await w.eventsNamed('registry.membership.left@1');
    expect(events).toEqual([
      expect.objectContaining({
        userId: member.userId,
        by: 'admin',
        actorId: w.admin.userId,
        organisationHasManager: true,
      }),
      expect.objectContaining({
        userId: manager.userId,
        by: 'admin',
        organisationHasManager: true,
      }),
    ]);
    // Nobody is told, the removed least of all (backlog).
    expect(await w.deliveries()).toEqual([]);
    expect(await w.inbox()).toEqual([]);
  });

  it('lets a manager remove a plain member of their organisation: the event says by manager and names the actor [ASVS-8.2.1]', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    const member = await w.member();
    const result = await w.memberships.remove(manager, (await w.rowOf(member))!.id);
    expect(result.state).toBe('left');
    const [event] = await w.eventsNamed('registry.membership.left@1');
    expect(event).toMatchObject({ by: 'manager', actorId: manager.userId, userId: member.userId });
    expect(await w.rowOf(member)).toMatchObject({ ended_by: manager.userId });
    // The person can ask again.
    expect((await w.memberships.request(member, w.org.id)).created).toBe(true);
  });

  it('never lets a manager remove another manager (403, Only an administrator…), nor themselves, an Admin who is a member included [ASVS-8.2.1]', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    const peer = await w.manager();
    await expect(w.memberships.remove(manager, (await w.rowOf(peer))!.id)).rejects.toMatchObject({
      status: 403,
      message: 'Only an administrator can remove a manager.',
    });
    await expect(w.memberships.remove(manager, (await w.rowOf(manager))!.id)).rejects.toMatchObject(
      {
        status: 403,
        message: 'Use leave to end your own membership.',
      },
    );
    const admin = await w.actor('admin');
    const row = await w.join(admin);
    await expect(w.memberships.remove(admin, row.id)).rejects.toMatchObject({
      status: 403,
      message: 'Use leave to end your own membership.',
    });
    for (const who of [manager, peer, admin]) {
      expect((await w.rowOf(who))!.state).toBe('approved');
    }
    expect(await w.eventsNamed('registry.membership.left@1')).toEqual([]);
  });

  it('keeps a manager of another organisation, a plain member and a plain person out [ASVS-8.2.1] [ASVS-8.2.2]', async () => {
    const w = await startWorld(h);
    const target = await w.member();
    const row = (await w.rowOf(target))!;
    const elsewhere = await w.manager(w.other.id);
    const member = await w.member();
    for (const caller of [elsewhere, member, await w.person()]) {
      await expect(w.memberships.remove(caller, row.id)).rejects.toBeInstanceOf(Forbidden);
    }
    await expect(w.memberships.remove(anonymous, row.id)).rejects.toBeInstanceOf(Unauthorized);
    await expect(w.memberships.remove(w.admin, ABSENT)).rejects.toBeInstanceOf(NotFound);
    expect((await w.rowOf(target))!.state).toBe('approved');
    // A token needs the scope for this action.
    const manager = await w.manager();
    await expect(
      w.memberships.remove(asToken(manager, [READ, DECIDE]), row.id),
    ).rejects.toBeInstanceOf(Forbidden);
    expect((await w.memberships.remove(asToken(manager, [READ, REMOVE]), row.id)).state).toBe(
      'left',
    );
  });

  it('refuses a request, a rejected row and a left row with 409 membership-state: a request is decided or withdrawn, never removed', async () => {
    const w = await startWorld(h);
    for (const state of ['requested', 'rejected', 'left'] as const) {
      const who = await w.person();
      const row = await w.join(who, { state });
      for (const caller of [w.admin, await w.manager()]) {
        await expect(w.memberships.remove(caller, row.id), state).rejects.toMatchObject({
          status: 409,
          type: 'membership-state',
        });
      }
      expect((await w.rowOf(who))!.state).toBe(state);
    }
  });

  it('rolls back when the event cannot be stored: the membership stays approved', async () => {
    const w = await startWorld(h);
    const member = await w.member();
    const undo = await breakOutbox(w.pool);
    await expect(w.memberships.remove(w.admin, (await w.rowOf(member))!.id)).rejects.toThrow();
    await undo();
    expect(await w.rowOf(member)).toMatchObject({
      state: 'approved',
      ended_at: null,
      ended_by: null,
    });
  });
});

describe('the last manager', () => {
  const inboxOf = async (w: Awaited<ReturnType<typeof startWorld>>) =>
    (await w.inbox()).filter((item) => item.template === 'registry.organisation-without-manager');

  it('may leave: nothing blocks it, the event says no manager is left, and the administrators get an inbox item and no mail', async () => {
    const w = await startWorld(h);
    const lone = await w.manager();
    const second = await w.actor('admin');
    await w.memberships.leave(lone, w.org.id);
    const [event] = await w.eventsNamed('registry.membership.left@1');
    expect(event).toMatchObject({ organisationHasManager: false });
    const items = await inboxOf(w);
    expect(items.map((i) => i.user_id).sort()).toEqual([w.admin.userId, second.userId].sort());
    expect(items[0]!.title).toBe('Leibniz IPK has no manager');
    expect(await w.deliveries()).toEqual([]);
  });

  it('may be demoted by an Admin or by another manager, and not by themselves', async () => {
    const w = await startWorld(h);
    const lone = await w.manager();
    const row = (await w.rowOf(lone))!;
    await expect(w.memberships.setRole(lone, row.id, 'member')).rejects.toBeInstanceOf(Forbidden);
    await w.memberships.setRole(w.admin, row.id, 'member');
    const [event] = await w.eventsNamed('registry.membership.roleChanged@1');
    expect(event).toMatchObject({ from: 'manager', to: 'member', organisationHasManager: false });
    expect(await inboxOf(w)).toHaveLength(1); // the world's one administrator
    // With a second manager the demotion leaves one, and says nothing about "no manager".
    const w2 = await startWorld(h);
    const a = await w2.manager();
    const b = await w2.manager();
    await w2.memberships.setRole(a, (await w2.rowOf(b))!.id, 'member');
    expect((await w2.eventsNamed('registry.membership.roleChanged@1'))[0]).toMatchObject({
      organisationHasManager: true,
    });
    expect(await inboxOf(w2)).toEqual([]);
  });

  it('may be removed by an Admin; the organisation then falls back to the administrators, who still hear of a new request', async () => {
    const w = await startWorld(h);
    const lone = await w.manager();
    await w.memberships.remove(w.admin, (await w.rowOf(lone))!.id);
    expect((await w.eventsNamed('registry.membership.left@1'))[0]).toMatchObject({
      organisationHasManager: false,
    });
    expect(await inboxOf(w)).toHaveLength(1);
    const person = await w.person();
    await w.memberships.request(person, w.org.id);
    const mails = await w.deliveries();
    expect(mails.map((m) => m.recipient_address)).toEqual([await w.emailOf(w.admin)]);
    // The administrators decide, so the organisation is never stuck.
    const row = (await w.rowOf(person))!;
    expect((await w.memberships.decide(w.admin, row.id, 'approved')).state).toBe('approved');
  });

  it('does not announce "no manager" when a plain member leaves or is removed', async () => {
    const w = await startWorld(h);
    const member = await w.member();
    await w.memberships.leave(member, w.org.id);
    const other = await w.member();
    await w.memberships.remove(w.admin, (await w.rowOf(other))!.id);
    expect(await inboxOf(w)).toEqual([]);
  });
});

describe('an organisation that is deleted', () => {
  it('takes its memberships with it in one transaction, and a failure keeps them', async () => {
    const w = await startWorld(h);
    const member = await w.member();
    await w.manager();
    const lone = await makeOrganisation(w.pool);
    const undo = await breakOutbox(w.pool);
    await expect(w.organisations.delete(w.admin, w.org.id)).rejects.toThrow();
    await undo();
    expect(
      (await w.pool.query('select 1 from org_membership where organisation_id = $1', [w.org.id]))
        .rows,
    ).toHaveLength(2);
    await w.organisations.delete(w.admin, w.org.id);
    expect(
      (await w.pool.query('select 1 from org_membership where organisation_id = $1', [w.org.id]))
        .rows,
    ).toEqual([]);
    expect(await w.rowOf(member)).toBeUndefined();
    expect((await w.organisations.get(w.admin, lone.id)).id).toBe(lone.id);
  });
});
