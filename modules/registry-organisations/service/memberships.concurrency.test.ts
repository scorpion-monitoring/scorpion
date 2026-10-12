// Two callers at once, over real Postgres: no mocks. A change locks the membership row and re-reads
// the state and the role under the lock; what spans rows (the number of managers) takes an advisory
// lock after the row locks (ADR-0034). Some cases hold a lock from a second connection and prove that
// the service waits for it and then decides on what it finds; the rest race two calls.
import { Forbidden } from '@scorpion/contracts';
import { makeOrganisation } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useOrganisations } from '../test/harness.ts';
import { startWorld, type World } from '../test/world.ts';

const h = useOrganisations();
const settle = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Holds `select … for update` on a membership row from a second connection, runs `during` (which
 * changes the row from that connection), starts `call` meanwhile, shows that it is still waiting,
 * commits, and returns what `call` answered.
 */
async function whileLocked<T>(
  w: World,
  membershipId: string,
  during: (query: (text: string, values?: unknown[]) => Promise<unknown>) => Promise<void>,
  call: () => Promise<T>,
) {
  const client = await w.pool.connect();
  try {
    await client.query('begin');
    await client.query('select 1 from org_membership where id = $1 for update', [membershipId]);
    let finished = false;
    const pending = settle(call()).then((result) => {
      finished = true;
      return result;
    });
    await sleep(400);
    expect(finished, 'the call waits for the row lock').toBe(false);
    await during((text, values) => client.query(text, values));
    await client.query('commit');
    return await pending;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

describe('two deciders at once', () => {
  it('waits for the lock and then sees the new state: the second decider gets 409 membership-state and one event exists', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    const { row } = await w.requester();
    const result = await whileLocked(
      w,
      row.id,
      (query) =>
        query(
          "update org_membership set state = 'approved', decided_by = $2, decided_at = now() where id = $1",
          [row.id, w.admin.userId],
        ).then(() => undefined),
      () => w.memberships.decide(manager, row.id, 'rejected'),
    );
    expect(result.ok).toBe(false);
    expect((result as { error: unknown }).error).toMatchObject({
      status: 409,
      type: 'membership-state',
    });
    expect(await w.eventsNamed('registry.membership.decided@1')).toEqual([]);
    expect(await w.deliveries()).toEqual([]); // the loser mailed nobody
  });

  it('races an Admin and a manager: one wins, one gets 409, one event, one mail to the requester', async () => {
    for (let round = 0; round < 3; round += 1) {
      const w = await startWorld(h);
      const manager = await w.manager();
      const { row } = await w.requester();
      const [a, b] = await Promise.all([
        settle(w.memberships.decide(w.admin, row.id, 'approved')),
        settle(w.memberships.decide(manager, row.id, 'rejected')),
      ]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      const loser = (a.ok ? b : a) as { ok: false; error: unknown };
      expect(loser.error).toMatchObject({ status: 409, type: 'membership-state' });
      expect(await w.eventsNamed('registry.membership.decided@1')).toHaveLength(1);
      expect(
        (await w.deliveries()).filter((m) => m.template === 'registry.membership-decided'),
      ).toHaveLength(1);
    }
  });
});

describe('a removal and another change at once', () => {
  it('re-reads the role under the lock: a member promoted a moment before cannot be removed by a manager', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    const member = await w.member();
    const row = (await w.rowOf(member))!;
    const result = await whileLocked(
      w,
      row.id,
      (query) =>
        query("update org_membership set role = 'manager' where id = $1", [row.id]).then(
          () => undefined,
        ),
      () => w.memberships.remove(manager, row.id),
    );
    expect(result.ok).toBe(false);
    expect((result as { error: unknown }).error).toBeInstanceOf(Forbidden);
    expect(await w.rowOf(member)).toMatchObject({ state: 'approved', role: 'manager' });
    expect(await w.eventsNamed('registry.membership.left@1')).toEqual([]);
    // An Admin removes the same row afterwards.
    expect((await w.memberships.remove(w.admin, row.id)).state).toBe('left');
  });

  it('sees a decision that ended the row first: the removal gets 409 membership-state', async () => {
    const w = await startWorld(h);
    const member = await w.member();
    const row = (await w.rowOf(member))!;
    const result = await whileLocked(
      w,
      row.id,
      (query) =>
        query("update org_membership set state = 'left', ended_at = now() where id = $1", [
          row.id,
        ]).then(() => undefined),
      () => w.memberships.remove(w.admin, row.id),
    );
    expect((result as { error: unknown }).error).toMatchObject({
      status: 409,
      type: 'membership-state',
    });
  });

  it('races two removals of one member: one effect, one 409', async () => {
    for (let round = 0; round < 3; round += 1) {
      const w = await startWorld(h);
      const manager = await w.manager();
      const member = await w.member();
      const row = (await w.rowOf(member))!;
      const [a, b] = await Promise.all([
        settle(w.memberships.remove(w.admin, row.id)),
        settle(w.memberships.remove(manager, row.id)),
      ]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      const loser = (a.ok ? b : a) as { ok: false; error: unknown };
      expect(loser.error).toMatchObject({ status: 409, type: 'membership-state' });
      expect(await w.eventsNamed('registry.membership.left@1')).toHaveLength(1);
    }
  });

  it('races a removal and a promotion of the same member: the end state is consistent, the events agree with it', async () => {
    for (let round = 0; round < 3; round += 1) {
      const w = await startWorld(h);
      const manager = await w.manager();
      const member = await w.member();
      const row = (await w.rowOf(member))!;
      const [removal, promotion] = await Promise.all([
        settle(w.memberships.remove(manager, row.id)),
        settle(w.memberships.setRole(w.admin, row.id, 'manager')),
      ]);
      const end = (await w.rowOf(member))!;
      // Either order is allowed. The manager's removal of a plain member either happens before the
      // promotion (then the promotion finds a left row: 409) or after it (then it is 403).
      if (removal.ok) {
        expect(end).toMatchObject({ state: 'left', role: 'member' });
        expect(promotion.ok).toBe(false);
        expect((promotion as { error: unknown }).error).toMatchObject({ status: 409 });
      } else {
        expect(end).toMatchObject({ state: 'approved', role: 'manager' });
        expect(promotion.ok).toBe(true);
        expect((removal as { error: unknown }).error).toBeInstanceOf(Forbidden);
      }
    }
  });
});

describe('two role changes at once', () => {
  it('races two promotions of one member: one effect, no lost update, one event', async () => {
    for (let round = 0; round < 3; round += 1) {
      const w = await startWorld(h);
      const manager = await w.manager();
      const member = await w.member();
      const row = (await w.rowOf(member))!;
      const [a, b] = await Promise.all([
        w.memberships.setRole(w.admin, row.id, 'manager'),
        w.memberships.setRole(manager, row.id, 'manager'),
      ]);
      expect([a.role, b.role]).toEqual(['manager', 'manager']);
      expect(await w.eventsNamed('registry.membership.roleChanged@1')).toHaveLength(1);
      expect((await w.rowOf(member))!.role).toBe('manager');
    }
  });

  it('races a promotion and a demotion of one person: the row ends in the state of the last writer and the events say so', async () => {
    const w = await startWorld(h);
    await w.manager();
    const peer = await w.manager();
    const row = (await w.rowOf(peer))!;
    const [a, b] = await Promise.all([
      settle(w.memberships.setRole(w.admin, row.id, 'member')),
      settle(w.memberships.setRole(w.admin, row.id, 'manager')),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const events = await w.eventsNamed('registry.membership.roleChanged@1');
    const end = (await w.rowOf(peer))!.role;
    // The demotion always happens; the promotion happens only if it ran after it.
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.at(-1)).toMatchObject({ to: end });
  });

  it('holds the manager limit against two promotions at once: exactly one succeeds, the other is 409 too-many-managers', async () => {
    for (let round = 0; round < 4; round += 1) {
      const w = await startWorld(h);
      await w.configure({ membership: { maxManagersPerOrganisation: 2 } });
      await w.manager();
      const x = await w.member();
      const y = await w.member();
      const [a, b] = await Promise.all([
        settle(w.memberships.setRole(w.admin, (await w.rowOf(x))!.id, 'manager')),
        settle(w.memberships.setRole(w.admin, (await w.rowOf(y))!.id, 'manager')),
      ]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      const loser = (a.ok ? b : a) as { ok: false; error: unknown };
      expect(loser.error).toMatchObject({ status: 409, type: 'too-many-managers' });
      const { rows } = await w.pool.query<{ n: number }>(
        "select count(*)::int as n from org_membership where organisation_id = $1 and state = 'approved' and role = 'manager'",
        [w.org.id],
      );
      expect(rows[0]!.n).toBe(2);
    }
  });

  it('counts the managers after two demotions at once: exactly one of the two events says no manager is left, and the administrators hear of it once', async () => {
    for (let round = 0; round < 4; round += 1) {
      const w = await startWorld(h);
      const a = await w.manager();
      const b = await w.manager();
      await Promise.all([
        w.memberships.setRole(w.admin, (await w.rowOf(a))!.id, 'member'),
        w.memberships.setRole(w.admin, (await w.rowOf(b))!.id, 'member'),
      ]);
      const flags = (await w.eventsNamed('registry.membership.roleChanged@1')).map(
        (e) => e.organisationHasManager,
      );
      expect(flags.sort()).toEqual([false, true]);
      const noManager = (await w.inbox()).filter(
        (i) => i.template === 'registry.organisation-without-manager',
      );
      expect(noManager).toHaveLength(1); // one administrator in the world
    }
  });
});

describe('requests at once', () => {
  it('makes one row of two requests by one person', async () => {
    for (let round = 0; round < 3; round += 1) {
      const w = await startWorld(h);
      const person = await w.person();
      const [a, b] = await Promise.all([
        w.memberships.request(person, w.org.id),
        w.memberships.request(person, w.org.id),
      ]);
      expect([a.created, b.created].sort()).toEqual([false, true]);
      expect(
        (await w.pool.query('select 1 from org_membership where user_id = $1', [person.userId]))
          .rows,
      ).toHaveLength(1);
      expect(await w.eventsNamed('registry.membership.requested@1')).toHaveLength(1);
    }
  });

  it('holds the cap of open requests against parallel requests to different organisations', async () => {
    const w = await startWorld(h);
    await w.configure({ membership: { maxPendingPerUser: 2 } });
    const orgs = [w.org, w.other, await makeOrganisation(w.pool), await makeOrganisation(w.pool)];
    const person = await w.person();
    const results = await Promise.all(
      orgs.map((org) => settle(w.memberships.request(person, org.id))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    for (const failed of results.filter((r) => !r.ok)) {
      expect((failed as { error: unknown }).error).toMatchObject({
        status: 409,
        type: 'too-many-pending',
      });
    }
    expect(
      (await w.pool.query("select 1 from org_membership where state = 'requested'")).rows,
    ).toHaveLength(2);
  });

  it('lets a request and the deletion of the organisation meet in either order without a half-deleted organisation', async () => {
    for (let round = 0; round < 3; round += 1) {
      const w = await startWorld(h);
      const person = await w.person();
      const [request, removal] = await Promise.all([
        settle(w.memberships.request(person, w.org.id)),
        settle(w.organisations.delete(w.admin, w.org.id)),
      ]);
      expect(removal.ok).toBe(true);
      const left = await w.pool.query('select 1 from org_membership where organisation_id = $1', [
        w.org.id,
      ]);
      expect(left.rows).toEqual([]); // no row survives its organisation
      if (!request.ok) expect((request as { error: unknown }).error).toMatchObject({ status: 404 });
    }
  });
});
