// bibliometrics as the kernel sees it: the manifest, the dependencies, the settings and the write policy.
import { describe, expect, it, vi } from 'vitest';
import manifest from './module.ts';
import packageJson from './package.json' with { type: 'json' };
import { CITATIONS_UPDATED_EVENT, REFRESH_JOB } from './service/citations.ts';
import { citationsUpdatedSchema } from './service/events.ts';
import { PERMISSION_READ, PERMISSION_WRITE } from './service/permissions.ts';
import { writePolicy } from './service/policy.ts';
import {
  CITATION_SOURCE_REGISTRY,
  citationSourceEntrySchema,
  indexSources,
} from './service/sources.ts';
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

  it('emits the citation event, listens to nothing, and has the weekly refresh job', () => {
    expect(Object.keys(manifest.events?.emits ?? {})).toEqual([CITATIONS_UPDATED_EVENT]);
    expect(manifest.events?.emits?.[CITATIONS_UPDATED_EVENT]).toBe(citationsUpdatedSchema);
    expect(manifest.events?.on).toBeUndefined();
    expect(manifest.jobs?.map((job) => job.name)).toEqual([REFRESH_JOB]);
    const job = manifest.jobs![0]!;
    // Monday 04:00 UTC.
    expect(job.schedule).toBe('0 4 * * 1');
    expect(job.retry.limit).toBeGreaterThan(0);
    expect(job.timeoutSeconds).toBeGreaterThan(0);
  });

  it('declares the registry biblio.citationSource and contributes OpenAlex as its one built-in entry', () => {
    expect(Object.keys(manifest.registries ?? {})).toEqual([CITATION_SOURCE_REGISTRY]);
    const entries = manifest.contributes?.[CITATION_SOURCE_REGISTRY] as { id: string }[];
    expect(entries.map((entry) => entry.id)).toEqual(['openalex']);
    expect(citationSourceEntrySchema.safeParse(entries[0]).success).toBe(true);
  });

  it('refuses a citation source entry with a bad id or no fetchCounts, and two entries with one id', () => {
    const entry = {
      id: 'x',
      label: 'X',
      enabled: () => true,
      fetchCounts: () => Promise.resolve(),
    };
    expect(citationSourceEntrySchema.safeParse(entry).success).toBe(true);
    expect(citationSourceEntrySchema.safeParse({ ...entry, id: 'Open Alex' }).success).toBe(false);
    expect(citationSourceEntrySchema.safeParse({ ...entry, fetchCounts: 1 }).success).toBe(false);
    expect(() => indexSources([entry, entry] as never)).toThrow(/id "x"/);
  });

  it('depends on core.authz, core.settings, registry.services, kpi.framework, kpi.ingestion and the integrations only', () => {
    expect(
      Object.keys(packageJson.dependencies).filter((name) => name.startsWith('@scorpion/')),
    ).toEqual([
      '@scorpion/contracts',
      '@scorpion/core-authz',
      '@scorpion/core-settings',
      '@scorpion/integrations',
      '@scorpion/kernel',
      '@scorpion/kpi-framework',
      '@scorpion/kpi-ingestion',
      '@scorpion/registry-services',
    ]);
  });

  it('has core.ui-shell as an optional peer only (its ui entry runs in the shell; a profile without the shell still starts)', () => {
    expect(packageJson.peerDependencies).toEqual({ '@scorpion/core-ui-shell': 'workspace:*' });
    expect(packageJson.peerDependenciesMeta).toEqual({
      '@scorpion/core-ui-shell': { optional: true },
    });
  });
});

describe('settingsSchema', () => {
  it('looks up by default and writes no KPI', () => {
    expect(settingsSchema.parse({})).toEqual({ enabled: true, kpi: {} });
  });

  it.each([
    // `openalex.mailto` is gone (OpenAlex ignores it); a stored one is refused, not silently kept.
    [{ openalex: { mailto: 'ops@example.org' } }],
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
