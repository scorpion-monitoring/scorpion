// The module as the kernel sees it: permissions, jobs, subscriptions, tables, its place in the module
// graph, and the profile that has no audit at all.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from './module.ts';
import packageJson from './package.json' with { type: 'json' };
import { useAudit } from './test/harness.ts';

const audit = useAudit();
const dir = fileURLToPath(new URL('.', import.meta.url));

describe('the manifest', () => {
  it('has the id, the table prefix and the four permissions', () => {
    expect(manifest.id).toBe('core.audit');
    expect(manifest.tablePrefix).toBe('audit_');
    expect(Object.keys(manifest.permissions ?? {}).sort()).toEqual([
      'core.audit.export',
      'core.audit.read',
      'core.audit.system.manage',
      'core.audit.system.read',
    ]);
  });

  it('declares its own retention job and the two kernel maintenance jobs, all with the module id in front', () => {
    expect(manifest.jobs?.map((job) => [job.name, job.schedule])).toEqual([
      ['core.audit.retention', '37 3 * * *'],
      ['core.audit.system.outbox-retention', '47 3 * * *'],
      ['core.audit.system.job-run-retention', '57 3 * * *'],
    ]);
  });

  it('emits nothing and contributes the audit sink', () => {
    expect(manifest.events?.emits).toBeUndefined();
    expect(manifest.contributes?.['kernel.auditSink']).toHaveLength(1);
  });

  it('creates one table with the prefix audit_ and no foreign key', () => {
    const migrations = join(dir, 'migrations');
    const sql = readdirSync(migrations)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => readFileSync(join(migrations, file), 'utf8'))
      .join('\n');
    expect([...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1])).toEqual([
      'audit_event',
    ]);
    expect(sql).not.toMatch(/REFERENCES/i);
  });

  it('depends on authz, settings and identity, with notifications and the shell as optional peers', () => {
    const own = (names: string[]) =>
      names.filter((n) => n.startsWith('@scorpion/') && n.includes('core-'));
    expect(own(Object.keys(packageJson.dependencies)).sort()).toEqual([
      '@scorpion/core-authz',
      '@scorpion/core-identity',
      '@scorpion/core-settings',
    ]);
    expect(Object.keys(packageJson.peerDependencies).sort()).toEqual([
      '@scorpion/core-notifications',
      '@scorpion/core-ui-shell',
    ]);
    for (const peer of ['@scorpion/core-notifications', '@scorpion/core-ui-shell'] as const) {
      expect(packageJson.peerDependenciesMeta[peer]).toEqual({ optional: true });
    }
  });
});

describe('in a profile', () => {
  it('loads after notifications and identity, and hands the sink to the kernel', async () => {
    const s = await audit.start();
    expect(s.kernel.profile.modules.map((m) => m.id)).toEqual([
      'core.authz',
      'core.settings',
      'core.blob',
      'core.notifications',
      'core.identity',
      'core.audit',
    ]);
    await s.kernel.audit({ action: 'thing.done', outcome: 'ok', actor: { kind: 'system' } });
    expect(await s.rows("action = 'thing.done'")).toHaveLength(1);
  });

  it('starts without core.audit: the sink does nothing and ctx.audit succeeds', async () => {
    const s = await audit.start({ withoutAudit: true });
    expect(s.kernel.profile.modules.map((m) => m.id)).not.toContain('core.audit');
    await expect(
      s.kernel.audit({ action: 'thing.done', outcome: 'ok', actor: { kind: 'system' } }),
    ).resolves.toBeUndefined();
    expect(s.kernel.routes.map((r) => r.route.path)).not.toContain('/audit');
    const { rows } = await s.pool.query<{ t: string | null }>(
      "select to_regclass('audit_event') as t",
    );
    expect(rows[0]!.t).toBeNull();
  });
});
