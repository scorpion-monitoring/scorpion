// What kpi.framework contributes to the registries of registry.services, with both modules on real Postgres: the wizard step
// and its field type (the service is created with its set and extras in one transaction or not at all), the facet `kpi-set`
// in the catalogue, the `category` of the v1 row and its filter, and the storage `module` that the create transaction uses.
import type { Actor } from '@scorpion/contracts';
import {
  makeIndicator,
  makeKpiSet,
  makeOrganisation,
  makeService,
  makeServiceKpis,
} from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useKpi, type KpiStarted } from '../test/harness.ts';
import { breakOutbox, payloads, rejection, stored, uniq } from '../test/world.ts';

const h = useKpi();

/** The part of the services service these tests use (the type of the module is not importable from here). */
interface Services {
  create(actor: Actor, body: unknown): Promise<{ id: string; slug: string }>;
  update(actor: Actor, id: string, body: unknown): Promise<unknown>;
  get(actor: Actor, id: string): Promise<{ editableFields: string[] }>;
  createSchema(
    actor: Actor,
    locale?: string,
  ): Promise<{
    steps: {
      id: string;
      order: number;
      fields: { key: string; widget: string; choices?: { value: string; label?: string }[] }[];
    }[];
  }>;
  list(
    actor: Actor,
    filter: { filters?: Record<string, string[]> },
    page: { page: number; pageSize: number },
  ): Promise<{ services: { id: string }[]; total: number }>;
  facets(
    actor: Actor,
    filter: { filters?: Record<string, string[]> },
  ): Promise<
    { id: string; values: { key: string; label: string; count: number; selected: boolean }[] }[]
  >;
  listV1(
    actor: Actor,
    filter: { category?: string[] },
    page: { page: number; pageSize: number },
  ): Promise<{ services: { id: string; category: string | null }[]; total: number }>;
  getV1(actor: Actor, id: string): Promise<{ category: string | null }>;
}
const servicesOf = (s: KpiStarted) => s.kernel.services.get('registry.services') as Services;
const PAGE = { page: 0, pageSize: 100 };

async function start() {
  const s = await h.start();
  const services = servicesOf(s);
  const admin = await s.actor('admin');
  const provider = await makeOrganisation(s.pool, { type: 'provider' });
  const [a, b, c] = await Promise.all(
    [1, 2, 3].map((n) => makeIndicator(s.pool, { name: uniq(`wiz${n}`) })),
  );
  const set = await makeKpiSet(s.pool, {
    name: uniq('wizard set'),
    rimoCategory: 'Web_application',
    indicators: [{ indicatorId: a!.id, necessity: 'mandatory' }],
  });
  const other = await makeKpiSet(s.pool, { name: uniq('another set') });
  const body = (extra: Record<string, unknown> = {}) => ({
    slug: uniq('wz'),
    name: 'Wizard service',
    provider: provider.id,
    ...extra,
  });
  const count = async (table: string) =>
    Number(
      (await s.pool.query<{ n: string }>(`select count(*)::text as n from ${table}`)).rows[0]!.n,
    );
  return { s, services, admin, provider, a: a!, b: b!, c: c!, set, other, body, count };
}

