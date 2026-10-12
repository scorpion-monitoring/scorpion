// The startup validator: the shipped configuration passes, and every kind of mistake stops the start with
// a message that names the file and the field. A fixture config with a configured extra field proves the
// `value` storage.
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { service } from '../db/schema.ts';
import { SEED_FIELD_TYPES } from '../service/field-types.ts';
import { SEED_ORG_ROLES, type FieldConfig, type WizardStepEntry } from '../service/registries.ts';
import { FIELDS } from './fields.ts';
import { STEPS } from './steps.ts';
import type { StepConfig } from './types.ts';
import { CONFIGURABLE_COLUMNS, ServicesConfigError, validateServicesConfig } from './validate.ts';

const columns = Object.fromEntries(
  Object.entries(getTableColumns(service)).map(([name, column]) => [
    name,
    column.dataType === 'array' ? ('array' as const) : ('scalar' as const),
  ]),
);

interface Overrides {
  fields?: readonly unknown[];
  steps?: readonly unknown[];
  contributedSteps?: readonly WizardStepEntry[];
}
const run = (overrides: Overrides = {}) =>
  validateServicesConfig({
    fields: overrides.fields ?? FIELDS,
    steps: overrides.steps ?? STEPS,
    ...(overrides.contributedSteps && { contributedSteps: overrides.contributedSteps }),
    fieldTypes: SEED_FIELD_TYPES,
    orgRoles: SEED_ORG_ROLES,
    columns,
  });

const problemsOf = (overrides: Overrides): string[] => {
  try {
    run(overrides);
  } catch (error) {
    expect(error).toBeInstanceOf(ServicesConfigError);
    return [...(error as ServicesConfigError).problems];
  }
  throw new Error('the configuration was accepted');
};

/** The shipped fields with the field of `key` changed. */
const withField = (key: string, patch: Partial<FieldConfig> | ((f: FieldConfig) => FieldConfig)) =>
  FIELDS.map((f) =>
    f.key !== key ? f : typeof patch === 'function' ? patch(f) : { ...f, ...patch },
  );
const withStep = (id: string, patch: Partial<StepConfig>) =>
  STEPS.map((s) => (s.id === id ? { ...s, ...patch } : s));

describe('the shipped configuration', () => {
  it('is valid and resolves every field to its step, type and schema', () => {
    const resolved = run();
    expect(resolved.steps.map((s) => s.id)).toEqual(['basics', 'provision', 'contact']);
    expect(resolved.fields).toHaveLength(FIELDS.length);
    const byKey = new Map(resolved.fields.map((f) => [f.field.key, f]));
    expect(byKey.get('slug')?.step).toBe('basics');
    expect(byKey.get('provider')?.step).toBe('provision');
    expect(byKey.get('contactType')?.step).toBe('contact');
    expect(byKey.get('stage')?.type.id).toBe('select');
    expect(resolved.steps.find((s) => s.id === 'basics')?.intro).toEqual([
      'services.step.basics.intro',
    ]);
  });

  it('puts every field in exactly one step and uses unique keys and pointers', () => {
    const inSteps = STEPS.flatMap((s) => s.fields ?? []);
    expect(new Set(inSteps).size).toBe(inSteps.length);
    expect([...inSteps].sort()).toEqual(FIELDS.map((f) => f.key).sort());
    expect(new Set(FIELDS.map((f) => f.path)).size).toBe(FIELDS.length);
  });

  it('addresses fields by JSON pointers, the contact point below /contact', () => {
    expect(FIELDS.map((f) => f.path)).toEqual(
      expect.arrayContaining(['/name', '/contact/email', '/contact/type']),
    );
  });

  it('names real columns of svc_service, all configurable', () => {
    for (const f of FIELDS) {
      if (f.storage.kind !== 'column') continue;
      expect(Object.keys(columns), f.key).toContain(f.storage.column);
      expect(CONFIGURABLE_COLUMNS as readonly string[], f.key).toContain(f.storage.column);
    }
  });
});

describe('a configured extra field', () => {
  const extra: FieldConfig = {
    key: 'termsUrl',
    path: '/extra/termsUrl',
    type: 'text',
    label: 'services.field.termsUrl.label',
    config: { format: 'url' },
    storage: { kind: 'value' },
    schemaOrg: 'termsOfService',
  };

  it('is stored in svc_field_value and may map to an allowed Schema.org property', () => {
    const resolved = run({
      fields: [...FIELDS, extra],
      steps: withStep('basics', { fields: [...STEPS[0]!.fields!, 'termsUrl'] }),
    });
    const field = resolved.fields.find((f) => f.field.key === 'termsUrl');
    expect(field?.field.storage).toEqual({ kind: 'value' });
    expect(field?.field.schemaOrg).toBe('termsOfService');
  });
});

