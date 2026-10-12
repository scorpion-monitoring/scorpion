// The cache port of the SPDX adapter over svc_license_cache, with the real adapter and a counted fetch.
import { createSpdx } from '@scorpion/integrations';
import { describe, expect, it } from 'vitest';
import { useServices } from '../test/harness.ts';
import { createLicenseCache, SPDX_CACHE_ID } from './licences.ts';

const h = useServices();

const answer = (version: string) =>
  new Response(
    JSON.stringify({
      licenseListVersion: version,
      licenses: [
        {
          licenseId: 'Only-Live-1.0',
          name: 'Only live',
          isOsiApproved: true,
          isDeprecatedLicenseId: false,
        },
        { licenseId: 'Old-1.0', name: 'Old', isOsiApproved: false, isDeprecatedLicenseId: true },
      ],
    }),
    { status: 200 },
  );

describe('the licence cache port', () => {
  it('keeps the fetched list in one row, and a second process reads it without a fetch', async () => {
    const s = await h.start();
    const cache = createLicenseCache(s.kernel.db);
    let fetches = 0;
    const first = createSpdx({
      cache,
      fetch: () => {
        fetches++;
        return Promise.resolve(answer('9.1.0'));
      },
    });
    expect(await first.has('only-live-1.0')).toBe(true);
    expect(fetches).toBe(1);
    const rows = (await s.pool.query('select id, release_version from svc_license_cache')).rows;
    expect(rows).toEqual([{ id: SPDX_CACHE_ID, release_version: '9.1.0' }]);

    const second = createSpdx({
      cache,
      fetch: () => {
        fetches++;
        return Promise.reject(new Error('no network in this process'));
      },
    });
    expect((await second.find('Old-1.0'))?.deprecated).toBe(true);
    expect(fetches).toBe(1);
  });

  it('replaces the row on the next fetch, never adds a second one', async () => {
    const s = await h.start();
    const cache = createLicenseCache(s.kernel.db);
    const now = 1_700_000_000_000;
    await cache.write({ version: '1.0.0', fetchedAt: now, licenses: [] });
    await cache.write({
      version: '2.0.0',
      fetchedAt: now + 1,
      licenses: [{ id: 'X-1.0', name: 'X', osiApproved: false, deprecated: false }],
    });
    expect((await s.pool.query('select count(*)::int as n from svc_license_cache')).rows[0].n).toBe(
      1,
    );
    expect(await cache.read()).toEqual({
      version: '2.0.0',
      fetchedAt: now + 1,
      licenses: [{ id: 'X-1.0', name: 'X', osiApproved: false, deprecated: false }],
    });
  });

  it('answers nothing when no row exists or the stored list is not a list', async () => {
    const s = await h.start();
    const cache = createLicenseCache(s.kernel.db);
    expect(await cache.read()).toBeUndefined();
    await s.pool.query(
      `insert into svc_license_cache (id, licenses, fetched_at) values ('spdx', '{"a":1}'::jsonb, now())`,
    );
    expect(await cache.read()).toBeUndefined();
  });
});
