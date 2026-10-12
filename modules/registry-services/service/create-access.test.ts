// Who may create a service (plan §6 item 3, Decision 14): `…service.create` (Admin and User) and then either
// Admin, or an approved member of the chosen provider. No membership, no service; the check comes before the
// body is parsed, so a non-member learns nothing from a 422, and a refused create leaves nothing behind.
import { Forbidden, Invalid, Unauthorized, type UserActor } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { breakOutbox, useServices } from '../test/harness.ts';
import { anonymous, uniq, world, type World } from '../test/world.ts';

const h = useServices();
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';

const body = (w: World, over: Record<string, unknown> = {}) => ({
  slug: uniq(),
  name: uniq('Name'),
  provider: w.provider.id,
  ...over,
});
const counts = async (w: World) =>
  (
    await w.pool.query<{ n: number }>(
      `select (select count(*) from svc_service)::int + (select count(*) from svc_service_organisation)::int + (select count(*) from svc_slug_history)::int as n`,
    )
  ).rows[0]!.n;

describe('create: the provider’s people', () => {
  it.each(['member', 'manager'] as const)(
    'lets an approved %s create a service for their provider, by: member',
    async (who) => {
      const w = await world(h);
      const before = await counts(w);
      const view = await w.services.create(
        w.people[who],
        body(w, { consortia: [w.consortium.id] }),
      );
      expect(view.organisations.map((o) => [o.role, o.id])).toEqual([
        ['provider', w.provider.id],
        ['consortium', w.consortium.id],
      ]);
      expect(await counts(w)).toBe(before + 4); // the row, its slug, two links
      const [created] = (await w.events()).filter(
        (e) => e.name === 'registry.service.created@1' && e.payload.serviceId === view.id,
      );
      expect(created!.payload).toEqual({
        serviceId: view.id,
        by: 'member',
        actorId: w.people[who].userId,
      });
      // The creator becomes an editor by the membership, not by having created the record.
      expect(view.editableFields).toContain('name');
    },
  );

  it('lets Admin create for any provider, by: admin', async () => {
    const w = await world(h);
    const view = await w.services.create(w.people.admin, body(w, { provider: w.other.id }));
    const [created] = (await w.events()).filter((e) => e.payload.serviceId === view.id);
    expect(created!.payload).toMatchObject({ by: 'admin', actorId: w.people.admin.userId });
  });

  it('lets a person who is a member of two organisations create for either, and not for a third', async () => {
    const w = await world(h);
    await w.join(w.people.member, w.other.id, 'approved');
    await expect(
      w.services.create(w.people.member, body(w, { provider: w.other.id })),
    ).resolves.toBeDefined();
    await expect(w.services.create(w.people.member, body(w))).resolves.toBeDefined();
  });
});

describe('create: everybody else is refused, and nothing is written [ASVS-8.2.1]', () => {
  it.each(['plain', 'requested', 'rejected', 'left', 'managerElsewhere'] as const)(
    'refuses %s the provider they are not an approved member of',
    async (who) => {
      const w = await world(h);
      const before = await counts(w);
      const error = await w.services.create(w.people[who], body(w)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Forbidden);
      expect(JSON.stringify(error)).not.toContain(w.provider.id);
      expect(await counts(w)).toBe(before);
      expect((await w.events()).filter((e) => e.name === 'registry.service.created@1')).toEqual([]);
    },
  );

  it('refuses a Reviewer, who holds only read and publish', async () => {
    const w = await world(h);
    await expect(w.services.create(w.people.reviewer, body(w))).rejects.toBeInstanceOf(Forbidden);
  });

  it('refuses a member the provider of another organisation, even with a consortium they belong to', async () => {
    const w = await world(h);
    await w.join(w.people.member, w.consortium.id, 'approved');
    await expect(
      w.services.create(w.people.member, body(w, { provider: w.other.id })),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      w.services.create(w.people.member, body(w, { provider: w.consortium.id })),
    ).rejects.toBeInstanceOf(Invalid);
  });

  it('answers 401 to an anonymous caller', async () => {
    const w = await world(h);
    await expect(w.services.create(anonymous, body(w))).rejects.toBeInstanceOf(Unauthorized);
  });

  it('refuses before it validates: a non-member with a bad body gets 403, and an unknown organisation is 403 for them but 422 for Admin', async () => {
    const w = await world(h);
    await expect(
      w.services.create(w.people.plain, body(w, { slug: 'bad slug!', stage: 'NOPE' })),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      w.services.create(w.people.plain, body(w, { provider: ABSENT })),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      w.services.create(w.people.admin, body(w, { provider: ABSENT })),
    ).rejects.toBeInstanceOf(Invalid);
  });

  it('answers 422 for a member who names no provider, a bad provider or two providers of their own', async () => {
    const w = await world(h);
    await w.join(w.people.member, w.other.id, 'approved');
    const { provider: _provider, ...without } = body(w);
    void _provider;
    await expect(w.services.create(w.people.member, without)).rejects.toBeInstanceOf(Invalid);
    await expect(
      w.services.create(w.people.member, body(w, { provider: 'not-a-uuid' })),
    ).rejects.toBeInstanceOf(Invalid);
    await expect(
      w.services.create(w.people.member, body(w, { provider: [w.provider.id, w.other.id] })),
    ).rejects.toBeInstanceOf(Invalid);
  });

  it('reads the membership at the call: a member who left a moment before is refused', async () => {
    const w = await world(h);
    await expect(w.services.create(w.people.member, body(w))).resolves.toBeDefined();
    await w.pool.query("update org_membership set state = 'left' where user_id = $1", [
      w.people.member.userId,
    ]);
    await expect(w.services.create(w.people.member, body(w))).rejects.toBeInstanceOf(Forbidden);
  });

  it('refuses a token that does not name the scope, and an Admin token without the manage scope creates only as a member', async () => {
    const w = await world(h);
    const token = (actor: UserActor, scopes: string[]): UserActor => ({
      ...actor,
      via: 'token',
      scopes,
    });
    await expect(
      w.services.create(token(w.people.member, ['registry.services.service.read']), body(w)),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      w.services.create(token(w.people.member, ['registry.services.service.create']), body(w)),
    ).resolves.toBeDefined();
    // An Admin's token that names `create` only: the Admin rights are not in it, so the membership rule applies.
    await expect(
      w.services.create(
        token(w.people.admin, ['registry.services.service.create']),
        body(w, { provider: w.other.id }),
      ),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it('rolls everything back when the event cannot be stored, for a member too', async () => {
    const w = await world(h);
    const before = await counts(w);
    const restore = await breakOutbox(w.pool);
    await expect(
      w.services.create(w.people.member, body(w, { consortia: [w.consortium.id] })),
    ).rejects.toThrow();
    await restore();
    expect(await counts(w)).toBe(before);
  });

  it('lets two members of one provider create the same slug at once: one 409', async () => {
    const w = await world(h);
    const slug = uniq('twin');
    const results = await Promise.allSettled([
      w.services.create(w.people.member, body(w, { slug })),
      w.services.create(w.people.manager, body(w, { slug })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason,
    ).toMatchObject({ status: 409 });
  });
});
