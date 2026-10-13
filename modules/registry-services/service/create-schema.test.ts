// The schema of the create wizard, as pure functions: what `GET /services/schema` says for the shipped
// configuration and for a configuration with a contributed step, and, above all, that the JSON Schema the
// browser checks and the Zod schema the server validates **cannot drift**: both are fed the same table and
// must give the same verdict (a value only the server can judge, because it needs data, is marked so).
import { checkJsonSchema } from '@scorpion/ui-kit/json-schema';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { FIELDS } from '../config/fields.ts';
import { STEPS } from '../config/steps.ts';
import { validateServicesConfig } from '../config/validate.ts';
import { service } from '../db/schema.ts';
import { validateBody } from './body.ts';
import {
  buildCreateSchema,
  defaultsOf,
  MAX_CREATE_BODY_BYTES,
  SCHEMA_LIMITS,
  stepSchema,
} from './create-schema.ts';
import { SEED_FIELD_TYPES } from './field-types.ts';
import { SEED_ORG_ROLES, type FieldEnv, type WizardStepEntry } from './registries.ts';
import { z } from '@scorpion/contracts';

const columns = Object.fromEntries(
  Object.entries(getTableColumns(service)).map(([name, column]) => [
    name,
    column.dataType === 'array' ? ('array' as const) : ('scalar' as const),
  ]),
);

const kpiSet = {
  id: 'kpi-set',
  labels: { en: 'KPI set' },
  widget: 'kpi-set',
  storages: ['value' as const],
  configSchema: z.strictObject({}),
  schema: () => z.string().min(1).max(40),
  jsonSchema: () => ({ type: 'string', minLength: 1, maxLength: 40 }),
};
const categoryStep: WizardStepEntry = {
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
  applies: (form) => form.stage !== 'TERM',
};

const resolve = (contributed: readonly WizardStepEntry[] = []) =>
  validateServicesConfig({
    fields: FIELDS,
    steps: STEPS,
    contributedSteps: contributed,
    fieldTypes: [...SEED_FIELD_TYPES, kpiSet],
    orgRoles: SEED_ORG_ROLES,
    columns,
  });

const build = (contributed: readonly WizardStepEntry[] = [], devConsole = false) =>
  buildCreateSchema(resolve(contributed), SEED_ORG_ROLES, { devConsole });

