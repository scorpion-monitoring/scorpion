// The module as the kernel sees it: its permissions and who holds them by default, the events it
// emits, the settings store it contributes (ADR 0017), and its place in the module graph.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from './module.ts';
import { useSettings } from './test/harness.ts';

const harness = useSettings();

describe('the manifest', () => {
  it('declares seven permissions, all prefixed with the module id', () => {
    expect(Object.keys(manifest.permissions ?? {}).sort()).toEqual([
      'core.settings.preference.read',
      'core.settings.preference.write',
      'core.settings.read',
      'core.settings.secret.write',
      'core.settings.vocabulary.read',
      'core.settings.vocabulary.write',
      'core.settings.write',
    ]);
  });

  it('emits four events and none carries a value or a label', () => {
    expect(Object.keys(manifest.events?.emits ?? {}).sort()).toEqual([
      'settings.changed@1',
      'settings.preference.changed@1',
      'settings.secret.changed@1',
      'settings.vocabulary.changed@1',
    ]);
  });

  it('uses the prefix settings_ for every table, in the schema and in the migrations', async () => {
    const tables = Object.values(await manifest.schema!()).filter(
      (value) => typeof value === 'object' && value !== null && Symbol.for('drizzle:Name') in value,
    );
    expect(tables.length).toBe(5);
    const dir = fileURLToPath(new URL('./migrations', import.meta.url));
    const sql = readdirSync(dir)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => readFileSync(join(dir, file), 'utf8'))
      .join('\n');
    const created = [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1]);
    expect(created.sort()).toEqual([
      'settings_secret',
      'settings_setting',
      'settings_user_preference',
      'settings_vocabulary',
      'settings_vocabulary_term',
    ]);
  });

  it('depends on core.authz and the sanitiser, and on nothing else of ours', () => {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(
      Object.keys(pkg.dependencies)
        .filter((name) => name.startsWith('@scorpion/'))
        .sort(),
    ).toEqual([
      '@scorpion/contracts',
      '@scorpion/core-authz',
      '@scorpion/kernel',
      '@scorpion/sanitize',
    ]);
  });
});

describe('who holds the permissions', () => {
  it('Admin holds all seven, User the preferences and reading vocabularies, Reviewer none', async () => {
    const { authz, actorOf } = await harness.start();
    const admin = await actorOf('admin');
    const roles = await authz.listRoles(admin);
    const held = (key: string) =>
      roles
        .find((role) => role.key === key)!
        .permissions.filter((p) => p.startsWith('core.settings.'));
    expect(held('admin')).toHaveLength(7);
    expect(held('user')).toEqual([
      'core.settings.preference.read',
      'core.settings.preference.write',
      'core.settings.vocabulary.read',
    ]);
    expect(held('reviewer')).toEqual([]);
  });
});

describe('the settings store', () => {
  it('serves another module its stored settings through ctx.settings', async () => {
    const { widgets, settings, actorOf } = await harness.start();
    const admin = await actorOf('admin');
    expect(await widgets.settings()).toMatchObject({ limit: 3 });
    await settings.settings.update(admin, 'fix.widgets', { version: 0, values: { limit: 6 } });
    expect(await widgets.settings()).toMatchObject({ limit: 6 });
  });

  it('serves the module’s own settings: the rate limits default to today’s numbers, branding to the product name', async () => {
    const { kernel } = await harness.start();
    expect(await kernel.settingsOf('core.settings').get()).toEqual({
      branding: { productName: 'Scorpion', logos: {}, legal: {} },
      rateLimits: {
        default: { burst: 120, perMinute: 120 },
        strict: { burst: 10, perMinute: 10 },
      },
    });
  });
});
