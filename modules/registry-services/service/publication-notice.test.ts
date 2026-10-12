// The notice to the provider when a Reviewer or an administrator makes a service public or private again:
// the managers of the provider and the creator get an inbox item (and a mail where there is an address), never the
// person who decided, recipients are read at the moment of sending, the language is the recipient's, no address of
// anybody else is in a mail, and a failure leaves no publication behind.
import {
  breakDeliveries,
  breakInbox,
  deliveryRows,
  inboxRows,
  makeMembership,
  makePreference,
  makeRoleAssignment,
  makeUser,
} from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useServices } from '../test/harness.ts';
import { world } from '../test/world.ts';

const h = useServices();

describe('the publication notice', () => {
  it('goes to the managers of the provider and the creator, never to the person who decided, and never to a member', async () => {
    const w = await world(h);
    const creator = await makeUser(w.pool);
    await w.pool.query('update svc_service set created_by = $2 where id = $1', [
      w.svc.id,
      creator.id,
    ]);
    await w.services.setPublication(w.people.reviewer, w.svc.id, { public: true });
    const inbox = await inboxRows(w.pool);
    expect(inbox.map((i) => i.user_id).sort()).toEqual(
      [w.people.manager.userId, creator.id].sort(),
    );
    expect(inbox.every((i) => i.template === 'registry.service-publication')).toBe(true);
    expect(inbox.map((i) => i.user_id)).not.toContain(w.people.reviewer.userId);
    expect(inbox.map((i) => i.user_id)).not.toContain(w.people.member.userId);
    expect(inbox[0]!.title).toContain(w.svc.name);
  });

  it('is not sent to the actor even when the actor is a manager of the provider and creator of the service', async () => {
    const w = await world(h);
    await makeRoleAssignment(w.pool, { id: w.people.manager.userId }, 'reviewer');
    await w.pool.query('update svc_service set created_by = $2 where id = $1', [
      w.svc.id,
      w.people.manager.userId,
    ]);
    await w.services.setPublication(w.people.manager, w.svc.id, { public: true });
    expect(await inboxRows(w.pool)).toEqual([]);
  });

  it('says "no longer public" on an unpublication, once for each change and not at all for a no-op', async () => {
    const w = await world(h);
    await w.services.setPublication(w.people.admin, w.svc.id, { public: true });
    await w.services.setPublication(w.people.admin, w.svc.id, { public: true }); // no-op
    await w.services.setPublication(w.people.admin, w.svc.id, { public: false });
    const inbox = await inboxRows(w.pool);
    expect(inbox).toHaveLength(2);
    expect(inbox[0]!.title).toMatch(/now public/);
    expect(inbox[1]!.title).toMatch(/no longer public/);
  });

  it('writes a mail with the recipient’s own address only, naming no other person, and an inbox item without an address', async () => {
    const w = await world(h);
    const noAddress = await makeUser(w.pool, { email: null });
    await makeMembership(w.pool, {
      organisationId: w.provider.id,
      userId: noAddress.id,
      role: 'manager',
    });
    await w.services.setPublication(w.people.reviewer, w.svc.id, { public: true });
    const mails = await deliveryRows(w.pool);
    const managerEmail = (
      await w.pool.query<{ email: string }>('select email from identity_user where id = $1', [
        w.people.manager.userId,
      ])
    ).rows[0]!.email;
    expect(mails.map((m) => m.recipient_address)).toEqual([managerEmail]);
    const reviewerEmail = (
      await w.pool.query<{ email: string }>('select email from identity_user where id = $1', [
        w.people.reviewer.userId,
      ])
    ).rows[0]!.email;
    for (const mail of mails) {
      expect(mail.subject).toBe(`Your service ${w.svc.name} is now public`);
      expect(mail.text_body).not.toContain(reviewerEmail);
      expect(mail.text_body).toContain(`/services/${w.svc.id}`);
    }
    expect((await inboxRows(w.pool)).map((i) => i.user_id)).toContain(noAddress.id);
  });

  it('is written in the language of each recipient', async () => {
    const w = await world(h);
    await makePreference(w.pool, { id: w.people.manager.userId }, 'notifications.locale', 'de');
    await w.services.setPublication(w.people.reviewer, w.svc.id, { public: true });
    const [mail] = await deliveryRows(w.pool);
    expect(mail!.locale).toBe('de');
    expect(mail!.subject).toBe(`Ihr Dienst ${w.svc.name} ist jetzt öffentlich`);
  });

  it('reads the recipients at the moment of sending: a demoted manager gets nothing, a new one does', async () => {
    const w = await world(h);
    const fresh = await w.actor('user');
    await makeMembership(w.pool, {
      organisationId: w.provider.id,
      userId: fresh.userId,
      role: 'manager',
    });
    await w.pool.query("update org_membership set role = 'member' where user_id = $1", [
      w.people.manager.userId,
    ]);
    await w.services.setPublication(w.people.reviewer, w.svc.id, { public: true });
    expect((await inboxRows(w.pool)).map((i) => i.user_id)).toEqual([fresh.userId]);
  });

  it('skips an account that is deactivated or deleted', async () => {
    const w = await world(h);
    await w.pool.query("update identity_user set status = 'deactivated' where id = $1", [
      w.people.manager.userId,
    ]);
    await w.services.setPublication(w.people.reviewer, w.svc.id, { public: true });
    expect(await inboxRows(w.pool)).toEqual([]);
  });

  it.each([
    ['the mail queue', breakDeliveries],
    ['the inbox', breakInbox],
  ])(
    'leaves the service private, with no event and no notice, when %s cannot be written',
    async (_n, breakIt) => {
      const w = await world(h);
      const restore = await breakIt(w.pool);
      await expect(
        w.services.setPublication(w.people.reviewer, w.svc.id, { public: true }),
      ).rejects.toThrow();
      await restore();
      expect((await w.row()).public).toBe(false);
      expect(await w.events()).toEqual([]);
      expect(await inboxRows(w.pool)).toEqual([]);
      expect(await deliveryRows(w.pool)).toEqual([]);
    },
  );
});
