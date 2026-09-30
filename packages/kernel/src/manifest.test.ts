import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { KernelStartupError } from './errors.ts';
import { defineModule, MODULE_ID, EVENT_NAME, validateManifest } from './manifest.ts';
import { defineProfile } from './profile.ts';

const valid = { id: 'kpi.ingestion', version: '1.0.0' };

function problemsOf(manifest: unknown): readonly string[] {
  try {
    validateManifest(manifest, 'test');
  } catch (error) {
    if (error instanceof KernelStartupError) return error.problems;
    throw error;
  }
  throw new Error('expected validation to fail');
}

describe('module and event names', () => {
  it.each(['kpi.ingestion', 'core.ui-shell', 'maturity', 'a.b.c', 'public-api'])(
    'accepts module id %s',
    (id) => {
      expect(MODULE_ID.test(id)).toBe(true);
    },
  );
  it.each(['', 'Kpi', 'kpi.', '.kpi', 'kpi..x', 'kpi_x', '1kpi', 'kpi.-x', 'kpi.x-'])(
    'rejects module id "%s"',
    (id) => {
      expect(MODULE_ID.test(id)).toBe(false);
    },
  );
  it.each(['service.created@1', 'kpiSet.changed@2', 'measurement.recorded@10'])(
    'accepts event %s',
    (name) => {
      expect(EVENT_NAME.test(name)).toBe(true);
    },
  );
  it.each([
    'service.created',
    'service@1',
    'service.created@0',
    'service.created@',
    'Service.created@1',
  ])('rejects event "%s"', (name) => {
    expect(EVENT_NAME.test(name)).toBe(false);
  });
});

describe('validateManifest', () => {
  it('accepts a minimal manifest and a full one', () => {
    expect(validateManifest(valid, 'test')).toEqual(valid);
    const full = defineModule({
      ...valid,
      tablePrefix: 'kpi_ingestion_',
      permissions: {
        'kpi.ingestion.measurement.submit': { scope: 'service', description: 'Submit' },
      },
      settings: z.object({ maxRows: z.number().default(1000) }),
      schema: () => Promise.resolve({}),
      migrations: '/tmp/migrations',
      services: () => ({}),
      routes: () => {},
      jobs: [
        {
          name: 'kpi.ingestion.reminder',
          schedule: '0 6 5 * *',
          handler: async () => {},
          retry: { limit: 3, delaySeconds: 60 },
          timeoutSeconds: 300,
        },
      ],
      events: {
        emits: { 'measurement.recorded@1': z.object({ serviceId: z.string() }) },
        on: { 'system.ready': async () => {} },
      },
      registries: { 'ingestion.adapter': z.object({ id: z.string() }) },
      contributes: { 'ingestion.adapter': [{ id: 'csv' }] },
      ui: () => Promise.resolve({}),
    });
    expect(() => validateManifest(full, 'test')).not.toThrow();
  });

  const invalid: [string, unknown, string][] = [
    ['not an object', 'nope', 'expected object'],
    ['a bad id', { ...valid, id: 'Kpi Ingestion' }, 'id: must be dot-separated'],
    ['a bad version', { ...valid, version: '1' }, 'version: must be a semantic version'],
    [
      'a dependsOn list (dependencies come from package.json)',
      { ...valid, dependsOn: ['a'] },
      'dependsOn',
    ],
    ['an unknown field', { ...valid, colour: 'red' }, 'colour'],
    [
      'settings that are not a Zod schema',
      { ...valid, settings: { type: 'object' } },
      'settings: expected a Zod schema',
    ],
    [
      'services that is not a function',
      { ...valid, services: {} },
      'services: expected a function',
    ],
    ['a bad table prefix', { ...valid, tablePrefix: 'Kpi' }, 'tablePrefix'],
    [
      'an unprefixed permission',
      { ...valid, permissions: { 'measurement.submit': { description: 'x' } } },
      'must be prefixed with the module id',
    ],
    [
      'a permission that is only the prefix',
      { ...valid, permissions: { 'kpi.ingestion.': { description: 'x' } } },
      'must be prefixed with the module id',
    ],
    [
      'a permission of another module',
      { ...valid, permissions: { 'kpi.framework.read': { description: 'x' } } },
      'must be prefixed with the module id',
    ],
    [
      'a permission without a description',
      { ...valid, permissions: { 'kpi.ingestion.x': {} } },
      'description',
    ],
    [
      'an unversioned emitted event',
      { ...valid, events: { emits: { 'measurement.recorded': z.object({}) } } },
      'must be versioned',
    ],
    [
      'an emitted payload that is not a Zod schema',
      { ...valid, events: { emits: { 'measurement.recorded@1': {} } } },
      'expected a Zod schema',
    ],
    [
      'an unversioned subscription',
      { ...valid, events: { on: { 'service.created': async () => {} } } },
      'must be a versioned event name',
    ],
    [
      'an unprefixed job name',
      {
        ...valid,
        jobs: [
          {
            name: 'reminder',
            handler: async () => {},
            retry: { limit: 1, delaySeconds: 1 },
            timeoutSeconds: 1,
          },
        ],
      },
      'job "reminder" must be prefixed with the module id',
    ],
    [
      'a job without retry settings',
      { ...valid, jobs: [{ name: 'kpi.ingestion.x', handler: async () => {}, timeoutSeconds: 1 }] },
      'jobs.0.retry',
    ],
    [
      'the same job twice',
      {
        ...valid,
        jobs: [
          {
            name: 'kpi.ingestion.x',
            handler: async () => {},
            retry: { limit: 1, delaySeconds: 1 },
            timeoutSeconds: 1,
          },
          {
            name: 'kpi.ingestion.x',
            handler: async () => {},
            retry: { limit: 1, delaySeconds: 1 },
            timeoutSeconds: 1,
          },
        ],
      },
      'job "kpi.ingestion.x" is declared twice',
    ],
  ];

  it.each(invalid)('rejects %s', (_name, manifest, expected) => {
    expect(problemsOf(manifest).join('\n')).toContain(expected);
  });

  it('names the module in the message', () => {
    expect(() => validateManifest({ ...valid, version: 'x' }, 'test')).toThrowError(
      /Invalid module "kpi.ingestion":/,
    );
  });
});

describe('defineProfile', () => {
  it('keeps name and modules', () => {
    expect(defineProfile({ name: 'x', modules: [] })).toEqual({ name: 'x', modules: [] });
  });

  it('checks module ids against the workspace (no module exists yet, so any id is an error)', () => {
    // @ts-expect-error 'kpi.ingestion' is not a module in the workspace
    defineProfile({ name: 'x', modules: ['kpi.ingestion'] });
  });
});