describe('every mistake stops the start and names the file and the field', () => {
  const stepsWith = (key: string) => withStep('basics', { fields: [...STEPS[0]!.fields!, key] });
  const extra = (patch: Record<string, unknown>) => ({
    key: 'extra',
    path: '/extra',
    type: 'text',
    label: 'services.field.extra.label',
    storage: { kind: 'value' },
    ...patch,
  });

  it.each([
    [
      'an unknown field type',
      { fields: withField('name', { type: 'rich-text' }) },
      /config\/fields\.ts: field "name": the field type "rich-text" is not registered/,
    ],
    [
      'a duplicate key',
      { fields: [...FIELDS, { ...extra({}), key: 'name', path: '/other' }] },
      /config\/fields\.ts: field "name": the key "name" is used twice/,
    ],
    [
      'a duplicate pointer',
      { fields: [...FIELDS, extra({ path: '/name' })], steps: stepsWith('extra') },
      /config\/fields\.ts: field "extra": the path "\/name" is used twice/,
    ],
    [
      'a pointer that is the parent of another',
      { fields: [...FIELDS, extra({ path: '/contact' })], steps: stepsWith('extra') },
      /the path "\/contact" is also the parent of "\/contact\/email"/,
    ],
    [
      'a pointer that is not a JSON pointer',
      { fields: withField('name', { path: 'name' }) },
      /config\/fields\.ts: field "name": path must be a JSON pointer/,
    ],
    [
      'a column that does not exist',
      { fields: withField('name', { storage: { kind: 'column', column: 'title' } }) },
      /config\/fields\.ts: field "name": the column "title" does not exist in svc_service/,
    ],
    [
      'a column that is no field’s to write',
      { fields: withField('name', { storage: { kind: 'column', column: 'public' } }) },
      /config\/fields\.ts: field "name": the column "public" cannot be configured/,
    ],
    [
      'two fields on one column',
      { fields: withField('url', { storage: { kind: 'column', column: 'name' } }) },
      /the column "name" is also used by config\/fields\.ts: field "name"/,
    ],
    [
      'a list in a column that holds one value',
      { fields: withField('url', { config: { format: 'url', multiple: true } }) },
      /field "url": the column "url" holds one value, so the field must not be "multiple"/,
    ],
    [
      'a column that holds a list for a single-valued field',
      { fields: withField('sameAs', { config: { format: 'url' } }) },
      /field "sameAs": the column "sameAs" holds a list, so the field needs "multiple": true/,
    ],
    [
      'a type used with a storage it does not support',
      { fields: withField('name', { storage: { kind: 'icon' } }) },
      /field "name": a field of type "text" cannot use the storage "icon"/,
    ],
    [
      'a bad type config',
      { fields: withField('name', { config: { format: 'html' } }) },
      /config\/fields\.ts: field "name": config format/,
    ],
    [
      'a config key the type does not know',
      { fields: withField('name', { config: { format: 'name', colour: 'red' } }) },
      /config\/fields\.ts: field "name": config/,
    ],
    [
      'a role that is not registered',
      {
        fields: withField('provider', { storage: { kind: 'organisations', role: 'owner' } }),
      },
      /field "provider": the organisation role "owner" is not registered/,
    ],
    [
      'a list for a role that holds one organisation',
      { fields: withField('provider', { config: { multiple: true } }) },
      /field "provider": the role "provider" allows 1 organisation, so the field must not be "multiple": true/,
    ],
    [
      'a single value for a role that holds many',
      { fields: withField('consortia', { config: {} }) },
      /field "consortia": the role "consortium" allows 20 organisations, so the field needs "multiple": true/,
    ],
    [
      'a missing provider field',
      {
        fields: FIELDS.filter((f) => f.key !== 'provider'),
        steps: withStep('provision', { fields: ['consortia'] }),
      },
      /config\/fields\.ts: the role "provider" needs at least 1 organisation, but no field is stored under it/,
    ],
    [
      'a provider field that is not required',
      { fields: withField('provider', { required: false }) },
      /field "provider": the role "provider" is required \(min 1\), so the field must be "required": true/,
    ],
    [
      'a Schema.org property outside the allow-list',
      {
        fields: [...FIELDS, extra({ schemaOrg: 'offers' })],
        steps: stepsWith('extra'),
      },
      /config\/fields\.ts: field "extra": schemaOrg "offers" is not allowed \(one of termsOfService, areaServed, audience, slogan\)/,
    ],
    [
      'a Schema.org property on a type that cannot map to one',
      {
        fields: withField('icon', { schemaOrg: 'slogan' }),
      },
      /field "icon": a field of type "image" cannot map to a Schema.org property/,
    ],
    [
      'a default that does not fit the field',
      { fields: withField('stage', { default: 12 }) },
      /field "stage": the default value does not fit the field/,
    ],
    [
      'a step that names an unknown field',
      { steps: withStep('basics', { fields: [...STEPS[0]!.fields!, 'nickname'] }) },
      /config\/steps\.ts: step "basics": names the field "nickname", which config\/fields\.ts does not define/,
    ],
    [
      'a field that no step shows',
      { steps: withStep('contact', { fields: ['contactEmail'] }) },
      /config\/fields\.ts: field "contactType": the field is in no step of config\/steps\.ts/,
    ],
    [
      'a field in two steps',
      { steps: withStep('contact', { fields: ['contactEmail', 'contactType', 'name'] }) },
      /config\/steps\.ts: step "contact": the field "name" is already in step "basics"/,
    ],
    [
      'two steps with one order',
      { steps: withStep('contact', { order: 20 }) },
      /config\/steps\.ts: step "contact": order 20 is already used by step "provision"/,
    ],
    [
      'two steps with one id',
      { steps: [...STEPS, { ...STEPS[2]!, order: 40 }] },
      /config\/steps\.ts: step "contact": the step id "contact" is used twice/,
    ],
    [
      'a step with no fields and no component',
      { steps: [...STEPS, { id: 'empty', order: 50, title: 'services.step.empty.title' }] },
      /config\/steps\.ts: step "empty": a step needs "fields" or a "component"/,
    ],
    [
      'a step with a title that is no message key',
      { steps: withStep('basics', { title: 'Basics' }) },
      /config\/steps\.ts: step "basics": title/,
    ],
    [
      'a step with a key it does not know',
      { steps: withStep('basics', { texts: ['x'] } as never) },
      /config\/steps\.ts: step "basics":/,
    ],
    [
      'a field that is not an object',
      { fields: [...FIELDS, 'nope'] },
      /config\/fields\.ts: field #\d+:/,
    ],
  ] satisfies [string, Overrides, RegExp][])('%s', (_label, overrides, message) => {
    const problems = problemsOf(overrides);
    expect(problems.join('\n')).toMatch(message);
  });

  it('lists every problem, not only the first', () => {
    const problems = problemsOf({
      fields: withField('name', { type: 'rich-text' }).map((f) =>
        f.key === 'url' ? { ...f, storage: { kind: 'column', column: 'nope' } } : f,
      ),
    });
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });

  it('puts the file name at the front of the error message', () => {
    try {
      run({ fields: withField('name', { type: 'rich-text' }) });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toMatch(
        /^registry\.services: the configuration is not valid:/,
      );
      expect((error as Error).message).toContain('config/fields.ts: field "name"');
    }
  });
});

