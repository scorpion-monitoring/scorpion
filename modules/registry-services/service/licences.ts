// The cache port of the SPDX adapter over `svc_license_cache` (one row, id `spdx`): the list survives a
// restart and is shared by the processes of one deployment, and the adapter fetches at most once a day.
import type { SpdxCache, SpdxList } from '@scorpion/integrations';
import { eq } from 'drizzle-orm';
import type { Db } from '@scorpion/kernel';
import { licenseCache } from '../db/schema.ts';

export const SPDX_CACHE_ID = 'spdx';

export function createLicenseCache(db: Db): SpdxCache {
  return {
    async read() {
      const [row] = await db.select().from(licenseCache).where(eq(licenseCache.id, SPDX_CACHE_ID));
      if (!row) return undefined;
      const list = row.licenses as SpdxList['licenses'];
      if (!Array.isArray(list)) return undefined;
      return {
        version: row.releaseVersion ?? '0',
        fetchedAt: row.fetchedAt.getTime(),
        licenses: list,
      };
    },
    async write(list) {
      const values = {
        licenses: list.licenses,
        releaseVersion: list.version,
        fetchedAt: new Date(list.fetchedAt),
      };
      await db
        .insert(licenseCache)
        .values({ id: SPDX_CACHE_ID, ...values })
        .onConflictDoUpdate({ target: licenseCache.id, set: values });
    },
  };
}