describe('the schema of the shipped configuration', () => {
  const schema = build();

  it('lists the steps in order, each with its fields in the order of the step', () => {
    expect(schema.steps.map((step) => [step.id, step.fields.map((f) => f.key)])).toEqual([
      ['basics', ['slug', 'name', 'license', 'stage', 'icon', 'description', 'url', 'sameAs']],
      ['provision', ['provider', 'consortia']],
      ['contact', ['contactEmail', 'contactType']],
    ]);
    expect(schema.steps.map((step) => step.contributed)).toEqual([false, false, false]);
  });

  it('gives every field its pointer, type, widget, message keys and config (every field of the file)', () => {
    const fields = schema.steps.flatMap((step) => step.fields);
    expect(fields.map((f) => f.key).sort()).toEqual(FIELDS.map((f) => f.key).sort());
    for (const field of fields) {
      const source = FIELDS.find((f) => f.key === field.key)!;
      expect(field, field.key).toMatchObject({
        path: source.path,
        type: source.type,
        label: source.label,
        required: source.required === true,
      });
      expect(field.widget, field.key).toBe(
        SEED_FIELD_TYPES.find((type) => type.id === source.type)!.widget,
      );
      expect(field.help, field.key).toBe(source.help);
    }
  });

  it('marks the icon as deferred, leaves it out of the step schema and names the role of an organisation field', () => {
    const byKey = new Map(schema.steps.flatMap((step) => step.fields).map((f) => [f.key, f]));
    expect(byKey.get('icon')?.deferred).toBe(true);
    expect(byKey.get('slug')?.deferred).toBe(false);
    expect(byKey.get('provider')?.role).toBe('provider');
    expect(byKey.get('consortia')?.role).toBe('consortium');
    expect(byKey.get('slug')?.role).toBeUndefined();
    const basics = schema.steps[0]!.schema.properties as Record<string, unknown>;
    expect(Object.keys(basics)).not.toContain('icon');
  });

  it('builds one JSON Schema per step, nested at the pointers, with the required keys and the pair rule', () => {
    const [basics, provision, contact] = schema.steps.map((step) => step.schema);
    expect(basics).toMatchObject({ type: 'object', additionalProperties: false });
    // `stage` has a default, so the body need not carry it.
    expect(basics!.required).toEqual(['slug', 'name']);
    expect(provision!.required).toEqual(['provider']);
    expect(contact).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: {
        contact: {
          type: 'object',
          additionalProperties: false,
          properties: {
            email: expect.objectContaining({ type: 'string', widget: 'text' }) as unknown,
            type: expect.objectContaining({ type: 'string', widget: 'text' }) as unknown,
          },
          dependentRequired: { email: ['type'], type: ['email'] },
        },
      },
    });
  });

  it('carries the default of a field in its schema and in the defaults object, with an empty list for a list field', () => {
    expect(schema.defaults).toEqual({ stage: 'DEV', sameAs: [], consortia: [] });
    expect(
      (schema.steps[0]!.schema.properties as Record<string, { default?: unknown }>).stage!.default,
    ).toBe('DEV');
  });

  it('nests the defaults at the pointers and skips what is not part of the body', () => {
    expect(
      defaultsOf([
        { path: '/a/b', default: 1, config: {}, deferred: false },
        { path: '/a/c', default: undefined, config: { multiple: true }, deferred: false },
        { path: '/icon', default: 'x', config: {}, deferred: true },
        { path: '/d', default: undefined, config: {}, deferred: false },
      ]),
    ).toEqual({ a: { b: 1, c: [] } });
  });

  it('names the limits as the constants the server validates with', () => {
    expect(schema.limits).toEqual({
      sameAs: 20,
      slug: 64,
      name: 200,
      description: 4000,
      url: 500,
      email: 254,
      contactKind: 64,
      bodyBytes: MAX_CREATE_BODY_BYTES,
    });
    expect(schema.limits).toBe(SCHEMA_LIMITS);
  });

  it('lists the roles with their bounds and types, and only the owning role is limited to the caller’s memberships', () => {
    expect(
      schema.roles.map((role) => [role.id, role.min, role.max, role.orgTypes, role.memberOnly]),
    ).toEqual([
      ['provider', 1, 1, ['provider'], true],
      ['consortium', 0, 20, ['consortium'], false],
    ]);
  });

  it('names the field types in use with their widgets, and carries the dev console flag as it was told', () => {
    expect(schema.fieldTypes.map((type) => [type.id, type.widget])).toEqual([
      ['image', 'image'],
      ['license', 'license'],
      ['organisation', 'organisation'],
      ['select', 'select'],
      ['text', 'text'],
    ]);
    expect(schema.devConsole).toBe(false);
    expect(build([], true).devConsole).toBe(true);
  });

  it('takes the label of a role for the locale asked, English when the role has none', () => {
    const german = buildCreateSchema(resolve(), SEED_ORG_ROLES, {
      devConsole: false,
      locale: 'de',
    });
    expect(german.roles.map((role) => role.label)).toEqual(['Anbieter', 'Konsortium']);
    const french = buildCreateSchema(resolve(), SEED_ORG_ROLES, {
      devConsole: false,
      locale: 'fr',
    });
    expect(french.roles.map((role) => role.label)).toEqual(['Provider', 'Consortium']);
  });

  it('carries the options a choice field was resolved with', () => {
    const withChoices = buildCreateSchema(resolve(), SEED_ORG_ROLES, {
      devConsole: false,
      choices: new Map([['stage', [{ value: 'DEV', label: 'In development' }]]]),
    });
    const stage = withChoices.steps[0]!.fields.find((f) => f.key === 'stage')!;
    expect(stage.choices).toEqual([{ value: 'DEV', label: 'In development' }]);
  });
});

