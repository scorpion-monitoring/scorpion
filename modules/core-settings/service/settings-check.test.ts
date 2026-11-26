// The registry `settings.check` (M16 sprint 3): a module adds a rule its settings must keep that needs data its schema cannot
// see. A problem comes back as one 422 on `values.<path>` and nothing is written; a check that throws is a 422 too, never a 500;
// the check is asked for its own module only, on every way of saving. Over real Postgres with the real authoriser.
import { DomainError } from '@scorpion/contracts';
import { defineModule } from '@scorpion/kernel';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { useSettings, widgetsModule } from '../test/harness.ts';
import { indexSettingsChecks } from './settings.ts';

const harness = useSettings();

const checkedSettings = z.strictObject({ code: z.string().max(20).optional() });
const asked: { values: unknown; before: unknown }[] = [];

/** A module whose `code` may not be `taken`, and whose check breaks on `boom`; it asks only when `code` changed. */
function checkedModule() {
  return {
    id: 'fix.checked',
    manifest: defineModule({
      id: 'fix.checked',
      version: '1.0.0',
      settings: checkedSettings,
      services: () => ({}),
      contributes: {
        'settings.check': [
          {
            module: 'fix.checked',
            check(values: unknown, before: unknown) {
              asked.push({ values, before });
              const code = (values as { code?: string }).code;
              if (code === (before as { code?: string } | undefined)?.code)
                return Promise.resolve([]);
              if (code === 'boom')
                return Promise.reject(new Error('the other module is down at https://x/?key=k'));
              return Promise.resolve(
                code === 'taken' ? [{ path: 'code', message: 'Is taken elsewhere.' }] : [],
              );
            },
          },
        ],
      },
    }),
  };
}

async function setup() {
  asked.length = 0;
  const started = await harness.start({ modules: [widgetsModule(), checkedModule()] });
  return { ...started, admin: await started.actorOf('admin'), service: started.settings.settings };
}

async function failure(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('settings.check', () => {
  it('refuses a save that breaks the rule with a 422 on the field, and writes nothing', async () => {
    const { service, admin } = await setup();
    const error = await failure(
      service.update(admin, 'fix.checked', { version: 0, values: { code: 'taken' } }),
    );
    expect(error.status).toBe(422);
    expect(error.errors).toEqual([
      { in: 'body', path: 'values.code', message: 'Is taken elsewhere.' },
    ]);
    expect((await service.get(admin, 'fix.checked')).version).toBe(0);
    const saved = await service.update(admin, 'fix.checked', {
      version: 0,
      values: { code: 'free' },
    });
    expect(saved).toMatchObject({ version: 1, values: { code: 'free' } });
    expect(asked.at(-1)).toEqual({ values: { code: 'free' }, before: undefined });
  });

  it('turns a check that throws into a 422 on `values` without its message, never a 500', async () => {
    const { service, admin } = await setup();
    const error = await failure(
      service.update(admin, 'fix.checked', { version: 0, values: { code: 'boom' } }),
    );
    expect(error.status).toBe(422);
    expect(error.errors).toEqual([
      { in: 'body', path: 'values', message: 'Could not be checked; try again.' },
    ]);
    expect(JSON.stringify(error)).not.toContain('key=k');
  });

  it('is asked with what was stored before, so a value kept as it was passes', async () => {
    const { service, admin } = await setup();
    await service.update(admin, 'fix.checked', { version: 0, values: { code: 'mine' } });
    await service.update(admin, 'fix.checked', { version: 1, values: {} });
    expect(asked.at(-1)).toEqual({ values: {}, before: { code: 'mine' } });
  });

  it('is asked for its own module only, and on the trusted saves too', async () => {
    const { service, admin, settings } = await setup();
    await service.update(admin, 'fix.widgets', { version: 0, values: { limit: 4 } });
    expect(asked).toEqual([]);
    await expect(settings.settings.seed('fix.checked', { code: 'taken' })).rejects.toMatchObject({
      status: 422,
    });
    await expect(settings.settings.seedKey('fix.checked', 'code', 'taken')).rejects.toMatchObject({
      status: 422,
    });
    expect(await settings.settings.seedKey('fix.checked', 'code', 'free')).toBe('seeded');
  });

  it('refuses a malformed entry at start', () => {
    expect(() => indexSettingsChecks([{ module: 'x', check: 'not a function' }])).toThrow();
    expect(() =>
      indexSettingsChecks([{ module: 'x', check: () => Promise.resolve([]), extra: 1 }]),
    ).toThrow();
    expect([
      ...indexSettingsChecks([{ module: 'x', check: () => Promise.resolve([]) }]).keys(),
    ]).toEqual(['x']);
  });
});
