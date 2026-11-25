// bibliometrics as the kernel sees it: the manifest, the dependencies, the settings and the write policy.
import { describe, expect, it, vi } from 'vitest';
import manifest from './module.ts';
import packageJson from './package.json' with { type: 'json' };
import { PERMISSION_READ, PERMISSION_WRITE } from './service/permissions.ts';
import { writePolicy } from './service/policy.ts';
import { settingsSchema } from './settings-schema.ts';

describe('the manifest', () => {
  it('has the id, the table prefix, the two permissions and the settings', () => {
    expect(manifest.id).toBe('bibliometrics');
    expect(manifest.tablePrefix).toBe('biblio_');
    const permissions = manifest.permissions ?? {};
    expect(Object.keys(permissions)).toEqual([PERMISSION_READ, PERMISSION_WRITE]);
    expect(permissions[PERMISSION_READ]?.scope).toBeUndefined();
    expect(permissions[PERMISSION_WRITE]?.scope).toBe('service');
    expect(manifest.settings).toBe(settingsSchema);
    expect(manifest.contributes?.['authz.defaultRole']).toEqual([
      { role: 'user', permissions: [PERMISSION_READ] },
    ]);
  });

  it('emits no event, has no job and listens to nothing in sprint 1', () => {
    expect(manifest.events?.emits).toEqual({});
    expect(manifest.events?.on).toBeUndefined();
    expect(manifest.jobs).toBeUndefined();
  });

  it('depends on core.authz, registry.services and the integrations only', () => {
    expect(
      Object.keys(packageJson.dependencies).filter((name) => name.startsWith('@scorpion/')),
    ).toEqual([
      '@scorpion/contracts',
      '@scorpion/core-authz',
      '@scorpion/integrations',
      '@scorpion/kernel',
      '@scorpion/registry-services',
    ]);
  });
});

describe('settingsSchema', () => {
  it('looks up by default and writes no KPI', () => {
    expect(settingsSchema.parse({})).toEqual({ enabled: true, openalex: {}, kpi: {} });
  });

  it.each([
    [{ openalex: { mailto: 'not an address' } }],
    [{ kpi: { indicatorId: 'citations' } }],
    [{ unknown: true }],
  ])('refuses %j', (value) => {
    expect(settingsSchema.safeParse(value).success).toBe(false);
  });
});

describe('the write policy', () => {
  const serviceId = '0193b6a0-0000-7000-8000-000000000001';
  const request = (permission: string, id: string | null = serviceId) => ({
    actor: { userId: 'u1' },
    permission,
    resource: { type: 'service', id: id ?? undefined },
  });

  it('asks registry.services for the write only, and only with a service id', async () => {
    const isMember = vi.fn(() => Promise.resolve(true));
    const policy = writePolicy({ isProviderMember: () => isMember });
    expect(await policy.allows(request(PERMISSION_WRITE))).toBe(true);
    expect(isMember).toHaveBeenCalledWith('u1', serviceId);
    expect(await policy.allows(request(PERMISSION_READ))).toBe(false);
    expect(await policy.allows(request(PERMISSION_WRITE, null))).toBe(false);
    expect(await policy.allows(request(PERMISSION_WRITE, 'not-a-uuid'))).toBe(false);
    expect(isMember).toHaveBeenCalledTimes(1);
  });
});
