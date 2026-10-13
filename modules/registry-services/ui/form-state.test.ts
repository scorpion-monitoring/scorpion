// The wizard's form as pure functions: pointers, the mapping to the request body, the check of a step with the
// server's JSON Schema, where an error belongs and which step shows it, `applies`. The schema is the one the
// server builds for the shipped configuration (the same function the route calls), so the page's rules and the
// server's cannot be tested against a hand-copied shape.
import { ApiError } from '@scorpion/contracts/client';
import { failureOf } from '@scorpion/ui-kit/forms';
import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { FIELDS } from '../config/fields.ts';
import { STEPS } from '../config/steps.ts';
import { validateServicesConfig } from '../config/validate.ts';
import { service } from '../db/schema.ts';
import { buildCreateSchema } from '../service/create-schema.ts';
import { SEED_FIELD_TYPES } from '../service/field-types.ts';
import { SEED_ORG_ROLES } from '../service/registries.ts';
import { errorMap, fieldOfPointer, issueMessage } from './check-messages.ts';
import {
  bodyForStep,
  bodyFields,
  checkStep,
  failureView,
  firstStepWithError,
  getAt,
  noErrors,
  rememberErrors,
  shownErrors,
  withoutStep,
  setAt,
  startForm,
  stepOfPointer,
  toBody,
  unknownPointers,
  visibleSteps,
} from './form-state.ts';
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
// Through JSON, as the page receives it.
const schema = JSON.parse(
  JSON.stringify(buildCreateSchema(resolved, SEED_ORG_ROLES, { devConsole: true })),
) as WizardSchema;

const ID = '0197a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b';
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

describe('pointers', () => {
  it.each([
    [{ a: { b: 1 } }, '/a/b', 1],
    [{ a: { b: 1 } }, '/a/c', undefined],
    [{ a: 1 }, '/a/b', undefined],
    [{ a: [1, 2] }, '/a/1', 2],
    [{ 'a/b': 3 }, '/a~1b', 3],
    [{}, '/x', undefined],
  ])('reads %j at %s', (form, pointer, expected) => {
    expect(getAt(form, pointer)).toEqual(expected);
  });

  it('sets a value at a pointer, creating the objects on the way, and removes a key with undefined', () => {
    const form: Record<string, unknown> = {};
    setAt(form, '/contact/email', 'a@b.org');
    expect(form).toEqual({ contact: { email: 'a@b.org' } });
    setAt(form, '/contact/email', undefined);
    expect(form).toEqual({ contact: {} });
    setAt(form, '/name', 'x');
    expect(form).toEqual({ contact: {}, name: 'x' });
  });
});

describe('the start of a form', () => {
  it('is the server’s defaults, as a copy', () => {
    const form = startForm(schema);
    expect(form).toEqual({ stage: 'DEV', sameAs: [], consortia: [] });
    (form.sameAs as string[]).push('x');
    expect(schema.defaults.sameAs).toEqual([]);
  });
});

describe('toBody', () => {
  const body = (form: Record<string, unknown>) => toBody(form, schema);

  it('trims every text and leaves an emptied optional field out', () => {
    expect(
      body({
        slug: ' a ',
        name: ' My  service ',
        stage: 'DEV',
        description: '  ',
        url: '',
        license: '',
      }),
    ).toEqual({ slug: 'a', name: 'My  service', stage: 'DEV', sameAs: [], consortia: [] });
  });

  it('makes an emptied list `[]` and drops the empty and blank items of a list', () => {
    expect(body({ sameAs: [' ', '', ' https://x.org '], consortia: [] })).toEqual({
      sameAs: ['https://x.org'],
      consortia: [],
    });
    expect(body({})).toEqual({ sameAs: [], consortia: [] });
    expect(body({ sameAs: ['', ' '] }).sameAs).toEqual([]);
  });

  it('leaves the contact point out when neither part is given, and keeps one part for the step to report', () => {
    expect(body({ contact: { email: ' ', type: '' } })).not.toHaveProperty('contact');
    expect(body({ contact: {} })).not.toHaveProperty('contact');
    expect(body({ contact: { email: 'a@b.org', type: '' } }).contact).toEqual({ email: 'a@b.org' });
    expect(body({ contact: { email: 'a@b.org', type: 'support' } }).contact).toEqual({
      email: 'a@b.org',
      type: 'support',
    });
  });

  it('never sends the icon, whatever the form holds', () => {
    expect(body({ icon: 'data:image/png;base64,AAAA' })).not.toHaveProperty('icon');
  });

  it('keeps a key no field owns, so the check and the server judge it', () => {
    expect(body({ colour: 'red' })).toMatchObject({ colour: 'red' });
  });

  it('is the same when applied twice', () => {
    const once = body({
      slug: ' a ',
      contact: { email: 'x@y.org', type: 'support' },
      sameAs: [' u '],
    });
    expect(body(once)).toEqual(once);
  });

  it('does not change the form', () => {
    const form = { slug: ' a ', sameAs: [' u '] };
    body(form);
    expect(form).toEqual({ slug: ' a ', sameAs: [' u '] });
  });
});

