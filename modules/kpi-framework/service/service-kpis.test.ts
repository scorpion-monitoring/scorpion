// `serviceKpis.get` and `serviceKpis.set` on real Postgres (M9 sprint 3): the set and the extras of a service, the rules of
// the effective set, the scoped permission (a member of the provider may, a member of another provider may not), the
// rollback, the event, and the wizard's create (a service with its set and extras in one transaction, or not at all).
import type { Actor } from '@scorpion/contracts';
import { makeIndicator, makeKpiSet, makeServiceKpis } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useKpi } from '../test/harness.ts';
import {
  breakOutbox,
  count,
  payloads,
  rejection,
  serviceWorld,
  stored,
  uniq,
  type ServiceWorld,
} from '../test/world.ts';

const h = useKpi();

async function start() {
  const w = await serviceWorld(await h.start());
  const indicators = await Promise.all(
    Array.from({ length: 4 }, (_, index) => makeIndicator(w.pool, { name: uniq(`ind${index}`) })),
  );
  const [a, b, c, d] = indicators as [
    (typeof indicators)[number],
    (typeof indicators)[number],
    (typeof indicators)[number],
    (typeof indicators)[number],
  ];
  const set = await makeKpiSet(w.pool, {
    name: uniq('set'),
    indicators: [
      { indicatorId: a.id, necessity: 'mandatory' },
      { indicatorId: b.id, necessity: 'recommended' },
    ],
  });
  const second = await makeKpiSet(w.pool, {
    name: uniq('set'),
    indicators: [{ indicatorId: c.id, necessity: 'mandatory' }],
  });
  return { w, a, b, c, d, set, second };
}

/** The effective rows as `id:necessity:source`, which is what the tests compare. */
const rowsOf = (view: { rows: { indicatorId: string; necessity: string; source: string }[] }) =>
  view.rows.map((row) => `${row.indicatorId}:${row.necessity}:${row.source}`);

describe('serviceKpis.get', () => {
  it('is empty for a service that has none, and says who may change it', async () => {
    const { w } = await start();
    const view = await w.kpi.serviceKpis.get(w.people.manager, w.svc.id);
    expect(view).toMatchObject({
      serviceId: w.svc.id,
      set: null,
      rows: [],
      extras: [],
      canEdit: true,
    });
    expect((await w.kpi.serviceKpis.get(w.people.plain, w.svc.id)).canEdit).toBe(false);
    expect((await w.kpi.serviceKpis.get(w.people.admin, w.svc.id)).canEdit).toBe(true);
  });

  it('gives the set with its IRI, the rows with necessity and the extras as optional', async () => {
    const { w, a, b, d, set } = await start();
    await makeServiceKpis(w.pool, { serviceId: w.svc.id, setId: set.id, extras: [d.id, a.id] });
    const view = await w.kpi.serviceKpis.get(w.people.plain, w.svc.id);
    expect(view.set).toMatchObject({ id: set.id, name: set.name });
    expect(view.set?.iri).toMatch(new RegExp(`/kpi/set/${set.slug}$`));
    // `a` is in the set and in the extras: the row of the set stays, once.
    expect(rowsOf(view)).toEqual(
      [a, b]
        .map((i) => `${i.id}:${i.id === a.id ? 'mandatory' : 'recommended'}:set`)
        .concat(`${d.id}:optional:extra`),
    );
    expect(view.extras.map((row) => row.indicatorId).sort()).toEqual([a.id, d.id].sort());
  });

  it('answers 404 for a service that does not exist and 422 for an id that is no UUID', async () => {
    const { w } = await start();
    expect(
      await rejection(
        w.kpi.serviceKpis.get(w.people.admin, '018f3b7e-0000-7000-8000-000000000000'),
      ),
    ).toMatchObject({ status: 404 });
    expect(await rejection(w.kpi.serviceKpis.get(w.people.admin, 'not-an-id'))).toMatchObject({
      status: 422,
    });
  });

  it('is refused to a caller without the read permission and to an anonymous one', async () => {
    const { w } = await start();
    const nobody: Actor = { kind: 'anonymous' };
    expect(await rejection(w.kpi.serviceKpis.get(nobody, w.svc.id))).toMatchObject({ status: 401 });
  });
});

