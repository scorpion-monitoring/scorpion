// `setPublication` over real Postgres: only Reviewers and Admin switch a service between private and public
// (the flag decides who may read it, so it is the one field the provider's own people never write), the three
// columns move together, a no-op sends nothing, `allowPublic` off refuses a publication, two publications meet
// on the row lock, and nothing is written when the event cannot be stored.
import { Forbidden, NotFound, Unauthorized } from '@scorpion/contracts';
import { makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { breakOutbox, useServices } from '../test/harness.ts';
import { anonymous, rejection, world } from '../test/world.ts';

const h = useServices();
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';
const pubEvents = async (
  events: () => Promise<{ name: string; payload: Record<string, unknown> }[]>,
) => (await events()).filter((e) => /^registry\.service\.(published|unpublished)@1$/.test(e.name));

describe('setPublication', () => {
  it.each(['reviewer', 'admin'] as const)(
    'lets %s publish and unpublish: the three columns move together [ASVS-8.2.1]',
    async (who) => {
      const w = await world(h);
      const published = await w.services.setPublication(w.people[who], w.svc.id, { public: true });
      expect(published.public).toBe(true);
      expect(await w.row()).toMatchObject({ public: true, published_by: w.people[who].userId });
      const { rows } = await w.pool.query<{ published_at: Date | null }>(
        'select published_at from svc_service where id = $1',
        [w.svc.id],
      );
      expect(rows[0]!.published_at).toBeInstanceOf(Date);
      const unpublished = await w.services.setPublication(w.people[who], w.svc.id, {
        public: false,
      });
      expect(unpublished.public).toBe(false);
      const after = await w.pool.query<{ published_at: Date | null; published_by: string | null }>(
        'select published_at, published_by from svc_service where id = $1',
        [w.svc.id],
      );
      expect(after.rows[0]).toEqual({ published_at: null, published_by: null });
      expect((await pubEvents(w.events)).map((e) => [e.name, e.payload])).toEqual([
        ['registry.service.published@1', { serviceId: w.svc.id, actorId: w.people[who].userId }],
        ['registry.service.unpublished@1', { serviceId: w.svc.id, actorId: w.people[who].userId }],
      ]);
    },
  );

  it.each(['manager', 'member', 'plain', 'requested', 'left', 'managerElsewhere'] as const)(
    'refuses %s with 403, even for the service of their own provider, and changes nothing [ASVS-8.2.1]',
    async (who) => {
      const w = await world(h);
      const before = await w.row();
      await expect(
        w.services.setPublication(w.people[who], w.svc.id, { public: true }),
      ).rejects.toBeInstanceOf(Forbidden);
      expect(await w.row()).toEqual(before);
      const pub = await makeService(w.pool, { provider: w.provider.id, public: true });
      await expect(
        w.services.setPublication(w.people[who], pub.id, { public: false }),
      ).rejects.toBeInstanceOf(Forbidden);
      expect((await w.row(pub.id)).public).toBe(true);
      expect(await pubEvents(w.events)).toEqual([]);
    },
  );

  it('answers 401 to an anonymous caller, 404 for an unknown service and 422 for a bad id', async () => {
    const w = await world(h);
    await expect(
      w.services.setPublication(anonymous, w.svc.id, { public: true }),
    ).rejects.toBeInstanceOf(Unauthorized);
    await expect(
      w.services.setPublication(w.people.reviewer, ABSENT, { public: true }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      w.services.setPublication(w.people.reviewer, 'nope', { public: true }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('is a no-op for the state it already has: the same record, no write, no event', async () => {
    const w = await world(h);
    await w.services.setPublication(w.people.reviewer, w.svc.id, { public: true });
    const before = await w.row();
    const view = await w.services.setPublication(w.people.admin, w.svc.id, { public: true });
    expect(view.public).toBe(true);
    expect(await w.row()).toEqual(before); // published_by is still the Reviewer's
    await w.services.setPublication(w.people.admin, w.svc.id, { public: false });
    await w.services.setPublication(w.people.admin, w.svc.id, { public: false });
    expect(await pubEvents(w.events)).toHaveLength(2);
  });

  it('refuses a publication with allowPublic off (409), allows an unpublication, and publishes again when it is back on', async () => {
    const w = await world(h);
    const pub = await makeService(w.pool, { provider: w.provider.id, public: true });
    await w.configure({ exposeContactPoint: true, allowPublic: false });
    const error = await rejection(
      w.services.setPublication(w.people.admin, w.svc.id, { public: true }),
    );
    expect(error).toMatchObject({ status: 409 });
    expect((await w.row()).public).toBe(false);
    await expect(
      w.services.setPublication(w.people.admin, pub.id, { public: false }),
    ).resolves.toMatchObject({ public: false });
    await w.configure({ exposeContactPoint: true, allowPublic: true });
    await expect(
      w.services.setPublication(w.people.admin, w.svc.id, { public: true }),
    ).resolves.toMatchObject({ public: true });
  });

  it('is not changed by an update: public is no field of a patch, and a member sees it in the record', async () => {
    const w = await world(h);
    await expect(
      w.services.update(w.people.admin, w.svc.id, { public: true }),
    ).rejects.toMatchObject({ status: 422 });
    await w.services.setPublication(w.people.reviewer, w.svc.id, { public: true });
    expect((await w.services.get(w.people.member, w.svc.id)).public).toBe(true);
    expect((await w.services.get(w.people.manager, w.svc.id)).public).toBe(true);
    await w.services.update(w.people.member, w.svc.id, { description: 'edited while public' });
    expect((await w.row()).public).toBe(true);
  });

  it('lets two publications meet: one writes and one event is sent, the other finds the state set', async () => {
    const w = await world(h);
    await Promise.all([
      w.services.setPublication(w.people.reviewer, w.svc.id, { public: true }),
      w.services.setPublication(w.people.admin, w.svc.id, { public: true }),
    ]);
    expect(await pubEvents(w.events)).toHaveLength(1);
    expect((await w.row()).public).toBe(true);
  });

  it('lets a publication and an unpublication meet without leaving the three columns apart', async () => {
    const w = await world(h);
    await Promise.all([
      w.services.setPublication(w.people.reviewer, w.svc.id, { public: true }),
      w.services.setPublication(w.people.admin, w.svc.id, { public: false }),
    ]);
    const row = await w.row();
    const { rows } = await w.pool.query<{ ok: boolean }>(
      'select (public = (published_at is not null) and (published_at is null) = (published_by is null)) as ok from svc_service where id = $1',
      [w.svc.id],
    );
    expect(rows[0]!.ok).toBe(true);
    expect(row.public === (row.published_by !== null)).toBe(true);
  });

  it('rolls the change back when the event cannot be stored', async () => {
    const w = await world(h);
    const before = await w.row();
    const restore = await breakOutbox(w.pool);
    await expect(
      w.services.setPublication(w.people.reviewer, w.svc.id, { public: true }),
    ).rejects.toThrow();
    await restore();
    expect(await w.row()).toEqual(before);
    expect(await pubEvents(w.events)).toEqual([]);
  });
});
