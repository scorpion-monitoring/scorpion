// The conditions that travel (`showIf`, ADR-0040 addendum) and the storage `module`: a field or a step that the form
// hides is not required and its value is dropped, on the server as in the browser; a condition that asks about no
// field stops the start; a field of the storage `module` needs a type with `store`, and a patch cannot change it.
import { z } from '@scorpion/contracts';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { FIELDS } from '../config/fields.ts';
import { STEPS } from '../config/steps.ts';
import { ServicesConfigError, validateServicesConfig } from '../config/validate.ts';
import { service } from '../db/schema.ts';
import { showIfHolds, validateBody, validatePatch } from './body.ts';
import { buildCreateSchema } from './create-schema.ts';
import { SEED_FIELD_TYPES } from './field-types.ts';
import {
  SEED_ORG_ROLES,
  showIfSchema,
  type FieldEnv,
  type FieldTypeEntry,
  type WizardStepEntry,
} from './registries.ts';

const columns = Object.fromEntries(
  Object.entries(getTableColumns(service)).map(([name, column]) => [
    name,
    column.dataType === 'array' ? ('array' as const) : ('scalar' as const),
  ]),
);
const env: FieldEnv = {
  vocabularyHas: () => Promise.resolve(true),
  findLicence: () => Promise.resolve(undefined),
};
const provider = '0198f9c0-1234-7abc-8def-0123456789ab';
const text: FieldTypeEntry = {
  id: 'note',
  labels: { en: 'Note' },
  widget: 'note',
  storages: ['value', 'module'],
  configSchema: z.strictObject({}),
  schema: () => z.string().min(1).max(40),
  jsonSchema: () => ({ type: 'string', minLength: 1, maxLength: 40 }),
};
const field = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  path: `/${key}`,
  type: 'note',
  label: `fixture.field.${key}.label`,
  storage: { kind: 'value' as const },
  ...extra,
});
const step = (extra: Partial<WizardStepEntry> & { fields: WizardStepEntry['fields'] }) => ({
  id: 'extra',
  order: 50,
  title: 'fixture.step.title',
  intro: [],
  ...extra,
});

const configWith = (steps: WizardStepEntry[], types: FieldTypeEntry[] = [text]) =>
  validateServicesConfig({
    fields: FIELDS,
    steps: STEPS,
    contributedSteps: steps,
    fieldTypes: [...SEED_FIELD_TYPES, ...types],
    orgRoles: SEED_ORG_ROLES,
    columns,
  });
const base = { slug: 'galaxy', name: 'Galaxy', provider };
const problems = async (resolved: ReturnType<typeof configWith>, body: unknown) => {
  try {
    await validateBody(resolved, body, env);
  } catch (error) {
    return (error as { errors: { path: string }[] }).errors.map((entry) => entry.path);
  }
  return [];
};

describe('showIfHolds', () => {
  it.each([
    ['no condition', undefined, {}, true],
    ['equals, equal', { path: '/kind', equals: 'a' }, { kind: 'a' }, true],
    ['equals, different', { path: '/kind', equals: 'a' }, { kind: 'b' }, false],
    ['equals, absent', { path: '/kind', equals: 'a' }, {}, false],
    ['equals a boolean', { path: '/on', equals: true }, { on: true }, true],
    ['equals a list, deep', { path: '/l', equals: ['a', 'b'] }, { l: ['a', 'b'] }, true],
    ['equals a list, other order', { path: '/l', equals: ['a', 'b'] }, { l: ['b', 'a'] }, false],
    ['oneOf, member', { path: '/kind', oneOf: ['a', 'b'] }, { kind: 'b' }, true],
    ['oneOf, not a member', { path: '/kind', oneOf: ['a', 'b'] }, { kind: 'c' }, false],
    ['a nested pointer', { path: '/contact/type', equals: 'x' }, { contact: { type: 'x' } }, true],
    ['a nested pointer, absent parent', { path: '/contact/type', equals: 'x' }, {}, false],
  ])('%s', (_what, condition, body, expected) => {
    expect(showIfHolds(condition as never, body)).toBe(expected);
  });

  it('refuses a condition with both or neither of equals and oneOf, and a pointer that is no pointer', () => {
    expect(showIfSchema.safeParse({ path: '/a', equals: 1, oneOf: [1] }).success).toBe(false);
    expect(showIfSchema.safeParse({ path: '/a' }).success).toBe(false);
    expect(showIfSchema.safeParse({ path: 'a', equals: 1 }).success).toBe(false);
    expect(showIfSchema.safeParse({ path: '/a', equals: 1, extra: 1 }).success).toBe(false);
  });
});

