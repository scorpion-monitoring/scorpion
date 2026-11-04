// The manifest of kpi.impact: no table yet, the one plain permission and who holds it, and the module in the profiles it belongs to.
import { describe, expect, it } from 'vitest';
import manifest from './module.ts';
import { useImpact } from './test/harness.ts';

const h = useImpact();

describe('the manifest', () => {
  it('has no table, no table prefix and no demo seed before the read model of sprint 3', async () => {
    expect(manifest.id).toBe('kpi.impact');
    expect(manifest.tablePrefix).toBeUndefined();
    expect(manifest.schema).toBeUndefined();
    expect(manifest.migrations).toBeUndefined();
    expect(manifest.demoSeed).toBeUndefined();
    const s = await h.start();
    const { rows } = await s.pool.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name like 'kpi\\_impact%'",
    );
    expect(rows).toEqual([]);
  });

  it('declares the plain permission kpi.impact.read and no other, with a description [ASVS-8.2.1]', () => {
    expect(Object.keys(manifest.permissions ?? {})).toEqual(['kpi.impact.read']);
    expect(manifest.permissions?.['kpi.impact.read']?.description.length).toBeGreaterThan(20);
  });

  it('gives kpi.impact.read to the role reviewer and Admin and not to the role user [ASVS-8.2.1]', async () => {
    const s = await h.start();
    const { rows } = await s.pool.query<{ role: string }>(
      "select r.key as role from authz_role_permission p join authz_role r on r.id = p.role_id where p.permission = 'kpi.impact.read' order by 1",
    );
    expect(rows.map((row) => row.role)).toEqual(['reviewer']);
    const authz = s.kernel.services.get('core.authz') as {
      can(actor: unknown, permission: string): Promise<boolean>;
    };
    expect(await authz.can(await s.actor('admin'), 'kpi.impact.read')).toBe(true);
    expect(await authz.can(await s.actor('reviewer'), 'kpi.impact.read')).toBe(true);
    expect(await authz.can(await s.actor('user'), 'kpi.impact.read')).toBe(false);
  });
});
