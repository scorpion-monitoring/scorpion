// The prototype of M7 sprint 5 and the contract of the schema service: with the real kernel and Postgres,
// `createSchema` is generated from the resolved configuration and the registries, one JSON Schema per step;
// the same entries validate a body on `create`; a step another module contributes appears in order, its
// value is stored in `svc_field_value`, its server rules run, and a failure inside the transaction takes the
// whole creation back. Denied cases: anonymous 401, a person without roles 403.
import { z } from '@scorpion/contracts';
import { makeMembership, makeOrganisation } from '@scorpion/testing';
import { checkJsonSchema } from '@scorpion/ui-kit/json-schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { devConsoleAllowed } from '../module.ts';
import { fixtureContributor, useServices } from '../test/harness.ts';
import { rejection, uniq } from '../test/world.ts';

const h = useServices();
afterEach(() => vi.unstubAllEnvs());

let toValueCalls = 0;
// A field type like the `kpi-set` one M9 will contribute: own schema, own widget, a value of its own.
const kpiSet = {
  id: 'kpi-set',
  labels: { en: 'KPI set' },
  widget: 'kpi-set',
  storages: ['value'],
  configSchema: z.strictObject({}),
  schema: () => z.string().min(1).max(40),
  jsonSchema: () => ({ type: 'string', minLength: 1, maxLength: 40 }),
  check: (value: unknown) =>
    Promise.resolve(value === 'unlisted' ? { problem: 'This set is not listed.' } : undefined),
  // `boom` stands for a bug in the contributing module that only shows inside the transaction.
  toValue: (value: unknown) => {
    toValueCalls += 1;
    if (value === 'boom')
      throw new Error('the contributed module failed while it stored its value');
    return { set: value };
  },
};
const categoryStep = {
  id: 'category',
  order: 15,
  title: 'fixture.step.category.title',
  intro: ['fixture.step.category.intro'],
  fields: [
    {
      key: 'category',
      path: '/category',
      type: 'kpi-set',
      label: 'fixture.field.category.label',
      required: true,
      storage: { kind: 'value' },
    },
  ],
  applies: () => true,
};
const withCategory = () =>
  fixtureContributor({
    contributes: { 'service.fieldType': [kpiSet], 'service.wizardStep': [categoryStep] },
  });

async function counts(pool: { query: (sql: string) => Promise<{ rows: { n: string }[] }> }) {
  const one = async (table: string) =>
    Number((await pool.query(`select count(*)::text as n from ${table}`)).rows[0]!.n);
  return {
    service: await one('svc_service'),
    links: await one('svc_service_organisation'),
    values: await one('svc_field_value'),
    history: await one('svc_slug_history'),
    created: Number(
      (
        await pool.query(
          "select count(*)::text as n from kernel_outbox where name = 'registry.service.created@1'",
        )
      ).rows[0]!.n,
    ),
  };
}

