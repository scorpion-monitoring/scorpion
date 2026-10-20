// Defect 6 of FEATURES §5, the public API part (M10 sprint 2): in the old application `GET /api/v1/measurements` answered under `data`
// instead of `result` and ordered only within a page (a series longer than a page came back in no stable order, so a client that
// walked the pages saw rows twice and missed others), and `POST /api/v1/measurements` had no permission check: anyone with a key
// could write to any service. Here, through the whole pipeline over real Postgres: the pages walked in turn are the one-page list in
// the order of month, indicator name and id; the list is under `result`; a token of a person who is not a member of the service's
// provider is refused on the write (403) and a member's token is not. Never weaken or delete it.
import {
  makeIndicator,
  makeKpiSet,
  makeMeasurement,
  makeMembership,
  makeOrganisation,
  makeService,
  makeServiceKpis,
} from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();
const NOW = new Date('2026-06-15T12:00:00Z');
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
type Started = Awaited<ReturnType<ReturnType<typeof useIdentityApp>['start']>>;

async function tokenFor(s: Started, who: { cookie: string; csrf: string }, scopes: string[]) {
  const reply = await s.post('/tokens', {
    cookie: who.cookie,
    csrf: who.csrf,
    body: { name: `t-${Math.random().toString(36).slice(2, 10)}`, scopes },
  });
  expect(reply.status).toBe(201);
  return (reply.body as { token: string }).token;
}

async function world() {
  const s = await app.start({ publicApi: true, kpi: true, ingestion: { clock: () => NOW } });
  const pool = s.kernel.pool;
  const mine = await makeOrganisation(pool, { type: 'provider' });
  const theirs = await makeOrganisation(pool, { type: 'provider' });
  const member = await s.signedIn('member-d6');
  const other = await s.signedIn('other-d6');
  await makeMembership(pool, { organisationId: mine.id, userId: member.user.id, role: 'member' });
  await makeMembership(pool, { organisationId: theirs.id, userId: other.user.id, role: 'member' });
  // Names that a case-sensitive order and a case-insensitive one sort differently.
  const indicators = await Promise.all(
    ['Zeta users', 'alpha users', 'Mid users'].map((name) =>
      makeIndicator(pool, { name: `${name} ${Math.random().toString(36).slice(2, 6)}` }),
    ),
  );
  const set = await makeKpiSet(pool, {
    indicators: indicators.map((indicator) => ({
      indicatorId: indicator.id,
      necessity: 'optional',
    })),
  });
  const service = await makeService(pool, { provider: mine.id });
  await makeServiceKpis(pool, { serviceId: service.id, setId: set.id });
  return { s, pool, member, other, indicators, service };
}

