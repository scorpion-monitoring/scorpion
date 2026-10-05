// The module as the kernel sees it: permissions, registries, jobs, events, tables and its place in
// the module graph (ADR 0019).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest, { createNotificationsModule } from './module.ts';
import packageJson from './package.json' with { type: 'json' };
import { useNotifications } from './test/harness.ts';

const harness = useNotifications();
const dir = fileURLToPath(new URL('.', import.meta.url));

function sources(path = dir, found: string[] = []): string[] {
  for (const name of readdirSync(path)) {
    if (['node_modules', 'dist', 'migrations'].includes(name)) continue;
    const full = join(path, name);
    if (statSync(full).isDirectory()) sources(full, found);
    else if (/\.ts$/.test(name)) found.push(full);
  }
  return found;
}

describe('the manifest', () => {
  it('has the id, the table prefix and the one permission of sprint 1', () => {
    expect(manifest.id).toBe('core.notifications');
    expect(manifest.tablePrefix).toBe('notify_');
    expect(Object.keys(manifest.permissions ?? {})).toEqual(['core.notifications.status.read']);
  });

  it('declares the delivery job with a sweep every minute', () => {
    expect(manifest.jobs?.map((job) => [job.name, job.schedule])).toEqual([
      ['core.notifications.deliver', '* * * * *'],
    ]);
  });

  it('emits no events yet, and listens to the two settings events and system.ready', () => {
    expect(Object.keys(manifest.events?.emits ?? {})).toEqual([]);
    expect(Object.keys(manifest.events?.on ?? {}).sort()).toEqual([
      'settings.changed@1',
      'settings.secret.changed@1',
      'system.ready',
    ]);
  });

  it('creates only tables with the prefix notify_, with no foreign key', () => {
    const migrations = join(dir, 'migrations');
    const sql = readdirSync(migrations)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => readFileSync(join(migrations, file), 'utf8'))
      .join('\n');
    expect([...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1])).toEqual([
      'notify_delivery',
    ]);
    expect(sql).not.toMatch(/REFERENCES/i);
  });

  it('is user-agnostic: it depends on authz and settings only and imports nothing from identity', () => {
    const dependencies = Object.keys(packageJson.dependencies).filter((name) =>
      name.startsWith('@scorpion/'),
    );
    expect(dependencies.sort()).toEqual([
      '@scorpion/contracts',
      '@scorpion/core-authz',
      '@scorpion/core-settings',
      '@scorpion/kernel',
    ]);
    for (const file of sources().filter((path) => !/\.test\.ts$/.test(path))) {
      expect(readFileSync(file, 'utf8'), relative(dir, file)).not.toMatch(
        /from\s+'[^']*core-identity/,
      );
    }
  });

  it('does not read SMTP_URL (M4 decision 7)', () => {
    for (const file of sources().filter((path) => !/\.test\.ts$/.test(path))) {
      expect(readFileSync(file, 'utf8'), relative(dir, file)).not.toContain('SMTP_URL');
    }
  });

  it('adds no runtime dependency beyond what the repository already uses', () => {
    expect(
      Object.keys(packageJson.dependencies)
        .filter((name) => !name.startsWith('@scorpion/'))
        .sort(),
    ).toEqual(['drizzle-orm', 'nodemailer', 'pg', 'zod']);
  });
});

describe('in a kernel', () => {
  it('registers the transports smtp, webhook and none', async () => {
    const t = await harness.start();
    const entries = t.kernel.composition.registries.get('notify.transport')!.entries;
    expect(entries.map((entry) => (entry.value as { id: string }).id).sort()).toEqual([
      'none',
      'smtp',
      'webhook',
    ]);
  });

  it('is a different manifest per createNotificationsModule() call, so tests can tune it', () => {
    expect(createNotificationsModule()).not.toBe(createNotificationsModule());
  });
});