describe('a field with a condition', () => {
  const resolved = configWith([
    step({
      fields: [
        field('kind', { required: false }),
        field('detail', { required: true, showIf: { path: '/kind', equals: 'special' } }),
      ],
    }),
  ]);

  it('is required while the condition holds', async () => {
    expect(await problems(resolved, { ...base, kind: 'special' })).toEqual(['detail']);
    expect(await problems(resolved, { ...base, kind: 'special', detail: 'x' })).toEqual([]);
  });

  it('is not required while it is hidden, and a value sent for it is dropped', async () => {
    expect(await problems(resolved, base)).toEqual([]);
    const values = await validateBody(resolved, { ...base, kind: 'plain', detail: 'stale' }, env);
    expect(values.has('detail')).toBe(false);
    expect(values.get('kind')).toBe('plain');
  });

  it('is left out of the `required` of the step schema, and travels in the field and the step', () => {
    const schema = buildCreateSchema(resolved, SEED_ORG_ROLES, { devConsole: false });
    const out = schema.steps.find((candidate) => candidate.id === 'extra')!;
    expect(out.schema.required).toBeUndefined();
    expect(out.fields.find((candidate) => candidate.key === 'detail')?.showIf).toEqual({
      path: '/kind',
      equals: 'special',
    });
    expect(out.fields.find((candidate) => candidate.key === 'detail')?.required).toBe(true);
  });
});

describe('a step with a condition', () => {
  const resolved = configWith([
    step({
      id: 'extra',
      showIf: { path: '/note', oneOf: ['go'] },
      fields: [field('needed', { required: true })],
    }),
    step({ id: 'trigger', order: 45, fields: [field('note')] }),
  ]);

  it('lets a hidden step have a required field: it is neither required nor kept', async () => {
    expect(await problems(resolved, base)).toEqual([]);
    expect(await problems(resolved, { ...base, note: 'go' })).toEqual(['needed']);
    const values = await validateBody(resolved, { ...base, note: 'stop', needed: 'x' }, env);
    expect(values.has('needed')).toBe(false);
  });

  it('is sent with its condition', () => {
    const schema = buildCreateSchema(resolved, SEED_ORG_ROLES, { devConsole: false });
    expect(schema.steps.find((candidate) => candidate.id === 'extra')?.showIf).toEqual({
      path: '/note',
      oneOf: ['go'],
    });
    expect(schema.steps.find((candidate) => candidate.id === 'trigger')?.showIf).toBeUndefined();
  });
});

describe('the start refuses a condition that cannot work', () => {
  it('names the field and the pointer when no field has the pointer', () => {
    expect(() =>
      configWith([
        step({ fields: [field('detail', { showIf: { path: '/missing', equals: 1 } })] }),
      ]),
    ).toThrow(/field "detail".*showIf asks about "\/missing", which no field has/);
    expect(() =>
      configWith([step({ showIf: { path: '/missing', equals: 1 }, fields: [field('detail')] })]),
    ).toThrow(/step "extra": showIf asks about "\/missing"/);
  });

  it('throws the config error type', () => {
    expect(() =>
      configWith([step({ fields: [field('detail', { showIf: { path: '/nope', equals: 1 } })] })]),
    ).toThrow(ServicesConfigError);
  });
});

describe('the storage `module`', () => {
  const moduleField = step({
    fields: [field('own', { storage: { kind: 'module' } })],
  });

  it('needs a field type with a `store` function', () => {
    expect(() => configWith([moduleField])).toThrow(
      /storage "module" needs a field type with a "store"/,
    );
    const stored: FieldTypeEntry = { ...text, store: () => Promise.resolve() };
    expect(() => configWith([moduleField], [stored])).not.toThrow();
  });

  it('is refused by the type that does not list it', () => {
    const noModule: FieldTypeEntry = {
      ...text,
      storages: ['value'],
      store: () => Promise.resolve(),
    };
    expect(() => configWith([moduleField], [noModule])).toThrow(/cannot use the storage "module"/);
  });

  it('cannot be changed by a patch, whatever its value', async () => {
    const stored: FieldTypeEntry = { ...text, store: () => Promise.resolve() };
    const resolved = configWith([moduleField], [stored]);
    for (const value of ['x', null]) {
      let paths: string[] = [];
      try {
        await validatePatch(resolved, { own: value }, env);
      } catch (error) {
        paths = (error as { errors: { path: string }[] }).errors.map((entry) => entry.path);
      }
      expect(paths).toEqual(['own']);
    }
  });
});
