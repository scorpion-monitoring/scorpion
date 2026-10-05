import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.ts';
import { createSettingsPort, resolveSettings } from './settings.ts';

const schema = z.strictObject({
  enabled: z.boolean().default(true),
  limit: z.number().int().min(1).max(10).default(5),
  name: z.string().trim().min(1).optional(),
  nested: z.strictObject({ a: z.number().default(1) }).default({ a: 1 }),
});

describe('resolveSettings', () => {
  it.each([
    ['nothing stored', undefined, { enabled: true, limit: 5, nested: { a: 1 } }, []],
    ['not an object', 'text', { enabled: true, limit: 5, nested: { a: 1 } }, []],
    ['an array', [1], { enabled: true, limit: 5, nested: { a: 1 } }, []],
    ['a valid value', { enabled: false }, { enabled: false, limit: 5, nested: { a: 1 } }, []],
    [
      'a key of the wrong type falls back to its default',
      { enabled: false, limit: 'many' },
      { enabled: false, limit: 5, nested: { a: 1 } },
      ['limit'],
    ],
    [
      'a key out of range falls back, the others stay',
      { enabled: false, limit: 99, name: ' x ' },
      { enabled: false, limit: 5, name: 'x', nested: { a: 1 } },
      ['limit'],
    ],
    [
      'a key the schema no longer knows is ignored',
      { enabled: false, gone: 1 },
      { enabled: false, limit: 5, nested: { a: 1 } },
      ['gone'],
    ],
    [
      'a bad nested value drops the whole top-level key',
      { limit: 2, nested: { a: 'x' } },
      { enabled: true, limit: 2, nested: { a: 1 } },
      ['nested'],
    ],
  ])('%s', (_name, stored, expected, dropped) => {
    expect(resolveSettings(schema, stored)).toEqual({ value: expected, dropped });
  });

  it('throws, without a value in the message, when a required setting was never stored', () => {
    const required = z.strictObject({ endpoint: z.string().min(1) });
    expect(() => resolveSettings(required, {})).toThrowError(/endpoint/);
    expect(() => resolveSettings(required, { endpoint: 42 })).toThrowError(/endpoint/);
  });
});

describe('createSettingsPort', () => {
  const log = createLogger({ level: 'silent' });

  it('yields the defaults of the schema without a store', async () => {
    const port = createSettingsPort({ moduleId: 'm', schema, store: () => undefined, log });
    expect(await port.get()).toEqual({ enabled: true, limit: 5, nested: { a: 1 } });
  });

  it('yields an empty object for a module without a schema', async () => {
    const port = createSettingsPort({
      moduleId: 'm',
      schema: undefined,
      store: () => ({ read: () => Promise.resolve({ x: 1 }) }),
      log,
    });
    expect(await port.get()).toEqual({});
  });

  it('reads the stored value of its own module from the store', async () => {
    const asked: string[] = [];
    const port = createSettingsPort({
      moduleId: 'm',
      schema,
      store: () => ({
        read: (id) => {
          asked.push(id);
          return Promise.resolve({ limit: 3 });
        },
      }),
      log,
    });
    expect((await port.get()) as { limit: number }).toMatchObject({ limit: 3 });
    expect(asked).toEqual(['m']);
  });

  it('warns once per distinct set of ignored keys, with names and no values', async () => {
    const lines: string[] = [];
    const { Writable } = await import('node:stream');
    const loud = createLogger({
      level: 'warn',
      destination: new Writable({
        write(chunk: Buffer, _encoding, callback) {
          lines.push(chunk.toString());
          callback();
        },
      }),
    });
    const port = createSettingsPort({
      moduleId: 'm',
      schema,
      store: () => ({ read: () => Promise.resolve({ limit: 'hunter2-secret' }) }),
      log: loud,
    });
    await port.get();
    await port.get();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('limit');
    expect(lines[0]).not.toContain('hunter2-secret');
  });
});