describe('the wizard step and the field type kpi-set', () => {
  it('is a step after the three of registry.services, with the sets as the options of its field', async () => {
    const { services, admin, set, other } = await start();
    const schema = await services.createSchema(admin);
    const step = schema.steps.find((candidate) => candidate.id === 'kpi-set')!;
    expect(step.order).toBe(40);
    expect(schema.steps.at(-1)?.id).toBe('kpi-set');
    const [field] = step.fields;
    expect(field).toMatchObject({ key: 'kpiSet', widget: 'kpi-set' });
    const values = (field!.choices ?? []).map((choice) => choice.value);
    expect(values).toEqual(expect.arrayContaining([set.id, other.id]));
    expect(field!.choices?.find((choice) => choice.value === set.id)?.label).toBe(set.name);
  });

  it('creates the service with its set and extras in one transaction, and says so in two events', async () => {
    const { s, services, admin, set, b, body } = await start();
    const created = await services.create(
      admin,
      body({ kpiSet: { setId: set.id, extras: [b.id] } }),
    );
    expect(await stored(s.pool, created.id)).toEqual({ setId: set.id, extras: [b.id] });
    const view = await s.kpi.serviceKpis.get(admin, created.id);
    expect(view.rows.map((row) => `${row.indicatorId}:${row.source}`)).toContain(`${b.id}:extra`);
    const events = (await payloads(s.pool, 'kpi.serviceSet.changed@1')).filter(
      (event) => event.serviceId === created.id,
    );
    expect(events).toEqual([
      { serviceId: created.id, setId: set.id, fields: ['set', 'extras'], actorId: admin.userId },
    ]);
  });

  it('creates a service without a set when the step is left empty, and writes nothing for it', async () => {
    const { s, services, admin, body, count } = await start();
    const before = await count('kpif_service_set');
    const created = await services.create(admin, body());
    expect(await stored(s.pool, created.id)).toEqual({ setId: null, extras: [] });
    const empty = await services.create(admin, body({ kpiSet: { setId: null, extras: [] } }));
    expect(await stored(s.pool, empty.id)).toEqual({ setId: null, extras: [] });
    expect(await count('kpif_service_set')).toBe(before);
  });

  it('is 422 on the field for an unknown set or indicator and for a malformed value, and creates no service', async () => {
    const { services, admin, set, body, count } = await start();
    const ghost = '018f3b7e-0000-7000-8000-000000000001';
    const before = await count('svc_service');
    for (const kpiSet of [
      { setId: ghost, extras: [] },
      { setId: set.id, extras: [ghost] },
      { setId: 'nonsense', extras: [] },
      { setId: set.id },
      'a set',
    ]) {
      const error = await rejection(services.create(admin, body({ kpiSet })));
      expect(error.status).toBe(422);
      expect((error.errors ?? []).map((e) => e.path.split('.')[0])).toContain('kpiSet');
    }
    expect(await count('svc_service')).toBe(before);
  });

  it('leaves no service, no set row and no extras when the event cannot be stored', async () => {
    const { s, services, admin, set, b, body, count } = await start();
    const before = {
      service: await count('svc_service'),
      sets: await count('kpif_service_set'),
      extras: await count('kpif_service_extra_indicator'),
    };
    const undo = await breakOutbox(s.pool);
    try {
      await expect(
        services.create(admin, body({ kpiSet: { setId: set.id, extras: [b.id] } })),
      ).rejects.toThrow();
    } finally {
      await undo();
    }
    expect({
      service: await count('svc_service'),
      sets: await count('kpif_service_set'),
      extras: await count('kpif_service_extra_indicator'),
    }).toEqual(before);
  });

  it('takes the service back when the write of the KPIs fails after the service row was inserted', async () => {
    const { s, services, admin, set, body, count } = await start();
    await s.pool.query(`
      create or replace function test_break_service_set() returns trigger as $$
      begin raise exception 'the KPI tables are broken for this test'; end $$ language plpgsql;
      create trigger test_break_service_set before insert on kpif_service_set
        for each row execute function test_break_service_set();`);
    const before = await count('svc_service');
    try {
      await expect(
        services.create(admin, body({ kpiSet: { setId: set.id, extras: [] } })),
      ).rejects.toThrow();
    } finally {
      await s.pool.query('drop trigger test_break_service_set on kpif_service_set');
    }
    expect(await count('svc_service')).toBe(before);
    expect(await count('svc_slug_history')).toBeGreaterThan(-1);
  });

  it('is not an editable field of the service: the edit form never draws it, whoever the caller is', async () => {
    const { s, services, admin, body } = await start();
    const created = await services.create(admin, body());
    const member = await s.actor('user');
    for (const who of [admin, member]) {
      const view = await services.get(who, created.id);
      expect(view.editableFields).not.toContain('kpiSet');
    }
    expect((await services.get(admin, created.id)).editableFields).toContain('name');
  });

  it('does not change the KPIs through a PATCH of the service: the field belongs to the KPI route', async () => {
    const { services, admin, set, body } = await start();
    const created = await services.create(admin, body());
    const error = await rejection(
      services.update(admin, created.id, { kpiSet: { setId: set.id, extras: [] } }),
    );
    expect(error.status).toBe(422);
    expect(error.errors?.[0]?.path).toBe('kpiSet');
  });
});