describe('checkStep', () => {
  const [basics, provision, contact] = schema.steps;
  const keywords = (step: (typeof schema.steps)[number], form: Record<string, unknown>) =>
    checkStep(step, toBody(form, schema)).map((issue) => `${issue.pointer} ${issue.keyword}`);

  it('asks for the required fields of a step and nothing of the others', () => {
    expect(keywords(basics!, { stage: 'DEV' })).toEqual(['/slug required', '/name required']);
    expect(keywords(provision!, {})).toEqual(['/provider required']);
    expect(keywords(contact!, {})).toEqual([]);
  });

  it('accepts a good step', () => {
    expect(keywords(basics!, { slug: 'a', name: 'n', stage: 'DEV', url: 'https://x.org' })).toEqual(
      [],
    );
    expect(keywords(provision!, { provider: ID, consortia: [ID] })).toEqual([]);
  });

  it('names the pointer of a bad value, an item of a list included', () => {
    expect(
      keywords(basics!, { slug: 'a b', name: 'n', sameAs: ['https://x.org', 'nope'] }),
    ).toEqual(['/slug pattern', '/sameAs/1 pattern']);
    expect(keywords(provision!, { provider: 'x' })).toEqual(['/provider pattern']);
  });

  it('asks for both parts of the contact point, or neither', () => {
    expect(keywords(contact!, { contact: { email: 'a@b.org' } })).toEqual([
      '/contact/type dependentRequired',
    ]);
    expect(keywords(contact!, { contact: { type: 'support' } })).toEqual([
      '/contact/email dependentRequired',
    ]);
    expect(keywords(contact!, { contact: { email: 'a@b.org', type: 'support' } })).toEqual([]);
  });

  it('holds the limits of the server’s constants', () => {
    expect(keywords(basics!, { slug: 'a', name: 'x'.repeat(201) })).toEqual(['/name maxLength']);
    expect(
      keywords(basics!, {
        slug: 'a',
        name: 'n',
        sameAs: Array.from({ length: 21 }, (_, i) => `https://x.org/${i}`),
      }),
    ).toEqual(['/sameAs maxItems']);
  });

  it('takes from a body only what belongs to the step', () => {
    expect(bodyForStep({ slug: 'a', provider: ID, contact: { email: 'x' } }, basics!)).toEqual({
      slug: 'a',
    });
    expect(bodyForStep({ contact: { email: 'x', type: 'y' } }, contact!)).toEqual({
      contact: { email: 'x', type: 'y' },
    });
  });
});

describe('keys no field owns', () => {
  it.each([
    [{ slug: 'a' }, []],
    [{ colour: 'red' }, ['/colour']],
    [{ contact: { email: 'a', fax: '1' } }, ['/contact/fax']],
    [{ contact: 'x' }, ['/contact']],
    [{ icon: 'x' }, []],
  ])('finds %j', (body, expected) => {
    expect(unknownPointers(body, schema)).toEqual(expected);
  });
});

