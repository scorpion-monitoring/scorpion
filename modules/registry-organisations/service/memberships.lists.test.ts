// The lists, the summary and the trusted reads, over real Postgres and the real authoriser: who sees
// which rows, what a row shows and never shows (no address, no state for a member), the counts, and
// the member count and badge of the organisation record.
import { Forbidden, Invalid, NotFound, Unauthorized, type Actor } from '@scorpion/contracts';
import { makeMembership, makeOrganisation } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { fixtureContributor, useOrganisations } from '../test/harness.ts';
import { startWorld } from '../test/world.ts';

const h = useOrganisations();
const anonymous: Actor = { kind: 'anonymous' };
const PAGE = { page: 0, pageSize: 50 };
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';

describe('listMembers', () => {
  it('shows an approved member the usernames and join dates of the other approved members, and nothing else', async () => {
    const w = await startWorld(h);
    const viewer = await w.member();
    const manager = await w.manager();
    await w.requester(); // a request is not a member
    const gone = await w.person();
    await w.join(gone, { state: 'left' });
    const { items, total } = await w.memberships.listMembers(viewer, w.org.id, PAGE);
    expect(total).toBe(2);
    expect(items.map((i) => i.username).sort()).toEqual([viewer.username, manager.username].sort());
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(['since', 'username']); // no state, no role, no id, no address
      expect(item.since).toBeInstanceOf(Date);
    }
    expect(JSON.stringify(items)).not.toMatch(/@/);
    // Pages are honoured, oldest first.
    const page = await w.memberships.listMembers(viewer, w.org.id, { page: 1, pageSize: 1 });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
  });

  it('answers a manager and an Admin always, and a member only while membersVisibleToMembers is on [ASVS-8.2.1]', async () => {
    const w = await startWorld(h);
    const member = await w.member();
    const manager = await w.manager();
    await w.configure({ membership: { membersVisibleToMembers: false } });
    await expect(w.memberships.listMembers(member, w.org.id, PAGE)).rejects.toBeInstanceOf(
      Forbidden,
    );
    expect((await w.memberships.listMembers(manager, w.org.id, PAGE)).total).toBe(2);
    expect((await w.memberships.listMembers(w.admin, w.org.id, PAGE)).total).toBe(2);
  });

  it('turns away a plain person, a person who only asked, a member of another organisation and an anonymous caller, before it looks the organisation up [ASVS-8.2.1] [ASVS-8.3.1]', async () => {
    const w = await startWorld(h);
    const asked = (await w.requester()).who;
    const elsewhere = await w.member(w.other.id);
    for (const caller of [await w.person(), asked, elsewhere]) {
      await expect(w.memberships.listMembers(caller, w.org.id, PAGE)).rejects.toBeInstanceOf(
        Forbidden,
      );
      await expect(w.memberships.listMembers(caller, ABSENT, PAGE)).rejects.toBeInstanceOf(
        Forbidden,
      );
    }
    await expect(w.memberships.listMembers(anonymous, w.org.id, PAGE)).rejects.toBeInstanceOf(
      Unauthorized,
    );
    await expect(w.memberships.listMembers(w.admin, ABSENT, PAGE)).rejects.toBeInstanceOf(NotFound);
    await expect(w.memberships.listMembers(w.admin, 'nope', PAGE)).rejects.toBeInstanceOf(Invalid);
  });
});