describe('a contributed step', () => {
  it('appears in order between the module’s own steps, with its own widget, and its server rules in its schema', () => {
    const schema = build([categoryStep]);
    expect(schema.steps.map((step) => step.id)).toEqual([
      'basics',
      'category',
      'provision',
      'contact',
    ]);
    const step = schema.steps[1]!;
    expect(step.contributed).toBe(true);
    expect(step.fields).toEqual([
      expect.objectContaining({
        key: 'category',
        widget: 'kpi-set',
        type: 'kpi-set',
        required: true,
      }),
    ]);
    expect(step.schema).toMatchObject({
      required: ['category'],
      properties: { category: { type: 'string', maxLength: 40, widget: 'kpi-set' } },
    });
    expect(schema.fieldTypes.map((type) => type.id)).toContain('kpi-set');
  });

  it('does not send `applies`: it is a function and only the browser can ask it', () => {
    const schema = build([categoryStep]);
    expect(JSON.stringify(schema)).not.toContain('applies');
    const roundTrip = JSON.parse(JSON.stringify(schema)) as unknown;
    expect(roundTrip).toEqual(JSON.parse(JSON.stringify(schema)));
    expect(Object.keys(schema.steps[1]!)).not.toContain('applies');
  });
});

describe('stepSchema', () => {
  it('leaves the pair rule to the server when the two contact fields are in different steps', () => {
    const resolved = resolve();
    const email = resolved.fields.filter((f) => f.field.key === 'contactEmail');
    const type = resolved.fields.filter((f) => f.field.key === 'contactType');
    expect(stepSchema(email).dependentRequired).toBeUndefined();
    expect(stepSchema(type).dependentRequired).toBeUndefined();
  });
});

// ----- the two schemas agree -------------------------------------------------------------------------------

const UUID = '0197a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b';
const other = '0197a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2c';
const env: FieldEnv = {
  vocabularyHas: (_vocabulary, key) => Promise.resolve(key === 'DEV' || key === 'PROD'),
  findLicence: (id) => Promise.resolve(id === 'MIT' ? { id: 'MIT' } : undefined),
};
const base = { slug: 'my-service', name: 'My service', provider: UUID };
const repeat = (char: string, n: number) => char.repeat(n);
const url = (n: number) => `https://example.org/${repeat('a', n - 'https://example.org/'.length)}`;

interface Row {
  label: string;
  body: Record<string, unknown>;
  /** What both schemas say. */
  ok: boolean;
  /** The server refuses a body the browser's schema cannot refuse, because it needs data or a rule JSON Schema cannot say. */
  serverOnly?: true;
}