describe('where an error belongs', () => {
  it('finds the step of a pointer, an item of a list and a nested pointer included', () => {
    expect(stepOfPointer(schema.steps, '/slug')).toBe('basics');
    expect(stepOfPointer(schema.steps, '/sameAs/3')).toBe('basics');
    expect(stepOfPointer(schema.steps, '/provider')).toBe('provision');
    expect(stepOfPointer(schema.steps, '/contact/type')).toBe('contact');
    expect(stepOfPointer(schema.steps, '/colour')).toBeUndefined();
  });

  it('goes to the first step, in order, that has an error', () => {
    expect(firstStepWithError(schema.steps, ['/contact/type', '/provider'])).toBe('provision');
    expect(firstStepWithError(schema.steps, ['/provider', '/name'])).toBe('basics');
    expect(firstStepWithError(schema.steps, ['/colour'])).toBeUndefined();
    expect(firstStepWithError(schema.steps, [])).toBeUndefined();
  });

  it('finds the field of a pointer', () => {
    expect(fieldOfPointer(schema.steps, '/sameAs/1')?.key).toBe('sameAs');
    expect(fieldOfPointer(schema.steps, '/contact/email')?.key).toBe('contactEmail');
    expect(fieldOfPointer(schema.steps, '/nope')).toBeUndefined();
  });
});

describe('the words for a failed rule', () => {
  const field = (key: string) => schema.steps.flatMap((s) => s.fields).find((f) => f.key === key);
  it.each([
    [{ pointer: '/name', keyword: 'required' as const }, 'name', 'services.check.required'],
    [
      { pointer: '/name', keyword: 'maxLength' as const, limit: 200 },
      'name',
      'services.check.maxLength {"limit":200}',
    ],
    [{ pointer: '/slug', keyword: 'pattern' as const }, 'slug', 'services.check.pattern.slug'],
    [{ pointer: '/url', keyword: 'pattern' as const }, 'url', 'services.check.pattern.url'],
    [{ pointer: '/sameAs/0', keyword: 'pattern' as const }, 'sameAs', 'services.check.pattern.url'],
    [
      { pointer: '/contact/email', keyword: 'pattern' as const },
      'contactEmail',
      'services.check.pattern.email',
    ],
    [
      { pointer: '/description', keyword: 'pattern' as const },
      'description',
      'services.check.pattern',
    ],
    [
      { pointer: '/sameAs', keyword: 'maxItems' as const, limit: 20 },
      'sameAs',
      'services.check.maxItems {"limit":20}',
    ],
    [
      { pointer: '/contact/type', keyword: 'dependentRequired' as const },
      'contactType',
      'services.check.dependentRequired',
    ],
    [{ pointer: '/x', keyword: 'additionalProperties' as const }, 'slug', 'services.check.unknown'],
    [{ pointer: '/x', keyword: 'unsupported' as const }, 'slug', 'services.check.unsupported'],
    [{ pointer: '/x', keyword: 'type' as const }, 'slug', 'services.check.invalid'],
  ])('%j', (issue, key, expected) => {
    expect(issueMessage(issue, field(key), t)).toBe(expected);
  });

  it('collects the sentences by pointer, each once', () => {
    const map = errorMap(
      [
        { pointer: '/name', keyword: 'minLength', limit: 1 },
        { pointer: '/name', keyword: 'required' },
        { pointer: '/slug', keyword: 'pattern' },
      ],
      schema.steps,
      t,
    );
    expect([...map]).toEqual([
      ['/name', ['services.check.required']],
      ['/slug', ['services.check.pattern.slug']],
    ]);
  });
});

describe('steps that apply', () => {
  it('shows every step unless its `applies` says no, for this form state', () => {
    const applies = { provision: (form: Record<string, unknown>) => form.stage !== 'TERM' };
    expect(visibleSteps(schema.steps, { stage: 'DEV' }, applies).map((s) => s.id)).toEqual([
      'basics',
      'provision',
      'contact',
    ]);
    expect(visibleSteps(schema.steps, { stage: 'TERM' }, applies).map((s) => s.id)).toEqual([
      'basics',
      'contact',
    ]);
    expect(visibleSteps(schema.steps, {}, {}).map((s) => s.id)).toEqual([
      'basics',
      'provision',
      'contact',
    ]);
  });

  it('lists the fields that are part of the body, in the order of the steps', () => {
    expect(bodyFields(schema.steps).map((f) => f.key)).toEqual([
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
    ]);
  });
});