describe('listPending and listForOrganisation', () => {
  it('shows an Admin every organisation and a manager only the ones they manage, oldest request first [ASVS-8.2.2]', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    const t = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes));
    const second = await w.person();
    const first = await w.person();
    await makeMembership(w.pool, {
      organisationId: w.org.id,
      userId: second.userId,
      state: 'requested',
      requestedAt: t(20),
    });
    await makeMembership(w.pool, {
      organisationId: w.org.id,
      userId: first.userId,
      state: 'requested',
      requestedAt: t(10),
    });
    const foreign = await w.person();
    await makeMembership(w.pool, {
      organisationId: w.other.id,
      userId: foreign.userId,
      state: 'requested',
      requestedAt: t(5),
    });
    const asManager = await w.memberships.listPending(manager, { state: 'requested' }, PAGE);
    expect(asManager.items.map((i) => i.username)).toEqual([first.username, second.username]);
    expect(asManager.total).toBe(2);
    const asAdmin = await w.memberships.listPending(w.admin, { state: 'requested' }, PAGE);
    expect(asAdmin.items.map((i) => i.username)).toEqual([
      foreign.username,
      first.username,
      second.username,
    ]);
    expect(asAdmin.items[0]!.organisation).toMatchObject({ abbreviation: 'DKFZ' });
  });

  it('filters by state, organisation and type, and refuses a filter on an organisation the manager does not manage', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    const consortium = await makeOrganisation(w.pool, { type: 'consortium' });
    await w.requester();
    await w.requester(w.other.id);
    const inConsortium = await w.person();
    await w.join(inConsortium, { organisationId: consortium.id, state: 'requested' });
    await w.member();
    expect(
      (await w.memberships.listPending(w.admin, { state: 'approved' }, PAGE)).items.every(
        (i) => i.state === 'approved',
      ),
    ).toBe(true);
    expect(
      (await w.memberships.listPending(w.admin, { type: 'consortium' }, PAGE)).items.map(
        (i) => i.username,
      ),
    ).toEqual([inConsortium.username]);
    expect(
      (await w.memberships.listPending(w.admin, { organisationId: w.other.id }, PAGE)).total,
    ).toBe(1);
    expect(
      (await w.memberships.listPending(manager, { organisationId: w.org.id }, PAGE)).total,
    ).toBe(3);
    await expect(
      w.memberships.listPending(manager, { organisationId: w.other.id }, PAGE),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      w.memberships.listForOrganisation(manager, w.other.id, {}, PAGE),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      w.memberships.listPending(w.admin, { state: 'pending' as never }, PAGE),
    ).rejects.toBeInstanceOf(Invalid);
    await expect(
      w.memberships.listPending(w.admin, { organisationId: 'nope' }, PAGE),
    ).rejects.toBeInstanceOf(Invalid);
    await expect(
      w.memberships.listForOrganisation(w.admin, ABSENT, {}, PAGE),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it('is 403 for anybody who is neither an Admin nor a manager: a plain person, a member, a person who asked, an anonymous caller [ASVS-8.2.1]', async () => {
    const w = await startWorld(h);
    await w.requester();
    const asked = (await w.requester()).who;
    for (const caller of [await w.person(), await w.member(), asked]) {
      await expect(w.memberships.listPending(caller, {}, PAGE)).rejects.toBeInstanceOf(Forbidden);
      await expect(
        w.memberships.listForOrganisation(caller, w.org.id, {}, PAGE),
      ).rejects.toBeInstanceOf(Forbidden);
    }
    await expect(w.memberships.listPending(anonymous, {}, PAGE)).rejects.toBeInstanceOf(
      Unauthorized,
    );
    // A manager who has been demoted is nobody at the next call.
    const manager = await w.manager();
    expect((await w.memberships.listPending(manager, {}, PAGE)).total).toBeGreaterThan(0);
    await w.pool.query("update org_membership set role = 'member' where user_id = $1", [
      manager.userId,
    ]);
    await expect(w.memberships.listPending(manager, {}, PAGE)).rejects.toBeInstanceOf(Forbidden);
  });

  it('answers a manager’s token without the decide scope with 403 and not with an empty list [ASVS-8.2.1]', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    await w.requester();
    const token = (scopes: string[]) => ({ ...manager, via: 'token' as const, scopes });
    const read = 'registry.organisations.organisation.read';
    await expect(w.memberships.listPending(token([read]), {}, PAGE)).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(
      w.memberships.listForOrganisation(token([read]), w.org.id, {}, PAGE),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(await w.memberships.summary(token([read]))).toEqual({ pending: 0, manages: true });
    const decide = 'registry.organisations.membership.decide';
    expect(
      (await w.memberships.listPending(token([read, decide]), { state: 'requested' }, PAGE)).total,
    ).toBe(1);
  });

  it('draws the buttons from data: allowedActions per row, none on the caller’s own row, and never an email address', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    const peer = await w.manager();
    const member = await w.member();
    const { who: asker } = await w.requester();
    const rows = (await w.memberships.listForOrganisation(manager, w.org.id, {}, PAGE)).items;
    const of = (userId: string) => rows.find((r) => r.userId === userId)!;
    expect(of(manager.userId).allowedActions).toEqual([]); // nobody acts on their own row
    expect(of(peer.userId).allowedActions).toEqual(['demote']); // never remove a manager
    expect(of(member.userId).allowedActions).toEqual(['promote', 'remove']);
    expect(of(asker.userId).allowedActions).toEqual(['approve', 'reject']);
    expect(of(asker.userId)).toMatchObject({ username: asker.username, state: 'requested' });
    // An Admin may remove a manager too.
    const asAdmin = (await w.memberships.listForOrganisation(w.admin, w.org.id, {}, PAGE)).items;
    expect(asAdmin.find((r) => r.userId === peer.userId)!.allowedActions).toEqual([
      'demote',
      'remove',
    ]);
    expect(JSON.stringify([rows, asAdmin])).not.toMatch(/@example\.org/);
  });
});

