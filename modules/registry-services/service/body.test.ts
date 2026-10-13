import { describe, expect, it } from 'vitest';
import { FIELDS } from '../config/fields.ts';
import { STEPS } from '../config/steps.ts';
import { validateServicesConfig } from '../config/validate.ts';
import {
  dotted,
  fieldKeysOfInput,
  unknownPointers,
  validateBody,
  validatePatch,
  valueAt,
} from './body.ts';
import { SEED_FIELD_TYPES } from './field-types.ts';
import { SEED_ORG_ROLES, type FieldEnv } from './registries.ts';

const config = validateServicesConfig({
  fields: FIELDS,
  steps: STEPS,
  fieldTypes: SEED_FIELD_TYPES,
  orgRoles: SEED_ORG_ROLES,
  columns: {
    slug: 'scalar',
    name: 'scalar',
    license: 'scalar',
    stage: 'scalar',
    description: 'scalar',
    url: 'scalar',
    sameAs: 'array',
    contactEmail: 'scalar',
    contactType: 'scalar',
  },
});
const env: FieldEnv = {
  vocabularyHas: (_v, key) => Promise.resolve(['DEV', 'PROD'].includes(key)),
  findLicence: (id) => Promise.resolve(id.toLowerCase() === 'mit' ? { id: 'MIT' } : undefined),
};
const provider = '0198f9c0-1234-7abc-8def-0123456789ab';
const minimal = { slug: 'galaxy', name: 'Galaxy', provider };

const problemsOf = async (body: unknown) => {
  try {
    await validateBody(config, body, env);
  } catch (error) {
    return (error as { errors: { in: string; path: string; message: string }[] }).errors;
  }
  throw new Error('the body was accepted');
};

describe('validateBody', () => {
  it('returns the values by field key, the default stage included', async () => {
    const values = await validateBody(config, minimal, env);
    expect(Object.fromEntries(values)).toEqual({
      slug: 'galaxy',
      name: 'Galaxy',
      stage: 'DEV',
      provider,
    });
  });

  it('normalises every value through its type, the licence to its canonical id', async () => {
    const values = await validateBody(
      config,
      {
        ...minimal,
        name: '  Galaxy   EU ',
        license: 'mit',
        stage: 'PROD',
        description: ' About\r\nus ',
        url: 'https://Galaxy.example/',
        sameAs: ['https://a.example', 'https://a.example/'],
        contact: { email: 'Ops@Galaxy.EXAMPLE', type: 'Support' },
        consortia: [],
      },
      env,
    );
    expect(Object.fromEntries(values)).toMatchObject({
      name: 'Galaxy EU',
      license: 'MIT',
      stage: 'PROD',
      description: 'About\nus',
      url: 'https://galaxy.example',
      sameAs: ['https://a.example'],
      contactEmail: 'Ops@galaxy.example',
      contactType: 'Support',
      consortia: [],
    });
  });

  it('treats an emptied optional description as not set', async () => {
    const values = await validateBody(config, { ...minimal, description: '  ' }, env);
    expect(values.has('description')).toBe(false);
  });

  it.each([
    ['a body that is not an object', 'text', ''],
    ['an array', [], ''],
    ['null', null, ''],
  ])('refuses %s', async (_label, body, path) => {
    expect((await problemsOf(body))[0]).toMatchObject({ in: 'body', path });
  });

  it('names every missing required field by its pointer', async () => {
    const problems = await problemsOf({});
    expect(problems.map((p) => p.path).sort()).toEqual(['name', 'provider', 'slug']);
    expect(problems.every((p) => p.message === 'This field is required.')).toBe(true);
  });

  it('treats null like a missing value', async () => {
    const problems = await problemsOf({ ...minimal, name: null });
    expect(problems.map((p) => p.path)).toEqual(['name']);
  });

  it('refuses a key it does not know, at any depth, and never echoes its value', async () => {
    const problems = await problemsOf({
      ...minimal,
      admin: true,
      contact: { phone: 'secret-value' },
      id: 'x',
    });
    expect(problems.map((p) => p.path).sort()).toEqual(['admin', 'contact.phone', 'id']);
    expect(JSON.stringify(problems)).not.toContain('secret-value');
  });

  it('refuses the keys of columns that are no field: public, createdBy, iconBlobId', async () => {
    const problems = await problemsOf({ ...minimal, public: true, createdBy: 'x', iconHash: 'y' });
    expect(problems.map((p) => p.path).sort()).toEqual(['createdBy', 'iconHash', 'public']);
  });

  it('refuses the icon in the body: it is uploaded after the service exists', async () => {
    const problems = await problemsOf({ ...minimal, icon: 'data:image/png;base64,AAAA' });
    expect(problems).toEqual([
      {
        in: 'body',
        path: 'icon',
        message: 'The image is uploaded after the service has been created.',
      },
    ]);
  });

  it('reports a bad value at the dotted pointer of a nested field', async () => {
    const problems = await problemsOf({
      ...minimal,
      contact: { email: 'not-an-address', type: 'X' },
    });
    expect(problems).toEqual([
      { in: 'body', path: 'contact.email', message: 'The contact email is not a valid address.' },
    ]);
  });

  it('reports a bad item of a list at the field', async () => {
    const problems = await problemsOf({ ...minimal, sameAs: ['https://ok.example', 'ftp://bad'] });
    expect(problems).toHaveLength(1);
    expect(problems[0]!.path).toBe('sameAs');
  });

  it.each([
    [{ email: 'ops@x.example' }, 'contact.type'],
    [{ type: 'Support' }, 'contact.email'],
  ])('needs both parts of the contact point: %j', async (contact, path) => {
    const problems = await problemsOf({ ...minimal, contact });
    expect(problems).toEqual([
      {
        in: 'body',
        path,
        message: 'A contact point needs both an address and a type, or neither.',
      },
    ]);
  });

  it('asks the environment about an unknown stage and an unknown licence, each at its field', async () => {
    const problems = await problemsOf({ ...minimal, stage: 'BETA', license: 'Nope-1.0' });
    expect(problems.map((p) => [p.path, p.message])).toEqual([
      ['license', '"Nope-1.0" is not an SPDX licence id.'],
      ['stage', '"BETA" is not an available term of "stage".'],
    ]);
  });

  it('collects the problems of all fields, not only the first', async () => {
    const problems = await problemsOf({ slug: 'new', name: '', provider: 'x', stage: 'BETA' });
    expect(problems.map((p) => p.path).sort()).toEqual(['name', 'provider', 'slug', 'stage']);
  });

  it('never looks at a prototype key as a field', async () => {
    const problems = await problemsOf({
      ...minimal,
      __proto__: { polluted: true },
      constructor: 1,
    });
    expect(problems.map((p) => p.path)).toEqual(['constructor']);
  });
});