describe('contributed steps', () => {
  const step = (patch: Partial<WizardStepEntry> = {}): WizardStepEntry => ({
    id: 'category',
    order: 15,
    title: 'fixture.step.category.title',
    intro: [],
    fields: [
      {
        key: 'category',
        path: '/category',
        type: 'text',
        label: 'fixture.field.category.label',
        storage: { kind: 'value' },
      },
    ],
    ...patch,
  });

  it('are resolved in order with the steps of the file, their fields included', () => {
    const resolved = run({ contributedSteps: [step()] });
    expect(resolved.steps.map((s) => [s.id, s.source])).toEqual([
      ['basics', 'config'],
      ['category', 'contributed'],
      ['provision', 'config'],
      ['contact', 'config'],
    ]);
    expect(resolved.fields.find((f) => f.field.key === 'category')?.step).toBe('category');
  });

  it.each([
    [
      'a key that the config file already uses',
      step({ fields: [{ ...step().fields[0]!, key: 'name', path: '/n' }] }),
      /service\.wizardStep "category" \(contributed\): the field key "name" is already defined/,
    ],
    [
      'an order that clashes',
      step({ order: 10 }),
      /service\.wizardStep "category" \(contributed\): order 10 is already used by step "basics"/,
    ],
    [
      'an id that clashes',
      step({ id: 'basics', order: 11 }),
      /service\.wizardStep "basics" \(contributed\): the step id "basics" is used twice/,
    ],
    [
      'no fields and no component',
      step({ fields: [] }),
      /service\.wizardStep "category" \(contributed\): a step needs fields or a component/,
    ],
    [
      'a pointer that the file already uses',
      step({ fields: [{ ...step().fields[0]!, path: '/name' }] }),
      /field "category": the path "\/name" is used twice/,
    ],
  ])('refuse %s', (_label, contributed, message) => {
    expect(problemsOf({ contributedSteps: [contributed] }).join('\n')).toMatch(message);
  });

  it('may be a component with no fields', () => {
    expect(() =>
      run({ contributedSteps: [step({ fields: [], component: 'KpiSetStep' })] }),
    ).not.toThrow();
  });
});