describe('summary', () => {
  it('counts the requests the caller may decide, never their own, and answers zeros for a plain person without an error', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    await w.requester();
    await w.requester();
    await w.requester(w.other.id);
    await w.memberships.request(manager, w.other.id); // the manager's own request elsewhere
    expect(await w.memberships.summary(manager)).toEqual({ pending: 2, manages: true });
    expect(await w.memberships.summary(w.admin)).toEqual({ pending: 4, manages: false });
    expect(await w.memberships.summary(await w.person())).toEqual({ pending: 0, manages: false });
    expect(await w.memberships.summary(await w.member())).toEqual({ pending: 0, manages: false });
    await expect(w.memberships.summary(anonymous)).rejects.toBeInstanceOf(Unauthorized);
    await expect(w.memberships.summary(await w.actor())).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('the member count and the caller’s own row on the organisation', () => {
  it('counts approved members, managers included, in a list and on one organisation, and shows the caller’s own state', async () => {
    const w = await startWorld(h);
    await w.member();
    await w.member();
    await w.manager();
    await w.requester();
    const me = await w.person();
    await w.join(me, { state: 'rejected' });
    await makeOrganisation(w.pool, { abbreviation: 'ZZZ' });
    const { organisations } = await w.organisations.list(me, {}, PAGE);
    const by = Object.fromEntries(organisations.map((o) => [o.abbreviation, o]));
    expect(by.IPK).toMatchObject({
      memberCount: 3,
      myMembership: { state: 'rejected', role: 'member' },
    });
    expect(by.DKFZ).toMatchObject({ memberCount: 0, myMembership: null });
    expect(by.ZZZ).toMatchObject({ memberCount: 0, myMembership: null });
    const one = await w.organisations.get(me, w.org.id);
    expect(one).toMatchObject({ memberCount: 3, myMembership: { state: 'rejected' } });
  });

  it('counts a whole page with a few statements, not one per organisation', async () => {
    const w = await startWorld(h);
    for (let i = 0; i < 25; i += 1) {
      const org = await makeOrganisation(w.pool, {
        abbreviation: `ZZ${String(i).padStart(2, '0')}`,
        name: `Page ${i}`,
      });
      for (let j = 0; j < i % 4; j += 1) await w.member(org.id);
    }
    const { organisations, statements } = await countingStatements(w.pool, () =>
      w.organisations.list(w.admin, { q: 'ZZ' }, PAGE),
    );
    expect(organisations).toHaveLength(25);
    expect(organisations.map((o) => o.memberCount)).toEqual(
      Array.from({ length: 25 }, (_, i) => i % 4),
    );
    // The page, its total, the member counts and the caller's own rows, and the permission checks: a
    // handful of statements, however many organisations the page holds.
    expect(statements).toBeGreaterThan(0);
    expect(statements).toBeLessThan(12);
  });

  it('gives a manager the contact point of their organisation also when the setting hides it, and nobody else but an Admin [ASVS-8.2.2]', async () => {
    const w = await startWorld(h);
    const org = await makeOrganisation(w.pool, {
      contactEmail: 'info@example.org',
      contactType: 'support',
    });
    const manager = await w.manager(org.id);
    const member = await w.member(org.id);
    const stranger = await w.person();
    const managerElsewhere = await w.manager(w.other.id);
    await w.configure({ exposeContactPoint: false });
    expect(await w.organisations.get(manager, org.id)).toMatchObject({
      contactEmail: 'info@example.org',
    });
    expect(await w.organisations.get(w.admin, org.id)).toMatchObject({
      contactEmail: 'info@example.org',
    });
    for (const caller of [member, stranger, managerElsewhere]) {
      expect(await w.organisations.get(caller, org.id)).not.toHaveProperty('contactEmail');
    }
    expect((await w.organisations.schemaOrg(manager, org.id)).contactPoint).toBeDefined();
    expect((await w.organisations.schemaOrg(member, org.id)).contactPoint).toBeUndefined();
  });
});

/** Runs `work` and counts the statements the application sent through the pool meanwhile. */
async function countingStatements<T extends { organisations: unknown[] }>(
  pool: { query: (...args: never[]) => unknown },
  work: () => Promise<T>,
): Promise<T & { statements: number }> {
  let statements = 0;
  const original = pool.query;
  pool.query = ((...args: never[]) => {
    statements += 1;
    return (original as (...a: never[]) => unknown).apply(pool, args);
  }) as typeof pool.query;
  try {
    return { ...(await work()), statements };
  } finally {
    pool.query = original;
  }
}

describe('the trusted reads (AsSystem)', () => {
  it('answer from ids: who is an approved member or a manager, the organisations of a person, and the counts; nothing for a bad id', async () => {
    const w = await startWorld(h);
    const manager = await w.manager();
    const member = await w.member();
    const asked = (await w.requester()).who;
    const left = await w.person();
    await w.join(left, { state: 'left' });
    await w.join(member, { organisationId: w.other.id });
    const s = w.memberships;
    expect(await s.isApprovedMemberAsSystem(member.userId, w.org.id)).toBe(true);
    expect(await s.isApprovedMemberAsSystem(manager.userId, w.org.id)).toBe(true);
    expect(await s.isApprovedMemberAsSystem(asked.userId, w.org.id)).toBe(false);
    expect(await s.isApprovedMemberAsSystem(left.userId, w.org.id)).toBe(false);
    expect(await s.isManagerAsSystem(manager.userId, w.org.id)).toBe(true);
    expect(await s.isManagerAsSystem(member.userId, w.org.id)).toBe(false);
    expect(await s.listApprovedOrganisationIdsAsSystem(member.userId)).toEqual(
      [w.org.id, w.other.id].sort(),
    );
    expect(await s.listApprovedOrganisationIdsAsSystem(asked.userId)).toEqual([]);
    expect(await s.countApprovedMembersAsSystem([w.org.id, w.other.id, ABSENT])).toEqual({
      [w.org.id]: 2,
      [w.other.id]: 1,
      [ABSENT]: 0,
    });
    expect(await s.isApprovedMemberAsSystem('nope', w.org.id)).toBe(false);
    expect(await s.isManagerAsSystem(manager.userId, 'nope')).toBe(false);
    expect(await s.listApprovedOrganisationIdsAsSystem('nope')).toEqual([]);
    expect(await s.countApprovedMembersAsSystem(['nope'])).toEqual({});
  });

  it('give the organisation record its member count too, and a type without members is still a plain record', async () => {
    const funder = fixtureContributor({
      types: [{ id: 'funder', labels: { en: 'Funder' }, membership: false, order: 30 }],
    });
    const w = await startWorld(h, { extra: [funder] });
    await w.member();
    const [record] = await w.organisations.findByIdsAsSystem([w.org.id]);
    expect(record).toMatchObject({ id: w.org.id, memberCount: 1 });
    expect(record).not.toHaveProperty('myMembership');
    expect(await w.organisations.findByAbbreviationAsSystem('provider', 'ipk')).toMatchObject({
      memberCount: 1,
    });
  });
});
