// The edit form of the service page as pure functions: the form a record starts from, the patch a change becomes,
// the fields drawn and the fields shown read-only, and the check on the fields the person can change. The schema
// is the one the server builds for the shipped configuration, as in `form-state.test.ts`.
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { FIELDS } from '../config/fields.ts';
import { STEPS } from '../config/steps.ts';
import { validateServicesConfig } from '../config/validate.ts';
import { service } from '../db/schema.ts';
import { buildCreateSchema } from '../service/create-schema.ts';
import { SEED_FIELD_TYPES } from '../service/field-types.ts';
import { editableFields as editableOf } from '../service/field-rules.ts';
import { SEED_ORG_ROLES } from '../service/registries.ts';
import {
  editFields,
  editIssues,
  formFromService,
  hasChanges,
  patchBody,
  readOnlyFields,
  type ServiceSource,
} from './edit-state.ts';
import { toBodyOf } from './form-state.ts';
import type { WizardSchema } from './wizard-types.ts';

const columns = Object.fromEntries(
  Object.entries(getTableColumns(service)).map(([name, column]) => [
    name,
    column.dataType === 'array' ? ('array' as const) : ('scalar' as const),
  ]),
);
const resolved = validateServicesConfig({
  fields: FIELDS,
  steps: STEPS,
  fieldTypes: SEED_FIELD_TYPES,
  orgRoles: SEED_ORG_ROLES,
  columns,
});
const schema = JSON.parse(
  JSON.stringify(buildCreateSchema(resolved, SEED_ORG_ROLES, { devConsole: false })),
) as WizardSchema;
const all = schema.steps.flatMap((step) => step.fields);
const keys = all.map((field) => field.key);

const A = '0197a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a01';
const B = '0197a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a02';
const C = '0197a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a03';

const record = (extra: Partial<ServiceSource> = {}): ServiceSource => ({
  slug: 'tool',
  name: 'Tool',
  license: 'MIT',
  stage: 'DEV',
  description: 'A tool.',
  url: 'https://tool.example.org',
  sameAs: ['https://a.example.org'],
  contactEmail: 'team@example.org',
  contactType: 'support',
  organisations: [
    { role: 'provider', id: A },
    { role: 'consortium', id: B },
    { role: 'consortium', id: C },
  ],
  values: {},
  ...extra,
});

const member = editableOf({ edit: true, identity: false }, keys);
const manager = editableOf({ edit: true, identity: true }, keys);
const nobody = editableOf({ edit: false, identity: false }, keys);

describe('the fields of the edit form', () => {
  it.each([
    [
      'a member',
      member,
      [
        'name',
        'license',
        'stage',
        'description',
        'url',
        'sameAs',
        'consortia',
        'contactEmail',
        'contactType',
      ],
    ],
    [
      'a manager',
      manager,
      [
        'slug',
        'name',
        'license',
        'stage',
        'description',
        'url',
        'sameAs',
        'provider',
        'consortia',
        'contactEmail',
        'contactType',
      ],
    ],
    ['a reader', nobody, []],
  ])('draw what the record says %s may write, and never the icon', (_who, editable, expected) => {
    expect(editFields(all, editable).map((field) => field.key)).toEqual(expected);
  });

  it.each([
    ['a member', member, ['slug', 'provider']],
    ['a manager', manager, []],
    ['a reader, who has no form at all', nobody, []],
  ])('show read-only the fields %s may not write', (_who, editable, expected) => {
    expect(readOnlyFields(all, editable).map((field) => field.key)).toEqual(expected);
  });
});

describe('the form a record starts from', () => {
  it('holds every field at its pointer: columns, the contact pair, the provider and the consortia', () => {
    expect(formFromService(record(), all)).toEqual({
      slug: 'tool',
      name: 'Tool',
      license: 'MIT',
      stage: 'DEV',
      description: 'A tool.',
      url: 'https://tool.example.org',
      sameAs: ['https://a.example.org'],
      provider: A,
      consortia: [B, C],
      contact: { email: 'team@example.org', type: 'support' },
    });
  });

  it('leaves out what the record has not, and a contact point the reader may not see', () => {
    const bare = record({
      license: null,
      description: null,
      url: null,
      sameAs: [],
      organisations: [{ role: 'provider', id: A }],
    });
    delete bare.contactEmail;
    delete bare.contactType;
    expect(formFromService(bare, all)).toEqual({
      slug: 'tool',
      name: 'Tool',
      stage: 'DEV',
      sameAs: [],
      provider: A,
      consortia: [],
    });
  });

  it('reads a configured field that is no column from the values by its key', () => {
    const extra = {
      key: 'topic',
      path: '/topic',
      type: 'text',
      widget: 'text',
      label: 'l',
      required: false,
      config: {},
      deferred: false,
    };
    expect(
      formFromService(record({ values: { topic: 'imaging' } }), [...all, extra]),
    ).toMatchObject({
      topic: 'imaging',
    });
  });
});