describe('the schema service', () => {
  it('is generated from the resolved configuration: steps, fields, schemas, limits, roles and the stage options from the vocabulary', async () => {
    const s = await h.start();
    const member = await s.actor('user');
    const schema = await s.services.createSchema(member);
    expect(schema.steps.map((step) => step.id)).toEqual(['basics', 'provision', 'contact']);
    expect(schema.roles.map((role) => role.id)).toEqual(['provider', 'consortium']);
    expect(schema.limits.sameAs).toBe(20);
    expect(schema.defaults).toEqual({ stage: 'DEV', sameAs: [], consortia: [] });
    // The options of the stage field are the active terms of the vocabulary, in the caller's language.
    const stage = schema.steps[0]!.fields.find((field) => field.key === 'stage')!;
    expect(stage.choices?.map((choice) => choice.value)).toEqual(
      expect.arrayContaining(['DEV', 'PROD']),
    );
    expect(stage.choices?.every((choice) => choice.label !== undefined)).toBe(true);
    const german = await s.services.createSchema(member, 'de');
    const stageDe = german.steps[0]!.fields.find((field) => field.key === 'stage')!;
    // A term with no German label falls back to its English one, as the vocabulary does everywhere.
    expect(stageDe.choices).toEqual(stage.choices);
  });

  it('holds nothing of any person or service', async () => {
    const s = await h.start();
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    const member = await s.actor('user');
    const text = JSON.stringify(await s.services.createSchema(member));
    expect(text).not.toContain(provider.id);
    expect(text).not.toContain(provider.name);
  });

  it('is denied to an anonymous caller (401), a person without roles (403) and a Reviewer, who may not create', async () => {
    const s = await h.start();
    expect(await rejection(s.services.createSchema({ kind: 'anonymous' }))).toMatchObject({
      status: 401,
    });
    expect(await rejection(s.services.createSchema(await s.actor()))).toMatchObject({
      status: 403,
    });
    expect(await rejection(s.services.createSchema(await s.actor('reviewer')))).toMatchObject({
      status: 403,
    });
  });

  it('tells the wizard whether the JSON console may be shown: yes outside production, never in production', async () => {
    const dev = await h.start();
    expect((await dev.services.createSchema(await dev.actor('user'))).devConsole).toBe(true);
    const forced = await h.start({ devConsole: false });
    expect((await forced.services.createSchema(await forced.actor('user'))).devConsole).toBe(false);
    // The default follows NODE_ENV when the server starts.
    vi.stubEnv('NODE_ENV', 'production');
    const production = await h.start();
    expect(
      (await production.services.createSchema(await production.actor('user'))).devConsole,
    ).toBe(false);
    expect(devConsoleAllowed('production')).toBe(false);
    for (const env of ['development', 'test', undefined, '']) {
      expect(devConsoleAllowed(env), String(env)).toBe(true);
    }
  });

  it('serves the schema the server then validates with: a body that passes every step is accepted by create, one the schema refuses is a 422 at the same field', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    const schema = await s.services.createSchema(admin);
    const body = { slug: uniq(), name: 'Wizard service', provider: provider.id };
    for (const step of schema.steps) {
      const part = Object.fromEntries(
        Object.entries(body).filter(([key]) =>
          step.fields.some((field) => field.path === `/${key}`),
        ),
      );
      expect(checkJsonSchema(step.schema, part), step.id).toEqual([]);
    }
    const created = await s.services.create(admin, body);
    expect(created.name).toBe('Wizard service');

    // The step the browser refuses names the same field the server does.
    const bad = { ...body, slug: 'a b' };
    const basics = schema.steps[0]!;
    expect(checkJsonSchema(basics.schema, { slug: bad.slug, name: bad.name })).toEqual([
      { pointer: '/slug', keyword: 'pattern' },
    ]);
    expect(await rejection(s.services.create(admin, bad))).toMatchObject({
      status: 422,
      errors: [{ path: 'slug' }],
    });
  });
});

