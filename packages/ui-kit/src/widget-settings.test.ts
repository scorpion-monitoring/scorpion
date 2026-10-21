import { describe, expect, it } from 'vitest';
import { fieldsOf, merged, problemsOf } from './widget-settings.ts';

// What `z.toJSONSchema(…, { io: 'input' })` writes for the analytics widgets' configuration.
const trends = {
  type: 'object',
  properties: {
    service: { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] },
    range: { type: 'string', enum: ['3m', '6m', '1y', '2y', 'all'], default: '1y' },
    category: { type: 'string', maxLength: 100, default: 'all' },
    hidden: { type: 'array', maxItems: 20, items: { type: 'string', pattern: '^[0-9a-f]{12}$' } },
    showTable: { type: 'boolean', default: false },
    layout: { type: 'string', enum: ['compact', 'wide'] },
    limit: { type: 'integer', minimum: 1 },
  },
} as const;

describe('fieldsOf', () => {
  it('draws the filter, the toggles and the choices in the order of the schema, and leaves the other shapes to the widget', () => {
    expect(fieldsOf(trends)).toEqual([
      { kind: 'service', name: 'service' },
      { kind: 'range', name: 'range', options: ['3m', '6m', '1y', '2y', 'all'] },
      { kind: 'category', name: 'category' },
      { kind: 'boolean', name: 'showTable' },
      { kind: 'choice', name: 'layout', options: ['compact', 'wide'] },
    ]);
  });

  it.each<[string, unknown]>([
    ['no properties', { type: 'object' }],
    ['properties that are not a record', { properties: [] }],
    ['a property that is not a schema', { properties: { range: true } }],
    ['a range with no enum', { properties: { range: { type: 'string' } } }],
    ['a range whose enum holds a number', { properties: { range: { enum: ['1y', 3] } } }],
  ])('draws nothing for %s and does not throw', (_name, schema) => {
    expect(() => fieldsOf(schema as never)).not.toThrow();
    expect(fieldsOf(schema as never).filter((field) => field.kind !== 'category')).toEqual([]);
  });
});

describe('merged', () => {
  const fields = fieldsOf(trends);
  it('replaces the fields the form draws and keeps every other key exactly', () => {
    const config = { service: null, range: '1y', hidden: ['0123456789ab'], extra: { n: 1 } };
    expect(merged(config, { service: 'abc', range: '3m' }, fields)).toEqual({
      service: 'abc',
      range: '3m',
      hidden: ['0123456789ab'],
      extra: { n: 1 },
    });
  });
  it('leaves a key out when the draft has none, except the service, which is "Choose a service" (null), and does not change its input', () => {
    const config = Object.freeze({ range: '1y', category: 'Usage' });
    expect(merged(config, { range: '2y' }, fields)).toEqual({ range: '2y', service: null });
    expect(config).toEqual({ range: '1y', category: 'Usage' });
  });
});

describe('problemsOf', () => {
  it.each<[string, Record<string, unknown>, string[]]>([
    ['a valid configuration', { service: null, range: '1y', category: 'all', hidden: [] }, []],
    ['a service that is an id', { service: 'c0ffee00-0000-4000-8000-000000000000' }, []],
    ['a range outside the values', { range: '5y' }, ['range']],
    ['a service that is a number', { service: 5 }, ['service']],
    ['a category that is too long', { category: 'x'.repeat(101) }, ['category']],
    ['a list that is too long', { hidden: Array(21).fill('0123456789ab') }, ['hidden']],
    ['a short id that is not hex', { hidden: ['zz'] }, ['hidden']],
  ])('%s', (_name, config, names) => {
    expect([...problemsOf(trends, config).keys()]).toEqual(names);
  });
});
