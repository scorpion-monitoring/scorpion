import { describe, expect, it } from 'vitest';
import { SEED_FIELD_TYPES } from './field-types.ts';
import { fieldTypeEntrySchema, type FieldEnv, type FieldTypeEntry } from './registries.ts';

const type = (id: string): FieldTypeEntry => SEED_FIELD_TYPES.find((t) => t.id === id)!;
const parse = (id: string, config: Record<string, unknown>, value: unknown) =>
  type(id)
    .schema(type(id).configSchema.parse(config) as Record<string, unknown>)
    .safeParse(value);

const env = (over: Partial<FieldEnv> = {}): FieldEnv => ({
  vocabularyHas: (_vocabulary, key) => Promise.resolve(key === 'DEV'),
  findLicence: (id) => Promise.resolve(id.toLowerCase() === 'mit' ? { id: 'MIT' } : undefined),
  ...over,
});

describe('the seeded field types', () => {
  it('are exactly text, select, multi-select, license, organisation and image, all valid entries', () => {
    expect(SEED_FIELD_TYPES.map((t) => t.id)).toEqual([
      'text',
      'select',
      'multi-select',
      'license',
      'organisation',
      'image',
    ]);
    for (const t of SEED_FIELD_TYPES) {
      expect(fieldTypeEntrySchema.safeParse(t).success, t.id).toBe(true);
    }
  });

  it('give every type a JSON Schema for the browser', () => {
    expect(type('text').jsonSchema({ format: 'slug' })).toMatchObject({
      type: 'string',
      maxLength: 64,
      pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$',
    });
    expect(type('text').jsonSchema({ format: 'url', multiple: true })).toMatchObject({
      type: 'array',
      maxItems: 20,
      items: { type: 'string', format: 'uri' },
    });
    expect(type('select').jsonSchema({ options: [{ value: 'a', label: 'x.y' }] })).toEqual({
      type: 'string',
      enum: ['a'],
    });
    expect(type('multi-select').jsonSchema({ vocabulary: 'stage' })).toMatchObject({
      type: 'array',
      uniqueItems: true,
    });
    expect(type('license').jsonSchema({})).toMatchObject({ type: 'string' });
    expect(type('organisation').jsonSchema({ multiple: true })).toMatchObject({ type: 'array' });
    expect(type('image').jsonSchema({})).toMatchObject({ type: 'string' });
  });
});

describe('text', () => {
  it.each([
    [{ format: 'slug' }, 'ok-slug', true],
    [{ format: 'slug' }, 'new', false],
    [{ format: 'name' }, '', false],
    [{ format: 'url', multiple: true }, ['https://a.example', 'https://a.example/'], true],
    [{ format: 'url', multiple: true }, ['mailto:x@y.z'], false],
    [{ format: 'url', multiple: true }, 'https://a.example', false],
    [{ format: 'url' }, 12, false],
    [{}, 'free text', true],
  ])('config %j value %j: %s', (config, value, ok) => {
    expect(parse('text', config, value).success).toBe(ok);
  });

  it('normalises a list: trimmed, de-duplicated, order kept', () => {
    const result = parse('text', { format: 'url', multiple: true }, [
      ' https://b.example ',
      'https://a.example',
      'https://b.example/',
    ]);
    expect(result.success && result.data).toEqual(['https://b.example', 'https://a.example']);
  });

  it('allows a list only for the format url', () => {
    expect(type('text').configSchema.safeParse({ format: 'name', multiple: true }).success).toBe(
      false,
    );
  });
  it('refuses more than 20 links', () => {
    const many = Array.from({ length: 21 }, (_, i) => `https://e${i}.example`);
    expect(parse('text', { format: 'url', multiple: true }, many).success).toBe(false);
  });
});

describe('select and multi-select', () => {
  const options = {
    options: [
      { value: 'a', label: 'x.a' },
      { value: 'b', label: 'x.b' },
    ],
  };
  it('accept one of the listed options', () => {
    expect(parse('select', options, 'a').success).toBe(true);
    expect(parse('select', options, 'c').success).toBe(false);
    expect(parse('multi-select', options, ['a', 'b']).success).toBe(true);
    expect(parse('multi-select', options, ['a', 'a']).success).toBe(false);
    expect(parse('multi-select', options, ['a', 'c']).success).toBe(false);
  });
  it('take a vocabulary or options, not both and not neither', () => {
    const config = type('select').configSchema;
    expect(config.safeParse({}).success).toBe(false);
    expect(config.safeParse({ vocabulary: 'stage', ...options }).success).toBe(false);
    expect(config.safeParse({ vocabulary: 'stage' }).success).toBe(true);
  });
  it('check the vocabulary through the environment', async () => {
    const check = type('select').check!;
    expect(await check('DEV', { vocabulary: 'stage' }, env())).toBeUndefined();
    expect(await check('OLD', { vocabulary: 'stage' }, env())).toEqual({
      problem: '"OLD" is not an available term of "stage".',
    });
    expect(await check('a', options, env())).toBeUndefined(); // a fixed list needs no lookup
    const multi = type('multi-select').check!;
    expect(await multi(['DEV', 'OLD'], { vocabulary: 'stage' }, env())).toEqual({
      problem: '"OLD" is not an available term of "stage".',
    });
  });
});

describe('license', () => {
  it('checks the SPDX list and answers the canonical id', async () => {
    const check = type('license').check!;
    expect(await check('mit', {}, env())).toEqual({ value: 'MIT' });
    expect(await check('Nope-1.0', {}, env())).toEqual({
      problem: '"Nope-1.0" is not an SPDX licence id.',
    });
  });
  it('trims and bounds the id before it asks', () => {
    expect(parse('license', {}, '  MIT ').success).toBe(true);
    expect(parse('license', {}, '').success).toBe(false);
    expect(parse('license', {}, 'x'.repeat(65)).success).toBe(false);
  });
});

describe('organisation and image', () => {
  it('organisation takes a UUID, or a list of them for a role with many', () => {
    const id = '0198f9c0-1234-7abc-8def-0123456789ab';
    expect(parse('organisation', {}, id).success).toBe(true);
    expect(parse('organisation', {}, 'IPK').success).toBe(false);
    expect(parse('organisation', { multiple: true }, [id]).success).toBe(true);
    expect(parse('organisation', { multiple: true }, id).success).toBe(false);
  });
  it('image never validates: the icon is uploaded after the service exists', () => {
    const result = parse('image', {}, 'data:image/png;base64,AAAA');
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.message).toMatch(/uploaded after/);
  });
  it('each type lists the storages it may use', () => {
    expect(type('organisation').storages).toEqual(['organisations']);
    expect(type('image').storages).toEqual(['icon']);
    expect(type('multi-select').storages).toEqual(['value']);
  });
});