const rows: Row[] = [
  { label: 'the smallest body', body: base, ok: true },
  {
    label: 'every field of the shipped configuration',
    body: {
      ...base,
      license: 'MIT',
      stage: 'PROD',
      description: 'A text\nof two lines.',
      url: 'https://example.org/service',
      sameAs: ['https://example.org/a', 'http://example.org/b'],
      consortia: [UUID, other],
      contact: { email: 'help@example.org', type: 'support' },
    },
    ok: true,
  },
  { label: 'no slug', body: { name: 'n', provider: UUID }, ok: false },
  { label: 'no name', body: { slug: 's', provider: UUID }, ok: false },
  { label: 'no provider', body: { slug: 's', name: 'n' }, ok: false },
  { label: 'a provider that is no id', body: { ...base, provider: 'nope' }, ok: false },
  { label: 'an empty slug', body: { ...base, slug: '' }, ok: false },
  { label: 'a slug with a space', body: { ...base, slug: 'a b' }, ok: false },
  { label: 'a slug that starts with a hyphen', body: { ...base, slug: '-a' }, ok: false },
  { label: 'a slug of 64 characters', body: { ...base, slug: repeat('a', 64) }, ok: true },
  { label: 'a slug of 65 characters', body: { ...base, slug: repeat('a', 65) }, ok: false },
  { label: 'a reserved slug', body: { ...base, slug: 'new' }, ok: false, serverOnly: true },
  { label: 'a slug shaped like an id', body: { ...base, slug: UUID }, ok: false, serverOnly: true },
  { label: 'a name of 200 characters', body: { ...base, name: repeat('n', 200) }, ok: true },
  { label: 'a name of 201 characters', body: { ...base, name: repeat('n', 201) }, ok: false },
  { label: 'an empty name', body: { ...base, name: '' }, ok: false },
  { label: 'a name with a control character', body: { ...base, name: 'a\u0007b' }, ok: false },
  {
    label: 'a description of 4000 characters',
    body: { ...base, description: repeat('d', 4000) },
    ok: true,
  },
  {
    label: 'a description of 4001 characters',
    body: { ...base, description: repeat('d', 4001) },
    ok: false,
  },
  { label: 'an emptied description', body: { ...base, description: '' }, ok: true },
  {
    label: 'a description with a control character',
    body: { ...base, description: 'a\u0007b' },
    ok: false,
  },
  { label: 'a url of 500 characters', body: { ...base, url: url(500) }, ok: true },
  { label: 'a url of 501 characters', body: { ...base, url: url(501) }, ok: false },
  {
    label: 'a url with an upper-case scheme',
    body: { ...base, url: 'HTTPS://Example.org' },
    ok: true,
  },
  { label: 'a url with another scheme', body: { ...base, url: 'ftp://example.org' }, ok: false },
  { label: 'a url that is no url', body: { ...base, url: 'example.org' }, ok: false },
  { label: 'a url with a space', body: { ...base, url: 'https://example.org/a b' }, ok: false },
  { label: 'a url without a host', body: { ...base, url: 'https:///x' }, ok: false },
  {
    label: 'a url with credentials',
    body: { ...base, url: 'https://u:p@example.org' },
    ok: false,
    serverOnly: true,
  },
  {
    label: 'a list of 20 links',
    body: { ...base, sameAs: Array.from({ length: 20 }, (_, i) => `https://example.org/${i}`) },
    ok: true,
  },
  {
    label: 'a list of 21 links',
    body: { ...base, sameAs: Array.from({ length: 21 }, (_, i) => `https://example.org/${i}`) },
    ok: false,
  },
  { label: 'an emptied list of links', body: { ...base, sameAs: [] }, ok: true },
  {
    label: 'a link that is no url',
    body: { ...base, sameAs: ['https://example.org', 'nope'] },
    ok: false,
  },
  { label: 'links given as a string', body: { ...base, sameAs: 'https://example.org' }, ok: false },
  { label: 'consortia that are ids', body: { ...base, consortia: [UUID] }, ok: true },
  { label: 'an emptied list of consortia', body: { ...base, consortia: [] }, ok: true },
  { label: 'a consortium that is no id', body: { ...base, consortia: ['x'] }, ok: false },
  { label: 'consortia given as one id', body: { ...base, consortia: UUID }, ok: false },
  { label: 'a licence', body: { ...base, license: 'MIT' }, ok: true },
  { label: 'an empty licence', body: { ...base, license: '' }, ok: false },
  {
    label: 'a licence nobody lists',
    body: { ...base, license: 'Nope-1.0' },
    ok: false,
    serverOnly: true,
  },
  { label: 'a stage the vocabulary has', body: { ...base, stage: 'PROD' }, ok: true },
  { label: 'a stage nobody declared', body: { ...base, stage: 'XX' }, ok: false, serverOnly: true },
  { label: 'a stage that is no text', body: { ...base, stage: 1 }, ok: false },
  {
    label: 'both parts of the contact point',
    body: { ...base, contact: { email: 'a@example.org', type: 'support' } },
    ok: true,
  },
  {
    label: 'only the address of the contact point',
    body: { ...base, contact: { email: 'a@example.org' } },
    ok: false,
  },
  {
    label: 'only the type of the contact point',
    body: { ...base, contact: { type: 'support' } },
    ok: false,
  },
  {
    label: 'a contact address without a domain',
    body: { ...base, contact: { email: 'a', type: 't' } },
    ok: false,
  },
  {
    label: 'a contact address with one label',
    body: { ...base, contact: { email: 'a@b', type: 't' } },
    ok: false,
  },
  {
    label: 'a contact address with two dots in a row',
    body: { ...base, contact: { email: 'a..b@example.org', type: 't' } },
    ok: false,
  },
  {
    label: 'a contact address that starts with a dot',
    body: { ...base, contact: { email: '.a@example.org', type: 't' } },
    ok: false,
  },
  {
    label: 'a contact address with a space',
    body: { ...base, contact: { email: 'a b@example.org', type: 't' } },
    ok: false,
  },
  {
    label: 'a contact address of 255 characters',
    body: {
      ...base,
      contact: {
        email: `${repeat('a', 64)}@${repeat('b', 63)}.${repeat('c', 63)}.${repeat('d', 63)}.org`,
        type: 't',
      },
    },
    ok: false,
  },
  {
    label: 'a contact type of 64 characters',
    body: { ...base, contact: { email: 'a@example.org', type: repeat('t', 64) } },
    ok: true,
  },
  {
    label: 'a contact type of 65 characters',
    body: { ...base, contact: { email: 'a@example.org', type: repeat('t', 65) } },
    ok: false,
  },
  { label: 'a key nobody knows', body: { ...base, colour: 'red' }, ok: false },
  {
    label: 'a key nobody knows inside the contact point',
    body: { ...base, contact: { email: 'a@example.org', type: 't', fax: '1' } },
    ok: false,
  },
  { label: 'the icon in the body', body: { ...base, icon: 'x' }, ok: false },
  { label: 'a value of the wrong type', body: { ...base, name: 5 }, ok: false },
];