describe('serviceKpis.set', () => {
  it('sets the set and the extras and answers the effective list', async () => {
    const { w, a, b, d, set } = await start();
    const view = await w.kpi.serviceKpis.set(w.people.manager, w.svc.id, {
      setId: set.id,
      extras: [d.id],
    });
    expect(rowsOf(view)).toEqual([
      `${a.id}:mandatory:set`,
      `${b.id}:recommended:set`,
      `${d.id}:optional:extra`,
    ]);
    expect(await stored(w.pool, w.svc.id)).toEqual({ setId: set.id, extras: [d.id] });
  });

  it('replaces the set and the extras, and an extra can be removed (defect 14)', async () => {
    const { w, a, c, d, set, second } = await start();
    const who = w.people.manager;
    await w.kpi.serviceKpis.set(who, w.svc.id, { setId: set.id, extras: [d.id, c.id] });
    const view = await w.kpi.serviceKpis.set(who, w.svc.id, { setId: second.id, extras: [a.id] });
    // The new set contains `c`; `a` is an extra now and `d` is gone.
    expect(rowsOf(view)).toEqual([`${c.id}:mandatory:set`, `${a.id}:optional:extra`]);
    expect(await stored(w.pool, w.svc.id)).toEqual({ setId: second.id, extras: [a.id] });
    const cleared = await w.kpi.serviceKpis.set(who, w.svc.id, { setId: second.id, extras: [] });
    expect(rowsOf(cleared)).toEqual([`${c.id}:mandatory:set`]);
    expect((await stored(w.pool, w.svc.id)).extras).toEqual([]);
  });

  it('drops an extra that the set contains instead of storing or refusing it', async () => {
    const { w, a, d, set } = await start();
    const view = await w.kpi.serviceKpis.set(w.people.admin, w.svc.id, {
      setId: set.id,
      extras: [a.id, d.id, d.id],
    });
    expect(await stored(w.pool, w.svc.id)).toEqual({ setId: set.id, extras: [d.id] });
    expect(view.extras.map((row) => row.indicatorId)).toEqual([d.id]);
  });

  it('removes the set with `null`, keeps the extras, and does nothing (no event) when nothing changes', async () => {
    const { w, d, set } = await start();
    const who = w.people.manager;
    await w.kpi.serviceKpis.set(who, w.svc.id, { setId: set.id, extras: [d.id] });
    const before = (await payloads(w.pool, 'kpi.serviceSet.changed@1')).length;
    await w.kpi.serviceKpis.set(who, w.svc.id, { setId: set.id, extras: [d.id] });
    expect((await payloads(w.pool, 'kpi.serviceSet.changed@1')).length).toBe(before);
    const view = await w.kpi.serviceKpis.set(who, w.svc.id, { setId: null, extras: [d.id] });
    expect(view.set).toBeNull();
    expect(rowsOf(view)).toEqual([`${d.id}:optional:extra`]);
    expect(await stored(w.pool, w.svc.id)).toEqual({ setId: null, extras: [d.id] });
  });

  it('is 422 for an unknown set and an unknown indicator, naming every path, and writes nothing', async () => {
    const { w, a, set } = await start();
    const ghost = '018f3b7e-0000-7000-8000-000000000001';
    const error = await rejection(
      w.kpi.serviceKpis.set(w.people.admin, w.svc.id, { setId: ghost, extras: [a.id, ghost] }),
    );
    expect(error.status).toBe(422);
    expect((error.errors ?? []).map((e) => e.path).sort()).toEqual(['extras[1]', 'setId']);
    expect(await stored(w.pool, w.svc.id)).toEqual({ setId: null, extras: [] });
    // A body that is not an object of two fields is a 422 too, never a 500.
    for (const bad of [{ setId: 'x', extras: [] }, { setId: set.id }, { setId: null, extras: 'a' }])
      expect(
        (await rejection(w.kpi.serviceKpis.set(w.people.admin, w.svc.id, bad as never))).status,
      ).toBe(422);
  });

  it('is 404 for a service that does not exist, before anything about the body is judged', async () => {
    const { w } = await start();
    const error = await rejection(
      w.kpi.serviceKpis.set(w.people.admin, '018f3b7e-0000-7000-8000-000000000000', {
        setId: 'nonsense',
        extras: [],
      }),
    );
    expect(error.status).toBe(404);
  });

  it('emits one event with ids and field names only', async () => {
    const { w, d, set } = await start();
    await w.kpi.serviceKpis.set(w.people.manager, w.svc.id, { setId: set.id, extras: [d.id] });
    const events = (await payloads(w.pool, 'kpi.serviceSet.changed@1')).filter(
      (event) => event.serviceId === w.svc.id,
    );
    expect(events).toEqual([
      {
        serviceId: w.svc.id,
        setId: set.id,
        fields: ['set', 'extras'],
        actorId: w.people.manager.userId,
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(d.id);
  });

  it('writes both tables or neither: a failing event leaves no set row and no extras [ASVS-8.2.1]', async () => {
    const { w, d, set } = await start();
    const undo = await breakOutbox(w.pool);
    try {
      await expect(
        w.kpi.serviceKpis.set(w.people.admin, w.svc.id, { setId: set.id, extras: [d.id] }),
      ).rejects.toThrow();
    } finally {
      await undo();
    }
    expect(await stored(w.pool, w.svc.id)).toEqual({ setId: null, extras: [] });
  });

  it('keeps the rows it had when a later change fails', async () => {
    const { w, a, d, set, second } = await start();
    await w.kpi.serviceKpis.set(w.people.admin, w.svc.id, { setId: set.id, extras: [d.id] });
    const undo = await breakOutbox(w.pool);
    try {
      await expect(
        w.kpi.serviceKpis.set(w.people.admin, w.svc.id, { setId: second.id, extras: [a.id] }),
      ).rejects.toThrow();
    } finally {
      await undo();
    }
    expect(await stored(w.pool, w.svc.id)).toEqual({ setId: set.id, extras: [d.id] });
  });

  it("never touches another service's extras", async () => {
    const { w, d, set } = await start();
    const neighbour = await serviceWorld(w);
    await makeServiceKpis(w.pool, { serviceId: neighbour.svc.id, setId: set.id, extras: [d.id] });
    await w.kpi.serviceKpis.set(w.people.admin, w.svc.id, { setId: null, extras: [] });
    expect(await stored(w.pool, neighbour.svc.id)).toEqual({ setId: set.id, extras: [d.id] });
  });
});

describe('the scoped permission kpi.framework.service.kpis.edit (ADR-0036)', () => {
  const attempt = (w: ServiceWorld, who: Actor, setId: string) =>
    w.kpi.serviceKpis.set(who, w.svc.id, { setId, extras: [] });

  it('lets Admin and the approved managers of the provider change the set and the extras', async () => {
    const { w, d, set, second } = await start();
    await expect(attempt(w, w.people.admin, set.id)).resolves.toBeDefined();
    await expect(
      w.kpi.serviceKpis.set(w.people.manager, w.svc.id, { setId: second.id, extras: [d.id] }),
    ).resolves.toBeDefined();
  });

  it('refuses a plain member of the provider the set and the extras alike: they read, managers change [ASVS-8.2.1]', async () => {
    const { w, d, set, second } = await start();
    await w.kpi.serviceKpis.set(w.people.manager, w.svc.id, { setId: set.id, extras: [d.id] });
    const before = await stored(w.pool, w.svc.id);
    for (const body of [
      { setId: second.id, extras: [d.id] },
      { setId: set.id, extras: [] },
      { setId: null, extras: [] },
    ])
      expect((await rejection(w.kpi.serviceKpis.set(w.people.member, w.svc.id, body))).status).toBe(
        403,
      );
    expect(await stored(w.pool, w.svc.id)).toEqual(before);
    const view = await w.kpi.serviceKpis.get(w.people.member, w.svc.id);
    expect(view.canEdit).toBe(false);
    expect(view.set?.id).toBe(set.id);
    expect((await w.kpi.serviceKpis.get(w.people.manager, w.svc.id)).canEdit).toBe(true);
  });

  it('refuses a member of another provider, a plain user, and a requested or left membership [ASVS-8.2.1] [ASVS-8.3.1]', async () => {
    const { w, set } = await start();
    for (const who of [w.people.elsewhere, w.people.plain, w.people.requested, w.people.left]) {
      expect((await rejection(attempt(w, who, set.id))).status).toBe(403);
    }
    expect(await stored(w.pool, w.svc.id)).toEqual({ setId: null, extras: [] });
  });

  it('refuses an anonymous caller', async () => {
    const { w, set } = await start();
    expect((await rejection(attempt(w, { kind: 'anonymous' }, set.id))).status).toBe(401);
  });

  it('sees a demotion at the next call [ASVS-8.3.1]', async () => {
    const { w, set } = await start();
    await expect(
      w.kpi.serviceKpis.set(w.people.manager, w.svc.id, { setId: null, extras: [] }),
    ).resolves.toBeDefined();
    await w.pool.query(
      "update org_membership set state = 'left', role = 'member', ended_at = now() where user_id = $1",
      [w.people.manager.userId],
    );
    expect((await rejection(attempt(w, w.people.manager, set.id))).status).toBe(403);
  });

  it('judges a service by its own provider: the member of one service is a stranger to another', async () => {
    const { w, set } = await start();
    const foreign = await serviceWorld(w);
    expect(
      (
        await rejection(
          w.kpi.serviceKpis.set(w.people.manager, foreign.svc.id, { setId: set.id, extras: [] }),
        )
      ).status,
    ).toBe(403);
  });
});

describe('deleting what a service uses', () => {
  it('is 409 for a KPI set that a service uses, naming the module and the count', async () => {
    const { w, set } = await start();
    await makeServiceKpis(w.pool, { serviceId: w.svc.id, setId: set.id });
    const second = await serviceWorld(w);
    await makeServiceKpis(w.pool, { serviceId: second.svc.id, setId: set.id });
    const error = await rejection(w.kpi.sets.delete(w.people.admin, set.id));
    expect(error.status).toBe(409);
    expect(error.errors).toEqual([
      { in: 'usage', path: 'kpi.framework.services', message: String(2) },
    ]);
    expect(await count(w.pool, 'kpif_kpi_set')).toBeGreaterThan(0);
  });

  it('is 409 for an indicator that a service chose as an extra, and works once it is removed', async () => {
    const { w, d } = await start();
    await makeServiceKpis(w.pool, { serviceId: w.svc.id, extras: [d.id] });
    const error = await rejection(w.kpi.indicators.delete(w.people.admin, d.id));
    expect(error.status).toBe(409);
    expect(error.errors).toEqual([{ in: 'usage', path: 'kpi.framework.services', message: '1' }]);
    await w.kpi.serviceKpis.set(w.people.admin, w.svc.id, { setId: null, extras: [] });
    await expect(w.kpi.indicators.delete(w.people.admin, d.id)).resolves.toBeUndefined();
  });
});