describe('the pointer helpers', () => {
  it('turn a pointer into a dotted path', () => {
    expect(dotted('/contact/type')).toBe('contact.type');
    expect(dotted('/name')).toBe('name');
  });
  it('read a value below a pointer, and nothing above a primitive', () => {
    expect(valueAt({ contact: { type: 'x' } }, '/contact/type')).toBe('x');
    expect(valueAt({ contact: 'x' }, '/contact/type')).toBeUndefined();
    expect(valueAt({}, '/contact/type')).toBeUndefined();
    expect(valueAt({ a: 1 }, '/toString')).toBeUndefined();
  });
  it('find the pointers of keys that no field owns', () => {
    const paths = new Set(['/name', '/contact/email']);
    expect(
      unknownPointers({ name: 'x', contact: { email: 'e', other: 1 }, extra: {} }, paths),
    ).toEqual(['/contact/other', '/extra']);
    // A parent that is not an object is itself unknown.
    expect(unknownPointers({ contact: 'text' }, paths)).toEqual(['/contact']);
  });
});

describe('fieldKeysOfInput', () => {
  it.each([
    [{ name: 'x' }, ['name']],
    [{ description: null }, ['description']],
    [{ contact: { email: 'a@example.org' } }, ['contactEmail']],
    [{ contact: { email: null, type: null }, slug: 's' }, ['slug', 'contactEmail', 'contactType']],
    [{ provider, consortia: [] }, ['provider', 'consortia']],
    [{ nonsense: 1 }, []],
    [{}, []],
    ['text', []],
    [null, []],
    [[], []],
  ])('names the configured fields of %j', (input, keys) => {
    expect(fieldKeysOfInput(config, input)).toEqual(keys);
  });
});

describe('validatePatch', () => {
  const patch = async (body: unknown) => Object.fromEntries(await validatePatch(config, body, env));
  const problems = async (body: unknown) => {
    try {
      await validatePatch(config, body, env);
    } catch (error) {
      return (error as { errors: { in: string; path: string; message: string }[] }).errors;
    }
    throw new Error('the patch was accepted');
  };

  it('returns only the fields it names, and no default', async () => {
    expect(await patch({ name: 'New' })).toEqual({ name: 'New' });
    expect(await patch({ description: 'x', license: 'mit' })).toEqual({
      description: 'x',
      license: 'MIT',
    });
  });

  it.each([
    [{ description: null }, { description: null }],
    [
      { url: null, sameAs: null },
      { url: null, sameAs: null },
    ],
    [{ license: null }, { license: null }],
    [{ consortia: null }, { consortia: null }],
    [{ contact: { email: null, type: null } }, { contactEmail: null, contactType: null }],
    [{ description: '' }, { description: null }],
  ])('clears an optional field: %j', async (body, expected) => {
    expect(await patch(body)).toEqual(expected);
  });

  it.each([
    [{ name: null }, 'name', 'This field is required.'],
    [{ slug: null }, 'slug', 'This field is required.'],
    [{ stage: null }, 'stage', 'This field is required.'],
    [{ provider: null }, 'provider', 'This field is required.'],
    [{ name: '' }, 'name', undefined],
    [{ stage: 'NOPE' }, 'stage', undefined],
    [{ license: 'nope' }, 'license', undefined],
    [{ icon: 'x' }, 'icon', 'The icon is changed through the icon route.'],
    [{ icon: null }, 'icon', 'The icon is changed through the icon route.'],
    [{ nonsense: 1 }, 'nonsense', 'This field is not known.'],
    [{}, '', 'Name at least one field to change.'],
  ])('refuses %j at %j', async (body, path, message) => {
    const found = await problems(body);
    expect(found.map((p) => p.path)).toContain(path);
    if (message) expect(found.find((p) => p.path === path)!.message).toBe(message);
  });

  it('reports every problem at once, by field, and refuses a body that is not an object', async () => {
    const found = await problems({ name: '', stage: 'NOPE', url: 'ftp://x' });
    expect(found.map((p) => p.path).sort()).toEqual(['name', 'stage', 'url']);
    expect((await problems('text'))[0]).toMatchObject({ in: 'body', path: '' });
  });
});
