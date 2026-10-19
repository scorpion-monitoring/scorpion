// The storage `module` (ADR-0040 addendum) with both modules on real Postgres: the field type's `store` is called inside
// the create transaction with the new service's id, so what it writes commits or rolls back with the service; a field
// the body leaves out is not stored; a failure in `store` leaves no service, link or event.
import { z } from '@scorpion/contracts';
import { sql } from 'drizzle-orm';
import { makeOrganisation } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { fixtureContributor, useServices } from '../test/harness.ts';
import { rejection, uniq } from '../test/world.ts';

const h = useServices();

const calls: {
  serviceId: string;
  value: unknown;
  config: Record<string, unknown>;
  actorId: string | null;
}[] = [];
const note = {
  id: 'note-store',
  labels: { en: 'Note' },
  widget: 'note-store',
  storages: ['module'],
  configSchema: z.strictObject({}),
  schema: () => z.string().min(1).max(40),
  jsonSchema: () => ({ type: 'string', minLength: 1, maxLength: 40 }),
  // The module's own write, in the transaction it is given: here a row of `svc_field_value`, which the test can read.
  store: async (
    tx: { execute: (query: unknown) => Promise<unknown> },
    change: (typeof calls)[number],
  ) => {
    calls.push(change);
    if (change.value === 'boom') throw new Error('the module failed while it stored its value');
    await tx.execute(
      sql`insert into svc_field_value (id, service_id, field_key, value) values (gen_random_uuid(), ${change.serviceId}, 'ownNote', ${JSON.stringify(change.value)}::jsonb)`,
    );
  },
};
const step = {
  id: 'own',
  order: 15,
  title: 'fixture.step.own.title',
  intro: [],
  fields: [
    {
      key: 'ownNote',
      path: '/ownNote',
      type: 'note-store',
      label: 'fixture.field.own.label',
      storage: { kind: 'module' },
    },
  ],
};
const withNote = () =>
  fixtureContributor({
    contributes: { 'service.fieldType': [note], 'service.wizardStep': [step] },
  });

async function start() {
  const s = await h.start({ extra: [withNote()] });
  const admin = await s.actor('admin');
  const provider = await makeOrganisation(s.pool, { type: 'provider' });
  const count = async (table: string) =>
    Number(
      (await s.pool.query<{ n: string }>(`select count(*)::text as n from ${table}`)).rows[0]!.n,
    );
  const body = (extra: Record<string, unknown> = {}) => ({
    slug: uniq(),
    name: 'Module storage service',
    provider: provider.id,
    ...extra,
  });
  return { s, admin, count, body };
}

describe('the storage `module`', () => {
  it('calls `store` once, in the create transaction, with the new service and the validated value', async () => {
    calls.length = 0;
    const { s, admin, body } = await start();
    const created = await s.services.create(admin, body({ ownNote: 'hello' }));
    expect(calls).toEqual([
      { serviceId: created.id, value: 'hello', config: {}, actorId: admin.userId },
    ]);
    const stored = await s.pool.query<{ value: unknown }>(
      "select value from svc_field_value where service_id = $1 and field_key = 'ownNote'",
      [created.id],
    );
    expect(stored.rows.map((row) => row.value)).toEqual(['hello']);
  });

  it('does not call `store` for a field the body leaves out', async () => {
    calls.length = 0;
    const { s, admin, body } = await start();
    await s.services.create(admin, body());
    expect(calls).toEqual([]);
  });

  it('takes the service, its links, its history and its event back when `store` throws', async () => {
    const { s, admin, body, count } = await start();
    const before = {
      service: await count('svc_service'),
      links: await count('svc_service_organisation'),
      history: await count('svc_slug_history'),
      values: await count('svc_field_value'),
      events: await count('kernel_outbox'),
    };
    await expect(s.services.create(admin, body({ ownNote: 'boom' }))).rejects.toThrow(
      /the module failed/,
    );
    expect({
      service: await count('svc_service'),
      links: await count('svc_service_organisation'),
      history: await count('svc_slug_history'),
      values: await count('svc_field_value'),
      events: await count('kernel_outbox'),
    }).toEqual(before);
  });

  it('judges the value with the type before the transaction: a bad value is 422 on the field and `store` is not called', async () => {
    calls.length = 0;
    const { s, admin, body } = await start();
    const error = await rejection(s.services.create(admin, body({ ownNote: '' })));
    expect(error.status).toBe(422);
    expect(error.errors?.[0]?.path).toBe('ownNote');
    expect(calls).toEqual([]);
  });

  it('is not in `editableFields` and a patch that names it is 422', async () => {
    const { s, admin, body } = await start();
    const created = await s.services.create(admin, body({ ownNote: 'x' }));
    const view = await s.services.get(admin, created.id);
    expect(view.editableFields).not.toContain('ownNote');
    expect(view.editableFields).toContain('name');
    const error = await rejection(s.services.update(admin, created.id, { ownNote: 'y' }));
    expect(error.status).toBe(422);
    expect(error.errors?.[0]?.path).toBe('ownNote');
  });
});
