// `GET /kpi/analytics/export` through the whole pipeline (M11 sprint 5): who may call it, a 422 per bad parameter, the headers, the byte order mark,
// the file name, a body that parses back to the numbers of the series, the XLSX read back, a name that starts like a formula, and the audit entry.
import { parseCsv } from '@scorpion/kpi-ingestion/public';
import {
  makeIndicator,
  makeKpiSet,
  makeMeasurement,
  makeOrganisation,
  makeService,
  makeServiceKpis,
} from '@scorpion/testing';
import { readSheet } from 'read-excel-file/node';
import { beforeAll, describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const NOW = new Date('2026-06-15T12:00:00Z');
const ABSENT = '018f3b7e-0000-7000-8000-000000000000';
const app = useIdentityApp({ shared: true });
let started: Awaited<ReturnType<typeof app.start>>;
let alice: Awaited<ReturnType<typeof started.signedIn>>;
let service: { id: string; slug: string };
let bare: { id: string };

const as = (who: { cookie: string; csrf: string }) => ({ cookie: who.cookie, csrf: who.csrf });
const problemPaths = (body: unknown) =>
  ((body as { errors?: { in: string; path: string }[] }).errors ?? []).map(
    (e) => `${e.in}:${e.path}`,
  );
type Series = {
  result: {
    name: string;
    unit: string | null;
    points: { period: string; value: number | null; text: string | null }[];
  }[];
};

beforeAll(async () => {
  started = await app.start({
    kpi: true,
    ingestion: { clock: () => NOW },
    analytics: { clock: () => NOW },
  });
  const pool = started.kernel.pool;
  alice = await started.signedIn('alice-export');
  const provider = await makeOrganisation(pool, { type: 'provider' });
  service = await makeService(pool, { provider: provider.id });
  bare = await makeService(pool, { provider: provider.id });
  // Names an administrator typed: umlauts, a quote, a comma, and one that starts like a formula.
  const names = [
    ['Größe der Nutzer:innen, "gesamt"', 'integer', 'Usage'],
    ['=HYPERLINK("http://x.invalid")', 'integer', 'Usage'],
    ['-Negative start', 'percentage', 'Satisfaction'],
    ['Export note', 'text', 'Usage'],
    ['Export never reported', 'integer', 'Technical'],
  ] as const;
  const indicators = await Promise.all(
    names.map(([name, valueType, thematic]) =>
      makeIndicator(pool, { name, valueType, thematic, qualitative: valueType === 'text' }),
    ),
  );
  const set = await makeKpiSet(pool, {
    indicators: indicators.map((indicator) => ({
      indicatorId: indicator.id,
      necessity: 'mandatory',
    })),
  });
  await makeServiceKpis(pool, { serviceId: service.id, setId: set.id });
  // Different months for each KPI: the legacy export put values under the first KPI's dates.
  const put = (i: number, period: string, value: number | string) =>
    makeMeasurement(pool, {
      serviceId: service.id,
      indicatorId: indicators[i]!.id,
      period,
      ...(typeof value === 'string' ? { valueText: value } : { valueNumeric: value }),
    });
  await put(0, '2026-01-31', 1000);
  await put(0, '2026-02-28', 1250.5);
  await put(1, '2026-03-31', 7);
  await put(1, '2026-05-31', 0);
  await put(2, '2026-04-30', 82.5);
  await put(3, '2026-02-28', 'all well');
}, 120_000);

const exportUrl = (extra = '', id = () => service.id) =>
  `/kpi/analytics/export?service=${id()}${extra}`;
const decode = (bytes: Buffer) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

describe('GET /kpi/analytics/export', () => {
  it('is 401 without a session and 403 for a user without the permission [ASVS-8.2.1] [ASVS-8.3.1]', async () => {
    const nobody = await started.signedIn('nobody-export', { roles: [] });
    for (const format of ['csv', 'xlsx']) {
      const url = exportUrl(`&format=${format}`);
      const anonymous = await started.get(url);
      expect(anonymous.status, format).toBe(401);
      expect(anonymous.res.headers.get('content-type')).toContain('application/problem+json');
      const denied = await started.get(url, as(nobody));
      expect(denied.status, format).toBe(403);
      expect(denied.res.headers.get('content-type')).toContain('application/problem+json');
      // no file, no bytes of one
      expect(denied.res.headers.get('content-disposition')).toBeNull();
    }
    // the permission to read the series is not the permission to export: both are named in the manifest, the role user holds both
    const readOnly = await started.signedIn('reader-only-export', { roles: [] });
    expect((await started.get(exportUrl('&format=csv'), as(readOnly))).status).toBe(403);
  });

  it('is 422 naming the parameter for a bad service, range, category or format, and an unknown one, never 500', async () => {
    const bad: [string, string][] = [
      ['/kpi/analytics/export', 'query:service'],
      ['/kpi/analytics/export?format=csv', 'query:service'],
      [`/kpi/analytics/export?service=${service.id}`, 'query:format'],
      ['/kpi/analytics/export?service=not-an-id&format=csv', 'query:service'],
      [`/kpi/analytics/export?service=${ABSENT}&format=csv`, 'query:service'],
      [exportUrl('&format=pdf'), 'query:format'],
      [exportUrl('&format='), 'query:format'],
      [exportUrl('&format=CSV'), 'query:format'],
      [exportUrl(`&format=${'x'.repeat(33)}`), 'query:format'],
      [exportUrl('&format=csv&range=5y'), 'query:range'],
      [exportUrl('&format=csv&range='), 'query:range'],
      [exportUrl('&format=csv&category=Nonsense'), 'query:category'],
      [exportUrl('&format=csv&extra=1'), 'query:'],
      // a page is not a parameter: the export is the whole window
      [exportUrl('&format=csv&page=0'), 'query:'],
    ];
    for (const [url, path] of bad) {
      const reply = await started.get(url, as(alice));
      expect(reply.status, url).toBe(422);
      expect(reply.res.headers.get('content-type'), url).toContain('application/problem+json');
      expect(problemPaths(reply.body), url).toContain(path);
    }
  });

  it('answers a CSV with a byte order mark, the headers of an attachment and a name from the service abbreviation', async () => {
    const reply = await started.get(exportUrl('&format=csv&range=6m'), as(alice));
    expect(reply.status).toBe(200);
    const headers = reply.res.headers;
    expect(headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(headers.get('content-disposition')).toBe(
      `attachment; filename="${service.slug}-kpis-6m.csv"`,
    );
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('cache-control')).toBe('no-store');
    expect([...reply.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('parses back to the numbers the series gives, month by month, whatever months each KPI has', async () => {
    const range = '6m';
    const series = (
      await started.get(
        `/kpi/analytics/series?service=${service.id}&range=${range}&pageSize=200`,
        as(alice),
      )
    ).body as Series;
    const file = await started.get(exportUrl(`&format=csv&range=${range}`), as(alice));
    const parsed = parseCsv(decode(file.bytes), { delimiter: ',' });
    expect(parsed.problems).toEqual([]);
    const [header, ...rows] = parsed.rows;
    expect(header).toEqual([
      'KPI',
      'Unit',
      ...series.result[0]!.points.map((p) => p.period.slice(0, 7)),
    ]);
    expect(rows).toHaveLength(series.result.length);
    for (const [index, row] of rows.entries()) {
      const kpi = series.result[index]!;
      // the name is the series' name, escaped only where it starts like a formula
      expect(row[0]!.replace(/^'(?=[=+\-@\t\r])/, ''), kpi.name).toBe(kpi.name);
      kpi.points.forEach((point, column) => {
        const cell = row[column + 2];
        if (point.value !== null)
          expect(Number(cell), `${kpi.name} ${point.period}`).toBe(point.value);
        else expect(cell, `${kpi.name} ${point.period}`).toBe(point.text ?? '');
      });
    }
    // the values the factory stored are there, each under its own month
    const byName = new Map(rows.map((row) => [row[0], row]));
    const months = header!.slice(2);
    const cell = (name: string, month: string) => byName.get(name)![2 + months.indexOf(month)];
    expect(cell('\'=HYPERLINK("http://x.invalid")', '2026-03')).toBe('7');
    expect(cell('\'=HYPERLINK("http://x.invalid")', '2026-05')).toBe('0');
    expect(cell("'-Negative start", '2026-04')).toBe('82.5');
    expect(cell('Export note', '2026-02')).toBe('all well');
    expect(cell('Export never reported', '2026-04')).toBe('');
  });

  it('neutralises a name that starts like a formula in both formats, so a spreadsheet never evaluates it', async () => {
    const csv = decode((await started.get(exportUrl('&format=csv'), as(alice))).bytes);
    expect(csv).toContain(`"'=HYPERLINK(""http://x.invalid"")"`);
    expect(csv).toContain("'-Negative start");
    expect(csv).not.toMatch(/(^|\r\n)[=+@-]/);
    const xlsx = await started.get(exportUrl('&format=xlsx'), as(alice));
    const rows = await readSheet(Buffer.from(xlsx.bytes));
    const names = rows.slice(1).map((row) => row[0]);
    expect(names).toContain('\'=HYPERLINK("http://x.invalid")');
    expect(names).toContain("'-Negative start");
    for (const name of names) expect(String(name)).not.toMatch(/^[=+@\t\r-]/);
  });

  it('answers an XLSX that reads back with the same numbers, the months as text and the gaps empty', async () => {
    const range = '1y';
    const series = (
      await started.get(
        `/kpi/analytics/series?service=${service.id}&range=${range}&pageSize=200`,
        as(alice),
      )
    ).body as Series;
    const reply = await started.get(exportUrl(`&format=xlsx&range=${range}`), as(alice));
    expect(reply.status).toBe(200);
    expect(reply.res.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(reply.res.headers.get('content-disposition')).toBe(
      `attachment; filename="${service.slug}-kpis-1y.xlsx"`,
    );
    const [header, ...rows] = await readSheet(Buffer.from(reply.bytes));
    for (const heading of header!) expect(typeof heading).toBe('string');
    expect(header!.slice(2)).toEqual(series.result[0]!.points.map((p) => p.period.slice(0, 7)));
    for (const [index, row] of rows.entries()) {
      const kpi = series.result[index]!;
      kpi.points.forEach((point, column) => {
        const cell = row[column + 2] ?? null;
        expect(cell, `${kpi.name} ${point.period}`).toBe(point.value ?? point.text);
      });
    }
  });

  it('takes the filters of the reads and writes a service with no KPIs as a table of headings only', async () => {
    const technical = decode(
      (await started.get(exportUrl('&format=csv&category=Technical'), as(alice))).bytes,
    );
    expect(technical.trimEnd().split('\r\n')).toHaveLength(2);
    expect(technical).toContain('Export never reported');
    const empty = await started.get(
      exportUrl('&format=csv', () => bare.id),
      as(alice),
    );
    expect(empty.status).toBe(200);
    expect(decode(empty.bytes)).toBe('﻿KPI,Unit\r\n');
  });

  it('is audited, with the caller, the route and the outcome, also when it was refused [ASVS-8.2.1]', async () => {
    const s = started;
    const nobody = await s.signedIn('nobody-export-audit', { roles: [] });
    await s.get(exportUrl('&format=csv'), as(alice));
    await s.get(exportUrl('&format=csv'), as(nobody));
    const { rows } = await s.kernel.pool.query<{
      outcome: string;
      user_id: string | null;
      status: number;
      path: string;
    }>(
      "select outcome, user_id, status, path from audit_event where path = '/api/internal/kpi/analytics/export' order by occurred_at, id",
    );
    const mine = rows.filter((row) => row.user_id === alice.user.id);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.at(-1)).toMatchObject({ outcome: 'ok', status: 200 });
    expect(rows.find((row) => row.user_id === nobody.user.id)).toMatchObject({
      outcome: 'denied',
      status: 403,
    });
  });
});