describe('what the server said', () => {
  const failed = (status: number, errors?: { path: string; message: string }[], type?: string) =>
    failureOf(
      new ApiError(status, {
        type: type ?? 'about:blank',
        title: 'x',
        status,
        ...(errors && { errors: errors.map((e) => ({ in: 'body', ...e })) }),
      } as never),
    );

  it('puts a 422 on the fields it names, by pointer, an item of a list and a nested field included', () => {
    const view = failureView(
      failed(422, [
        { path: 'slug', message: 'The slug may contain letters.' },
        { path: 'contact.type', message: 'Needed.' },
        { path: 'sameAs.2', message: 'Link 3 is not a valid URL.' },
        { path: 'license', message: '"Nope" is not an SPDX licence id.' },
      ]),
      schema,
      t,
    );
    expect(view.messages).toEqual([
      ['/slug', ['The slug may contain letters.']],
      ['/contact/type', ['Needed.']],
      ['/sameAs/2', ['Link 3 is not a valid URL.']],
      ['/license', ['"Nope" is not an SPDX licence id.']],
    ]);
    expect(view.loose).toEqual([]);
  });

  it('keeps a message for a key that is no field, with its pointer, so nothing is dropped', () => {
    const view = failureView(
      failed(422, [{ path: 'colour', message: 'This field is not known.' }]),
      schema,
      t,
    );
    expect(view.messages).toEqual([]);
    expect(view.loose).toEqual(['/colour: This field is not known.']);
  });

  it('shows a taken slug on the slug field in the catalogue’s words, without the value', () => {
    const view = failureView(
      failed(
        409,
        [{ path: 'slug', message: 'This slug is already taken.' }],
        'https://x/problems/slug-taken',
      ),
      schema,
      t,
    );
    expect(view.messages).toEqual([['/slug', ['services.error.slugTaken']]]);
    expect(view.loose).toEqual([]);
  });

  it('says in one sentence that a provider the caller is not a member of is refused (403)', () => {
    expect(failureView(failed(403), schema, t)).toEqual({
      messages: [],
      loose: ['services.error.forbidden'],
    });
  });

  it.each([
    [0, 'kit.error.network'],
    [429, 'kit.error.throttled'],
    [500, 'kit.error.generic'],
  ])('uses the generic sentence of status %i', (status, key) => {
    const failure = status === 0 ? failureOf(new Error('offline')) : failed(status);
    expect(failureView(failure, schema, t).loose).toEqual([key]);
  });
});

describe('the errors on the fields', () => {
  it('go when the person changes the field they belong to, and stay for the others', () => {
    const body = { slug: 'a b', name: '' };
    const found = rememberErrors(
      [
        ['/slug', ['bad']],
        ['/name', ['needed']],
      ],
      body,
    );
    expect([...shownErrors(found, body)]).toEqual([
      ['/slug', ['bad']],
      ['/name', ['needed']],
    ]);
    expect([...shownErrors(found, { slug: 'ab', name: '' })]).toEqual([['/name', ['needed']]]);
    expect([...shownErrors(noErrors(), body)]).toEqual([]);
  });

  it('are remembered with a copy of the value, so a later edit of the same object does not hide them by accident', () => {
    const body = { sameAs: ['x'] };
    const found = rememberErrors([['/sameAs/0', ['bad']]], body);
    body.sameAs[0] = 'y';
    expect([...shownErrors(found, body)]).toEqual([]);
  });

  it('are replaced per step: the messages of the other steps stay', () => {
    const found = rememberErrors(
      [
        ['/slug', ['a']],
        ['/provider', ['b']],
        ['/sameAs/1', ['c']],
      ],
      {},
    );
    const basics = schema.steps[0]!;
    expect(withoutStep(found, basics).map(([pointer]) => pointer)).toEqual(['/provider']);
  });
});
