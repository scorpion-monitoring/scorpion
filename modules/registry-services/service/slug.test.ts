// A rename with its history (plan §6 item 5): the old slug keeps resolving and is never given to another
// service, a clash on either index is a 409 that names the field only, and the writers that meet are decided
// by the database: two renames to one slug, a rename racing a create, a rename racing a rename back.
import { DomainError } from '@scorpion/contracts';
import { makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useServices } from '../test/harness.ts';
import { rejection, uniq, world } from '../test/world.ts';

const h = useServices();

describe('a rename keeps the old address working', () => {
  it('writes the old slug to the history, keeps it resolving with redirectedFrom, and emits slugChanged with ids only', async () => {
    const w = await world(h);
    const old = w.svc.slug;
    const view = await w.services.update(w.people.manager, w.svc.id, { slug: 'new-address' });
    expect(view.slug).toBe('new-address');
    expect(await w.history()).toEqual([old, 'new-address']);
    expect(await w.row()).toMatchObject({ slug: 'new-address' });
    const viaOld = await w.services.getBySlug(w.people.plain, old);
    expect(viaOld).toMatchObject({ id: w.svc.id, slug: 'new-address', redirectedFrom: old });
    const viaNew = await w.services.getBySlug(w.people.plain, 'new-address');
    expect(viaNew).not.toHaveProperty('redirectedFrom');
    // The lookup ignores case; `redirectedFrom` is the old slug as it was stored.
    expect(await w.services.findBySlugAsSystem(old.toUpperCase())).toMatchObject({
      id: w.svc.id,
      redirectedFrom: old,
    });
    const changed = (await w.events()).filter((e) => e.name === 'registry.service.slugChanged@1');
    expect(changed).toEqual([
      {
        name: 'registry.service.slugChanged@1',
        payload: { serviceId: w.svc.id, actorId: w.people.manager.userId },
      },
    ]);
  });

  it('keeps every old slug across several renames', async () => {
    const w = await world(h);
    const first = w.svc.slug;
    for (const slug of ['second-name', 'third-name']) {
      await w.services.update(w.people.admin, w.svc.id, { slug });
    }
    expect(await w.history()).toEqual([first, 'second-name', 'third-name']);
    for (const slug of [first, 'second-name', 'third-name']) {
      expect((await w.services.getBySlug(w.people.plain, slug)).slug).toBe('third-name');
    }
  });

  it('never gives an old slug to another service: 409 naming the field, nothing else [ASVS-8.2.3]', async () => {
    const w = await world(h);
    const old = w.svc.slug;
    await w.services.update(w.people.admin, w.svc.id, { slug: 'moved-on' });
    const rival = await makeService(w.pool, { provider: w.other.id });
    const before = await w.row(rival.id);
    const error = await rejection(w.services.update(w.people.admin, rival.id, { slug: old }));
    expect(error).toMatchObject({
      status: 409,
      type: expect.stringContaining('slug-taken') as string,
    });
    expect(JSON.stringify((error as DomainError & { errors?: unknown }).errors)).toContain('slug');
    expect(JSON.stringify(error)).not.toContain(w.svc.id);
    expect(await w.row(rival.id)).toEqual(before);
    // The same through create.
    await expect(
      w.services.create(w.people.admin, { slug: old, name: uniq('Name'), provider: w.provider.id }),
    ).rejects.toMatchObject({ status: 409 });
    // And without regard to case.
    await expect(
      w.services.update(w.people.admin, rival.id, { slug: old.toUpperCase() }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses another service's current slug (409), in any case, and the answer does not say whose", async () => {
    const w = await world(h);
    const rival = await makeService(w.pool, { provider: w.other.id, slug: 'Rival-Slug' });
    for (const slug of ['Rival-Slug', 'rival-slug', 'RIVAL-SLUG']) {
      const error = await rejection(w.services.update(w.people.admin, w.svc.id, { slug }));
      expect(error).toMatchObject({ status: 409 });
      expect(JSON.stringify(error)).not.toContain(rival.id);
    }
    expect(await w.history()).toEqual([w.svc.slug]);
  });

  it('lets a service take back one of its own old slugs, and change only the case of its slug', async () => {
    const w = await world(h);
    const first = w.svc.slug;
    await w.services.update(w.people.admin, w.svc.id, { slug: 'detour' });
    await w.services.update(w.people.admin, w.svc.id, { slug: first });
    expect((await w.row()).slug).toBe(first);
    expect(await w.history()).toEqual([first, 'detour']);
    await w.services.update(w.people.admin, w.svc.id, { slug: first.toUpperCase() });
    expect((await w.row()).slug).toBe(first.toUpperCase());
    expect(await w.history()).toEqual([first.toUpperCase(), 'detour']);
    expect((await w.services.getBySlug(w.people.plain, first.toLowerCase())).id).toBe(w.svc.id);
  });

  it('is not a rename when the slug is the one it has, and no event is sent', async () => {
    const w = await world(h);
    await w.services.update(w.people.admin, w.svc.id, { slug: w.svc.slug });
    expect(await w.history()).toEqual([w.svc.slug]);
    expect((await w.events()).filter((e) => e.name.startsWith('registry.service.'))).toEqual([]);
  });

  it.each(['new', 'public', 'by-slug', 'facets', 'bad slug', '-leading', 'x'.repeat(65)])(
    'refuses the slug %j (422) and keeps the old one',
    async (slug) => {
      const w = await world(h);
      await expect(w.services.update(w.people.admin, w.svc.id, { slug })).rejects.toMatchObject({
        status: 422,
      });
      expect(await w.history()).toEqual([w.svc.slug]);
    },
  );

  it('refuses a slug shaped like an id (422)', async () => {
    const w = await world(h);
    await expect(
      w.services.update(w.people.admin, w.svc.id, { slug: '018f3b7e-0000-7000-8000-0000000000aa' }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe('writers that meet over one slug', () => {
  it('lets one of two renames to the same slug win and gives the other the 409', async () => {
    const w = await world(h);
    const second = await makeService(w.pool, { provider: w.other.id });
    const target = uniq('contested');
    const results = await Promise.allSettled([
      w.services.update(w.people.admin, w.svc.id, { slug: target }),
      w.services.update(w.people.admin, second.id, { slug: target }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ status: 409 });
    const owners = (
      await w.pool.query<{ service_id: string }>(
        'select service_id from svc_slug_history where lower(slug) = lower($1)',
        [target],
      )
    ).rows;
    expect(owners).toHaveLength(1);
    // The loser's service kept its own slug and history.
    const loserId = owners[0]!.service_id === w.svc.id ? second.id : w.svc.id;
    expect((await w.row(loserId)).slug).not.toBe(target);
    expect(await w.history(loserId)).toHaveLength(1);
  });

  it('decides a rename racing a create for the same slug: one 409, one service', async () => {
    const w = await world(h);
    const target = uniq('race');
    const results = await Promise.allSettled([
      w.services.update(w.people.admin, w.svc.id, { slug: target }),
      w.services.create(w.people.admin, {
        slug: target,
        name: uniq('Name'),
        provider: w.provider.id,
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason,
    ).toMatchObject({
      status: 409,
    });
    const { rows } = await w.pool.query(
      'select 1 from svc_slug_history where lower(slug) = lower($1)',
      [target],
    );
    expect(rows).toHaveLength(1);
    // No service row without its history row, and no history row without its service.
    const orphans = await w.pool.query(
      `select s.id from svc_service s where not exists (select 1 from svc_slug_history h where h.service_id = s.id and lower(h.slug) = lower(s.slug))`,
    );
    expect(orphans.rows).toEqual([]);
  });

  it('keeps one service when two members rename it at once to different slugs, and both slugs stay in the history', async () => {
    const w = await world(h);
    const [a, b] = [uniq('a'), uniq('b')];
    await Promise.all([
      w.services.update(w.people.manager, w.svc.id, { slug: a }),
      w.services.update(w.people.admin, w.svc.id, { slug: b }),
    ]);
    const history = await w.history();
    expect(history).toEqual(expect.arrayContaining([w.svc.slug, a, b]));
    expect(history).toHaveLength(3);
    expect([a, b]).toContain((await w.row()).slug);
  });

  it('keeps a rename that races a rename back consistent: the row slug is always in the history', async () => {
    const w = await world(h);
    const first = w.svc.slug;
    await Promise.allSettled([
      w.services.update(w.people.admin, w.svc.id, { slug: 'forth' }),
      w.services.update(w.people.admin, w.svc.id, { slug: first.toUpperCase() }),
    ]);
    const slug = (await w.row()).slug;
    expect((await w.history()).map((x) => x.toLowerCase())).toContain(slug.toLowerCase());
    expect((await w.services.getBySlug(w.people.plain, slug)).id).toBe(w.svc.id);
  });
});