const wholeSchema = () => {
  const resolved = resolve();
  return stepSchema(resolved.fields);
};

describe('the browser’s schema and the server’s agree', () => {
  const whole = wholeSchema();
  const resolved = resolve();

  it.each(rows)('$label', async ({ body, ok, serverOnly }) => {
    const browser = checkJsonSchema(whole, body).length === 0;
    const server = await validateBody(resolved, body, env).then(
      () => true,
      () => false,
    );
    if (serverOnly) {
      // The browser lets it through; the server answers 422 on the field.
      expect({ browser, server }).toEqual({ browser: true, server: false });
    } else {
      expect({ browser, server }).toEqual({ browser: ok, server: ok });
    }
  });

  it('never refuses in the browser what the server accepts: every accepted row passes both', async () => {
    for (const row of rows.filter((r) => r.ok)) {
      expect(checkJsonSchema(whole, row.body), row.label).toEqual([]);
      await expect(validateBody(resolved, row.body, env), row.label).resolves.toBeInstanceOf(Map);
    }
  });

  it('is built from the same entries: the schema of a field type is the one the server validates with', () => {
    for (const field of resolved.fields) {
      expect(field.type.jsonSchema(field.config), field.field.key).toBeTruthy();
      expect(field.schema, field.field.key).toBeInstanceOf(z.ZodType);
    }
  });

  it('checks a contributed field with the entry’s own pair of schemas', async () => {
    const withStep = resolve([categoryStep]);
    const schema = stepSchema(withStep.fields);
    const good = { ...base, category: 'genomics' };
    const bad = { ...base, category: repeat('c', 41) };
    for (const [body, ok] of [
      [good, true],
      [bad, false],
      [base, false],
    ] as const) {
      const server = await validateBody(withStep, body, env).then(
        () => true,
        () => false,
      );
      expect({ browser: checkJsonSchema(schema, body).length === 0, server }).toEqual({
        browser: ok,
        server: ok,
      });
    }
  });
});
