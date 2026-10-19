// Defect 15 (FEATURES §5), the KPI part (M9 sprint 3): the legacy `GET /api/v1/indicators` returned a `totalCount` that
// ignored its filters, so a client that paged by it walked past the last row or stopped early. Through the whole
// pipeline with a real token on real Postgres: `totalCount` is the size of the filtered set, the pages of a filtered list
// add up to exactly that many rows, and `totalPages` follows it. Never weaken or delete it.
import {
  makeIndicator,
  makeKpiSet,
  makeOrganisation,
  makeService,
  makeServiceKpis,
} from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();

describe('defect 15: the totalCount of the v1 indicators follows the filters', () => {
  it('counts the filtered set, and the pages of it add up to that count [ASVS-8.2.3]', async () => {
    const s = await app.start({ publicApi: true, kpi: true });
    const who = await s.signedIn('defect15-kpi');
    const reply = await s.post('/tokens', {
      ...who,
      body: { name: 'kpi-count', scopes: ['kpi.framework.v1.read'] },
    });
    const headers = { authorization: `Bearer ${(reply.body as { token: string }).token}` };
    const pool = s.kernel.pool;
    const indicators = await Promise.all(
      Array.from({ length: 9 }, (_, i) => makeIndicator(pool, { name: `D15 indicator ${i}` })),
    );
    const small = await makeKpiSet(pool, {
      name: 'D15 small',
      indicators: indicators
        .slice(0, 2)
        .map((i) => ({ indicatorId: i.id, necessity: 'mandatory' })),
    });
    await makeKpiSet(pool, {
      name: 'D15 large',
      indicators: indicators.slice(0, 7).map((i) => ({ indicatorId: i.id, necessity: 'optional' })),
    });
    const provider = await makeOrganisation(pool, {});
    const service = await makeService(pool, { provider: provider.id, slug: 'd15-kpi-svc' });
    await makeServiceKpis(pool, { serviceId: service.id, setId: small.id });
    const page = async (query: string) =>
      (await s.getV1(`/indicators?${query}`, { headers })).body as {
        metadata: { totalCount: number; totalPages: number; currentPage: number };
        result: { id: string }[];
      };

    const unfiltered = (await page('pageSize=100')).metadata.totalCount;
    expect(unfiltered).toBeGreaterThanOrEqual(9);
    for (const [name, expected] of [
      ['D15 small', 2],
      ['D15 large', 7],
    ] as const) {
      const first = await page(`category=${encodeURIComponent(name)}&pageSize=3`);
      expect(first.metadata.totalCount, name).toBe(expected);
      expect(first.metadata.totalCount).toBeLessThan(unfiltered);
      expect(first.metadata.totalPages).toBe(Math.ceil(expected / 3));
      const ids: string[] = [];
      for (let p = 0; p < first.metadata.totalPages; p++)
        ids.push(
          ...(await page(`category=${encodeURIComponent(name)}&pageSize=3&page=${p}`)).result.map(
            (r) => r.id,
          ),
        );
      expect(ids).toHaveLength(expected);
      expect(new Set(ids).size).toBe(expected);
    }
    // `service` marks and does not filter, so it does not change the count.
    expect((await page('service=d15-kpi-svc&pageSize=100')).metadata.totalCount).toBe(unfiltered);
  });
});