describe('defect 6: GET /api/v1/measurements', () => {
  it('keeps the order across pages: a series longer than a page, walked page by page, equals the one-page read', async () => {
    const { s, pool, member, indicators, service } = await world();
    // 3 indicators x 30 months: 90 values, more than a page at the sizes below
    for (let m = 0; m < 30; m++) {
      const year = 2023 + Math.floor((m + 0) / 12);
      const month = (m % 12) + 1;
      const period = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
      for (const [n, indicator] of indicators.entries())
        await makeMeasurement(pool, {
          serviceId: service.id,
          indicatorId: indicator.id,
          period,
          valueNumeric: m * 10 + n,
        });
    }
    const token = await tokenFor(s, member, ['kpi.ingestion.v1.read']);
    const page = async (pageSize: number, index: number) => {
      const reply = await s.getV1(
        `/measurements?service=${service.id}&pageSize=${pageSize}&page=${index}`,
        { headers: bearer(token) },
      );
      expect(reply.status).toBe(200);
      return reply.body as {
        metadata: { totalCount: number; totalPages: number };
        result: { id: string; period: string; kpi: string }[];
      };
    };
    const whole = await page(100, 0);
    expect(whole.metadata.totalCount).toBe(90);
    const order = whole.result.map((row) => `${row.period}|${row.kpi.toLowerCase()}`);
    expect(order).toEqual([...order].sort());
    // alpha, Mid, Zeta inside every month: the order of the names without case
    expect(whole.result.slice(0, 3).map((row) => row.kpi.split(' ')[0])).toEqual([
      'alpha',
      'Mid',
      'Zeta',
    ]);
    for (const pageSize of [7, 10, 33]) {
      const walked: string[] = [];
      const first = await page(pageSize, 0);
      for (let index = 0; index < first.metadata.totalPages; index++)
        walked.push(...(await page(pageSize, index)).result.map((row) => row.id));
      // no row twice, none missing, the same order as the one-page read
      expect(new Set(walked).size, `pageSize ${pageSize}`).toBe(90);
      expect(walked, `pageSize ${pageSize}`).toEqual(whole.result.map((row) => row.id));
    }
  });

  it('answers under `result`, with the metadata, and never under the legacy `data`', async () => {
    const { s, member, service } = await world();
    const token = await tokenFor(s, member, ['kpi.ingestion.v1.read']);
    const reply = await s.getV1(`/measurements?service=${service.id}`, { headers: bearer(token) });
    expect(reply.status).toBe(200);
    const body = reply.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['metadata', 'result']);
    expect(body).not.toHaveProperty('data');
    expect(body.metadata).toEqual({ currentPage: 0, pageSize: 100, totalCount: 0, totalPages: 0 });
  });
});

describe('defect 6: POST /api/v1/measurements needs the right to submit for the service', () => {
  it('is 403 for the token of a member of another provider and 200 for the token of a member of the service’s provider [ASVS-8.2.1] [ASVS-8.3.1]', async () => {
    const { s, pool, member, other, indicators, service } = await world();
    const scopes = ['kpi.ingestion.v1.write', 'kpi.ingestion.measurement.submit'];
    const memberToken = await tokenFor(s, member, scopes);
    const otherToken = await tokenFor(s, other, scopes);
    const body = [{ kpi: indicators[0]!.name, value: 12, date: '2026-03' }];
    const write = (token: string) =>
      s.call('POST', `/measurements?service=${service.id}`, {
        v1: true,
        headers: bearer(token),
        body,
      });
    const refused = await write(otherToken);
    expect(refused.status).toBe(403);
    expect((await pool.query('select 1 from kpii_measurement')).rows).toEqual([]);
    const accepted = await write(memberToken);
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ inserted: 1, updated: 0, unchanged: 0 });
    // the member's value is the only row, and the other person's token wrote nothing even on a second try
    expect((await write(otherToken)).status).toBe(403);
    const rows = (
      await pool.query<{ value_numeric: string; created_by: string }>(
        'select value_numeric::text, created_by from kpii_measurement',
      )
    ).rows;
    expect(rows).toEqual([{ value_numeric: '12', created_by: member.user.id }]);
  });

  it('is 403 for a token of a person who is no member of any provider, and for the owner’s own session without the CSRF header it is 401 [ASVS-8.2.1] [ASVS-7.2.1]', async () => {
    const { s, pool, member, indicators, service } = await world();
    const stranger = await s.signedIn('stranger-d6');
    const token = await tokenFor(s, stranger, [
      'kpi.ingestion.v1.write',
      'kpi.ingestion.measurement.submit',
    ]);
    const body = [{ kpi: indicators[0]!.name, value: 1, date: '2026-03' }];
    expect(
      (
        await s.call('POST', `/measurements?service=${service.id}`, {
          v1: true,
          headers: bearer(token),
          body,
        })
      ).status,
    ).toBe(403);
    // a member's cookie without the CSRF token is refused before the service is asked
    expect(
      (
        await s.call('POST', `/measurements?service=${service.id}`, {
          v1: true,
          cookie: member.cookie,
          body,
        })
      ).status,
    ).toBe(401);
    expect((await pool.query('select 1 from kpii_measurement')).rows).toEqual([]);
  });
});