describe('the patch', () => {
  const fields = editFields(all, manager);
  const initial = formFromService(record(), all);
  const change = (edit: (form: Record<string, unknown>) => void) => {
    const form = structuredClone(initial);
    edit(form);
    return patchBody(initial, form, fields);
  };

  it('is empty when nothing changed, so no save is offered', () => {
    const patch = change(() => {});
    expect(patch).toEqual({});
    expect(hasChanges(patch)).toBe(false);
  });

  it('is empty when the text only differs by white space', () => {
    expect(change((form) => (form.name = '  Tool  '))).toEqual({});
  });

  it.each([
    [
      'a changed name',
      (form: Record<string, unknown>) => (form.name = 'Tool 2'),
      { name: 'Tool 2' },
    ],
    [
      'a trimmed new name',
      (form: Record<string, unknown>) => (form.name = ' New '),
      { name: 'New' },
    ],
    ['a new stage', (form: Record<string, unknown>) => (form.stage = 'PROD'), { stage: 'PROD' }],
    ['a rename', (form: Record<string, unknown>) => (form.slug = 'tool-2'), { slug: 'tool-2' }],
    ['a move', (form: Record<string, unknown>) => (form.provider = B), { provider: B }],
    [
      'an emptied description',
      (form: Record<string, unknown>) => (form.description = ''),
      { description: null },
    ],
    [
      'an emptied licence',
      (form: Record<string, unknown>) => delete form.license,
      { license: null },
    ],
    [
      'an emptied list of links',
      (form: Record<string, unknown>) => (form.sameAs = []),
      { sameAs: [] },
    ],
    [
      'an emptied list of consortia',
      (form: Record<string, unknown>) => (form.consortia = []),
      { consortia: [] },
    ],
    [
      'one more consortium',
      (form: Record<string, unknown>) => (form.consortia = [B, C, A]),
      { consortia: [B, C, A] },
    ],
    [
      'a changed address of the contact point, sent with its kind',
      (form: Record<string, unknown>) =>
        (form.contact = { email: 'new@example.org', type: 'support' }),
      { contact: { email: 'new@example.org', type: 'support' } },
    ],
    [
      'a changed kind of contact, sent with its address',
      (form: Record<string, unknown>) =>
        (form.contact = { email: 'team@example.org', type: 'sales' }),
      { contact: { email: 'team@example.org', type: 'sales' } },
    ],
    [
      'a contact point cleared in both parts',
      (form: Record<string, unknown>) => (form.contact = { email: '', type: '' }),
      { contact: { email: null, type: null } },
    ],
    [
      'a contact point removed',
      (form: Record<string, unknown>) => delete form.contact,
      { contact: { email: null, type: null } },
    ],
    [
      'two changes at once, and nothing else',
      (form: Record<string, unknown>) => {
        form.name = 'Both';
        form.url = '';
      },
      { name: 'Both', url: null },
    ],
  ])('holds only %s', (_what, edit, expected) => {
    const patch = change(edit);
    expect(patch).toEqual(expected);
    expect(hasChanges(patch)).toBe(true);
  });

  it('never holds the icon, and never a field the caller may not write', () => {
    const memberFields = editFields(all, member);
    const form = structuredClone(initial);
    form.slug = 'sneaky';
    form.provider = B;
    form.icon = 'x';
    form.name = 'Changed';
    expect(patchBody(initial, form, memberFields)).toEqual({ name: 'Changed' });
  });

  it('adds a contact point where there was none, as the pair', () => {
    const bare = formFromService(record({ contactEmail: null, contactType: null }), all);
    const form = structuredClone(bare);
    form.contact = { email: 'a@example.org', type: 'support' };
    expect(patchBody(bare, form, fields)).toEqual({
      contact: { email: 'a@example.org', type: 'support' },
    });
  });
});

describe('the check before a save', () => {
  const fields = editFields(all, member);
  const form = formFromService(record(), all);
  const issuesFor = (edit: (form: Record<string, unknown>) => void) => {
    const next = structuredClone(form);
    edit(next);
    return editIssues(schema.steps, next, fields).map((issue) => [issue.pointer, issue.keyword]);
  };

  it('finds nothing in a record as it is', () => {
    expect(issuesFor(() => {})).toEqual([]);
  });

  it.each([
    ['an emptied name', (f: Record<string, unknown>) => (f.name = ''), [['/name', 'required']]],
    [
      'a link that is no address',
      (f: Record<string, unknown>) => (f.url = 'tool'),
      [['/url', 'pattern']],
    ],
    [
      'an address of the contact point without a kind',
      (f: Record<string, unknown>) => (f.contact = { email: 'a@example.org' }),
      [['/contact/type', 'dependentRequired']],
    ],
  ])('finds %s', (_what, edit, expected) => {
    expect(issuesFor(edit)).toEqual(expected);
  });

  it('says nothing of a field the person cannot change, even when it is empty', () => {
    const next = structuredClone(form);
    delete next.slug;
    delete next.provider;
    expect(editIssues(schema.steps, next, fields)).toEqual([]);
  });

  it('maps the same fields as the wizard does', () => {
    expect(toBodyOf(form, fields)).toMatchObject({ name: 'Tool', consortia: [B, C] });
  });
});