describe('a step another module contributes', () => {
  it('appears in the schema in order, and its widget and server rules come with it', async () => {
    const s = await h.start({ extra: [withCategory()] });
    const member = await s.actor('user');
    const schema = await s.services.createSchema(member);
    expect(schema.steps.map((step) => step.id)).toEqual([
      'basics',
      'category',
      'provision',
      'contact',
    ]);
    const step = schema.steps[1]!;
    expect(step).toMatchObject({ contributed: true, title: 'fixture.step.category.title' });
    expect(step.fields[0]).toMatchObject({ key: 'category', widget: 'kpi-set', required: true });
    expect(checkJsonSchema(step.schema, {})).toEqual([
      { pointer: '/category', keyword: 'required' },
    ]);
    expect(checkJsonSchema(step.schema, { category: 'genomics' })).toEqual([]);
    expect(JSON.stringify(schema)).not.toContain('applies');
    expect(schema.fieldTypes.find((type) => type.id === 'kpi-set')).toMatchObject({
      widget: 'kpi-set',
    });
  });

  it('stores its value in svc_field_value with the service, and runs its own server validation', async () => {
    const s = await h.start({ extra: [withCategory()] });
    const admin = await s.actor('admin');
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    const created = await s.services.create(admin, {
      slug: uniq(),
      name: 'With a category',
      provider: provider.id,
      category: 'genomics',
    });
    expect(created.values).toEqual({ category: { set: 'genomics' } });
    // The contributed rule runs on the server and names the field.
    expect(
      await rejection(
        s.services.create(admin, {
          slug: uniq(),
          name: 'x',
          provider: provider.id,
          category: 'unlisted',
        }),
      ),
    ).toMatchObject({
      status: 422,
      errors: [{ path: 'category', message: 'This set is not listed.' }],
    });
  });

  it('leaves no service, link, history, value or event when the contributed step fails its server validation', async () => {
    const s = await h.start({ extra: [withCategory()] });
    const admin = await s.actor('admin');
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    const before = await counts(s.pool);
    await rejection(
      s.services.create(admin, {
        slug: uniq(),
        name: 'x',
        provider: provider.id,
        category: 'unlisted',
      }),
    );
    expect(await counts(s.pool)).toEqual(before);
  });

  it('takes the whole creation back when the contributed module fails inside the transaction', async () => {
    const s = await h.start({ extra: [withCategory()] });
    const admin = await s.actor('admin');
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    const consortium = await makeOrganisation(s.pool, { type: 'consortium' });
    const before = await counts(s.pool);
    const calls = toValueCalls;
    await expect(
      s.services.create(admin, {
        slug: uniq(),
        name: 'x',
        provider: provider.id,
        consortia: [consortium.id],
        category: 'boom',
      }),
    ).rejects.toThrow(/contributed module failed/);
    // The failure happened inside the transaction, after the service, its history and its links were inserted.
    expect(toValueCalls).toBe(calls + 1);
    expect(await counts(s.pool)).toEqual(before);
    await s.dispatch();
  });

  it('refuses a non-member before it validates, and writes nothing, with a contributed step in the profile', async () => {
    const s = await h.start({ extra: [withCategory()] });
    const mine = await makeOrganisation(s.pool, { type: 'provider' });
    const theirs = await makeOrganisation(s.pool, { type: 'provider' });
    const member = await s.actor('user');
    await makeMembership(s.pool, {
      organisationId: mine.id,
      userId: member.userId,
      state: 'approved',
    });
    const before = await counts(s.pool);
    expect(
      await rejection(
        s.services.create(member, {
          slug: uniq(),
          name: 'x',
          provider: theirs.id,
          category: 'genomics',
        }),
      ),
    ).toMatchObject({ status: 403 });
    expect(await counts(s.pool)).toEqual(before);
    await expect(
      s.services.create(member, {
        slug: uniq(),
        name: 'x',
        provider: mine.id,
        category: 'genomics',
      }),
    ).resolves.toMatchObject({ name: 'x' });
  });

  it('lets two creates for one slug race: one wins, the other gets 409, and the loser leaves no value', async () => {
    const s = await h.start({ extra: [withCategory()] });
    const admin = await s.actor('admin');
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    const slug = uniq();
    const outcomes = await Promise.allSettled(
      [1, 2].map((n) =>
        s.services.create(admin, {
          slug,
          name: `Racer ${n}`,
          provider: provider.id,
          category: `set-${n}`,
        }),
      ),
    );
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const lost = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ status: 409 });
    const { rows } = await s.pool.query<{ n: string }>(
      `select count(*)::text as n from svc_field_value v join svc_service x on x.id = v.service_id where lower(x.slug) = lower($1)`,
      [slug],
    );
    expect(rows[0]!.n).toBe('1');
    expect((await counts(s.pool)).service).toBe(1);
  });
});