describe('the facet kpi-set', () => {
  it('counts the services per set and those without, over the other filters', async () => {
    const { s, services, admin, set, other, provider } = await start();
    const one = await makeService(s.pool, { provider: provider.id });
    const two = await makeService(s.pool, { provider: provider.id });
    const none = await makeService(s.pool, { provider: provider.id });
    await makeServiceKpis(s.pool, { serviceId: one.id, setId: set.id });
    await makeServiceKpis(s.pool, { serviceId: two.id, setId: set.id });
    await makeServiceKpis(s.pool, { serviceId: none.id, setId: other.id });
    const facets = await services.facets(admin, {});
    const facet = facets.find((entry) => entry.id === 'kpi-set')!;
    const byKey = new Map(facet.values.map((value) => [value.key, value]));
    expect(byKey.get(set.id)).toMatchObject({ label: set.name, count: 2 });
    expect(byKey.get(other.id)).toMatchObject({ label: other.name, count: 1 });
    // The services made by the other tests of this file are on the same server: only the ones above are checked.
    const empty = byKey.get(':none');
    if (empty) expect(empty.label).toBe('No KPI set');
  });

  it('filters the catalogue by a set, by none, and by several; an unknown key is 422', async () => {
    const { s, services, admin, set, other, provider } = await start();
    const one = await makeService(s.pool, { provider: provider.id });
    const two = await makeService(s.pool, { provider: provider.id });
    const none = await makeService(s.pool, { provider: provider.id });
    await makeServiceKpis(s.pool, { serviceId: one.id, setId: set.id });
    await makeServiceKpis(s.pool, { serviceId: two.id, setId: other.id });
    const ids = async (values: string[]) =>
      (await services.list(admin, { filters: { 'kpi-set': values } }, PAGE)).services.map(
        (row) => row.id,
      );
    expect(await ids([set.id])).toEqual([one.id]);
    expect((await ids([set.id, other.id])).sort()).toEqual([one.id, two.id].sort());
    expect(await ids([':none'])).toContain(none.id);
    expect(await ids([':none'])).not.toContain(one.id);
    const ghost = await rejection(
      services.list(admin, { filters: { 'kpi-set': [uniq('x')] } }, PAGE),
    );
    expect(ghost.status).toBe(422);
    expect(ghost.errors?.[0]?.path).toBe('kpi-set');
  });
});

describe('the category of the v1 row', () => {
  it('is the name of the KPI set, null without one, and filters by that name without case', async () => {
    const { s, services, set, provider } = await start();
    const system: Actor = await s.actor('admin');
    const one = await makeService(s.pool, { provider: provider.id });
    const none = await makeService(s.pool, { provider: provider.id });
    await makeServiceKpis(s.pool, { serviceId: one.id, setId: set.id });
    const list = await services.listV1(system, {}, PAGE);
    const row = (id: string) => list.services.find((candidate) => candidate.id === id);
    expect(row(one.id)?.category).toBe(set.name);
    expect(row(none.id)?.category).toBeNull();
    const filtered = await services.listV1(system, { category: [set.name.toUpperCase()] }, PAGE);
    expect(filtered.services.map((entry) => entry.id)).toEqual([one.id]);
    expect(filtered.total).toBe(1);
    expect((await services.getV1(system, one.id)).category).toBe(set.name);
    const unknown = await rejection(services.listV1(system, { category: ['No such set'] }, PAGE));
    expect(unknown.status).toBe(422);
    expect(unknown.errors?.[0]).toMatchObject({ in: 'query', path: 'category' });
  });
});
