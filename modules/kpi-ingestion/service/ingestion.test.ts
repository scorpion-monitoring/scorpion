// Preview, dry run and commit of a file or a form, the runs and the templates, against real Postgres (plan §7, tests of sprint 3). The
// key acceptance: the same data through the form, the CSV and the XLSX adapter gives identical rows. A dry run writes nothing, a commit
// is refused whole when any row is rejected, a multi-row write rolls back as a whole, and every entry point is turned away for each class
// of caller that may not submit.
import { Forbidden, Unauthorized, type Actor } from '@scorpion/contracts';
import { makeIndicator, makeKpiSet, makeService, makeServiceKpis } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useKpi, type FixtureModule } from '../test/harness.ts';
import {
  breakOutbox,
  count,
  ingestionWorld,
  payloads,
  rejection,
  stored,
  uniq,
} from '../test/world.ts';
import { bomb, rawWorkbook, workbook } from '../test/xlsx-fixtures.ts';
import { csvAdapter } from './adapter-csv.ts';
import { MAX_FILE_BYTES, sanitiseFileName } from './ingestion.ts';
import { writeCsv } from './csv.ts';

const h = useKpi();
const world = async () => ingestionWorld(await h.start());
type World = Awaited<ReturnType<typeof world>>;
const anonymous: Actor = { kind: 'anonymous' };
const bytes = (text: string) => new TextEncoder().encode(text);
const EVENT = 'measurement.recorded@1';

/** Names of the world's KPIs as headers: `Period`, the mandatory downloads, the others. */
const headerOf = (w: World, ...names: (keyof World['ind'])[]) => [
  'Period',
  ...names.map((name) => w.ind[name].name),
];
const csvFile = (rows: string[][], name = 'values.csv') => ({ name, bytes: bytes(writeCsv(rows)) });
/** What the tests compare: the stored values without ids, times and the run. */
async function values(w: World) {
  return (await stored(w.pool, w.svc.id)).map((row) => ({
    indicator: row.indicator_id,
    period: row.period,
    numeric: row.value_numeric,
    text: row.value_text,
  }));
}
const wipe = (w: World) =>
  w.pool.query('delete from kpii_measurement where service_id = $1', [w.svc.id]);

describe('the registry of adapters', () => {
  it('has the form, the CSV and the XLSX adapter, and the two with a template', async () => {
    const w = await world();
    const list = w.ingestion.ingestion.adapters();
    expect(list.map((adapter) => adapter.id).sort()).toEqual(['csv', 'form', 'xlsx']);
    expect(
      list
        .filter((adapter) => adapter.template)
        .map((adapter) => adapter.id)
        .sort(),
    ).toEqual(['csv', 'xlsx']);
    expect(list.find((adapter) => adapter.id === 'xlsx')?.extensions).toEqual(['xlsx']);
  });

  const fixture = (id: string, entry: unknown): FixtureModule => ({
    manifest: { id, version: '0.1.0', contributes: { 'ingestion.adapter': [entry] } },
    packageJson: {
      name: `@scorpion/${id.replaceAll('.', '-')}`,
      version: '0.0.0',
      dependencies: { '@scorpion/kpi-ingestion': 'workspace:*' },
    },
  });

  it('refuses to start when two adapters have one id', async () => {
    await expect(
      h.start({ extra: [fixture('fixture.csv-twice', { ...csvAdapter })] }),
    ).rejects.toThrow(/id "csv"/);
  });

  it('refuses an entry that is not valid, and names the module', async () => {
    await expect(
      h.build({ extra: [fixture('fixture.bad-adapter', { id: 'Bad Id', labels: { en: 'x' } })] }),
    ).rejects.toThrow(/fixture\.bad-adapter: registry "ingestion\.adapter" entry 0/);
  });

  it('takes a new adapter from another module without a change here', async () => {
    const s = await h.start({
      extra: [
        fixture('fixture.pull', {
          id: 'pull',
          labels: { en: 'Pull' },
          input: 'values',
          accepts: { extensions: [], mediaTypes: [] },
          parse: () => ({}),
        }),
      ],
    });
    expect(s.ingestion.ingestion.adapters().map((adapter) => adapter.id)).toContain('pull');
  });
});

describe('the same data through the form, the CSV and the XLSX adapter', () => {
  it('gives identical rows', async () => {
    const w = await world();
    const { admin } = w.people;
    const names = ['downloads', 'share', 'uptime', 'note', 'ratio'] as const;
    const table = [
      ['2026-01', '42', '12.5', '01-02-03', 'fine, "quoted" größe', '0.1'],
      ['2026-02', '43', '99', '10-00-00', 'zwei\nZeilen', '2.5'],
      ['2026-03-17', '0', '0', '00-00-01', 'x', '1000'],
    ];
    // the form: one period per call
    for (const row of table) {
      const result = await w.ingestion.ingestion.run(admin, {
        serviceId: w.svc.id,
        form: {
          period: row[0]!,
          values: Object.fromEntries(names.map((name, i) => [w.ind[name].id, row[i + 1]!])),
        },
        dryRun: false,
      });
      expect(result.problems).toEqual([]);
      expect(result.status).toBe('committed');
    }
    const viaForm = await values(w);
    expect(viaForm).toHaveLength(15);
    await wipe(w);

    const csv = await w.ingestion.ingestion.run(admin, {
      serviceId: w.svc.id,
      file: csvFile([headerOf(w, ...names), ...table]),
      dryRun: false,
    });
    expect(csv).toMatchObject({ status: 'committed', adapter: 'csv', inserted: 15 });
    const viaCsv = await values(w);
    await wipe(w);

    const xlsx = await w.ingestion.ingestion.run(admin, {
      serviceId: w.svc.id,
      file: { name: 'values.xlsx', bytes: await workbook([headerOf(w, ...names), ...table]) },
      dryRun: false,
    });
    expect(xlsx).toMatchObject({ status: 'committed', adapter: 'xlsx', inserted: 15 });
    const viaXlsx = await values(w);

    expect(viaCsv).toEqual(viaForm);
    expect(viaXlsx).toEqual(viaForm);
  });

  it('reads numbers and dates of a workbook as the same values as text', async () => {
    const w = await world();
    const file = {
      name: 'typed.xlsx',
      bytes: await workbook([
        ['Period', w.ind.downloads.name, w.ind.share.name],
        [{ value: new Date('2026-02-10T00:00:00Z'), format: 'yyyy-mm-dd' }, 7, 12.5],
        ['2026-03', { value: '8', type: String }, '13.5'],
      ]),
    };
    const result = await w.ingestion.ingestion.run(w.people.member, {
      serviceId: w.svc.id,
      file,
      dryRun: false,
    });
    expect(result).toMatchObject({ status: 'committed', inserted: 4 });
    expect((await values(w)).map((row) => [row.period, row.numeric]).sort()).toEqual([
      ['2026-02-28', '12.5'],
      ['2026-02-28', '7'],
      ['2026-03-31', '13.5'],
      ['2026-03-31', '8'],
    ]);
  });
});

describe('a dry run', () => {
  it('writes nothing and says what each value would do', async () => {
    const w = await world();
    await w.submit([w.row(w.ind.downloads, '2026-01', 10), w.row(w.ind.share, '2026-01', 5)]);
    const before = {
      measurements: await count(w.pool, 'kpii_measurement'),
      runs: await count(w.pool, 'kpii_ingestion_run'),
      events: (await payloads(w.pool, EVENT)).length,
    };
    const result = await w.ingestion.ingestion.run(w.people.member, {
      serviceId: w.svc.id,
      file: csvFile([
        headerOf(w, 'downloads', 'share', 'uptime'),
        ['2026-01', '10', '6', '01-00-00'], // unchanged, update, insert
        ['2026-02', '11', '7', 'abc'], // insert, insert, reject
      ]),
      dryRun: true,
    });
    expect(result).toMatchObject({
      status: 'preview',
      runId: null,
      inserted: 3,
      updated: 1,
      unchanged: 1,
      rejected: 1,
    });
    expect(result.rows.map((row) => [row.row, row.column, row.verdict])).toEqual([
      [2, 2, 'unchanged'],
      [2, 3, 'update'],
      [2, 4, 'insert'],
      [3, 2, 'insert'],
      [3, 3, 'insert'],
      [3, 4, 'reject'],
    ]);
    expect(result.problems).toEqual([{ row: 3, column: 4, code: 'value-invalid' }]);
    expect({
      measurements: await count(w.pool, 'kpii_measurement'),
      runs: await count(w.pool, 'kpii_ingestion_run'),
      events: (await payloads(w.pool, EVENT)).length,
    }).toEqual(before);
  });

  it('says the same as the commit that follows it', async () => {
    const w = await world();
    const file = csvFile([
      headerOf(w, 'downloads', 'share'),
      ['2026-04', '1', '2'],
      ['2026-05', '3', '4'],
    ]);
    const dry = await w.ingestion.ingestion.run(w.people.member, {
      serviceId: w.svc.id,
      file,
      dryRun: true,
    });
    const real = await w.ingestion.ingestion.run(w.people.member, {
      serviceId: w.svc.id,
      file,
      dryRun: false,
    });
    expect(real.rows).toEqual(dry.rows);
    expect([real.inserted, real.updated, real.unchanged]).toEqual([
      dry.inserted,
      dry.updated,
      dry.unchanged,
    ]);
  });
});

describe('a commit', () => {
  it('is refused whole when any row is rejected, and the refusal is recorded with its counts and problems and nothing else [ASVS-8.2.1]', async () => {
    const w = await world();
    const secret = 'SECRET-CELL-CONTENT';
    const result = await w.ingestion.ingestion.run(w.people.member, {
      serviceId: w.svc.id,
      file: csvFile(
        [
          headerOf(w, 'downloads', 'share'),
          ['2026-01', '1', '2'],
          ['2026-02', secret, '3'],
          ['2026-03', '5', '4'],
        ],
        '../../etc/pass\twd<script>.csv',
      ),
      dryRun: false,
    });
    expect(result).toMatchObject({
      status: 'rejected',
      inserted: 0,
      updated: 0,
      unchanged: 0,
      rejected: 1,
    });
    expect(result.problems).toEqual([{ row: 3, column: 2, code: 'value-invalid' }]);
    expect(await count(w.pool, 'kpii_measurement')).toBe(0);
    expect(await payloads(w.pool, EVENT)).toEqual([]);

    const [run] = await w.ingestion.ingestion.listRuns(w.people.member, w.svc.id);
    expect(run).toMatchObject({
      id: result.runId,
      status: 'rejected',
      adapter: 'csv',
      actorId: w.people.member.userId,
      rejected: 1,
      inserted: 0,
      problems: [{ row: 3, column: 2, code: 'value-invalid' }],
    });
    // a sanitised name: no path, no control character, no markup
    expect(run!.fileName).toBe('pass_wd_script_.csv');
    // nothing of the file's content is kept anywhere in the run
    expect(JSON.stringify(run)).not.toContain(secret);
    const raw = await w.pool.query('select * from kpii_ingestion_run where id = $1', [
      result.runId,
    ]);
    expect(JSON.stringify(raw.rows)).not.toContain(secret);
  });

  it('writes the values, the run and the event together, and the event never holds a value', async () => {
    const w = await world();
    const result = await w.ingestion.ingestion.run(w.people.member, {
      serviceId: w.svc.id,
      file: csvFile(
        [headerOf(w, 'downloads', 'note'), ['2026-01', '123456', 'DISTINCTIVE-TEXT']],
        'Q1 2026.csv',
      ),
      dryRun: false,
    });
    expect(result).toMatchObject({ status: 'committed', inserted: 2, rejected: 0 });
    const rows = await stored(w.pool, w.svc.id);
    expect(rows.map((row) => [row.source, row.run_id])).toEqual([
      ['csv', result.runId],
      ['csv', result.runId],
    ]);
    const [run] = await w.ingestion.ingestion.listRuns(w.people.member, w.svc.id);
    expect(run).toMatchObject({
      id: result.runId,
      status: 'committed',
      inserted: 2,
      updated: 0,
      unchanged: 0,
      fileName: 'Q1 2026.csv',
    });
    expect(run!.finishedAt).not.toBeNull();
    const events = await payloads(w.pool, EVENT);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ serviceId: w.svc.id, runId: result.runId, inserted: 2 });
    expect(JSON.stringify(events)).not.toMatch(/123456|DISTINCTIVE/);
  });

  it('takes its times from the injected clock', async () => {
    const s = await h.start();
    s.clock.set('2026-03-04T05:06:07Z');
    const w = await ingestionWorld(s);
    await w.ingestion.ingestion.run(w.people.member, {
      serviceId: w.svc.id,
      form: { period: '2026-02', values: { [w.ind.downloads.id]: '1' } },
      dryRun: false,
    });
    const [run] = await w.ingestion.ingestion.listRuns(w.people.member, w.svc.id);
    expect(run!.startedAt.toISOString()).toBe('2026-03-04T05:06:07.000Z');
    expect(run!.finishedAt!.toISOString()).toBe('2026-03-04T05:06:07.000Z');
  });

  it('rolls back the run, the values and the event together when the event cannot be stored', async () => {
    const w = await world();
    const undo = await breakOutbox(w.pool);
    try {
      await expect(
        w.ingestion.ingestion.run(w.people.member, {
          serviceId: w.svc.id,
          file: csvFile([
            headerOf(w, 'downloads', 'share'),
            ['2026-01', '1', '2'],
            ['2026-02', '3', '4'],
          ]),
          dryRun: false,
        }),
      ).rejects.toThrow();
    } finally {
      await undo();
    }
    expect(await count(w.pool, 'kpii_measurement')).toBe(0);
    expect(await count(w.pool, 'kpii_ingestion_run')).toBe(0);
  });

  it('records a second upload of the same month as an update, not a second row', async () => {
    const w = await world();
    const run = (value: string) =>
      w.ingestion.ingestion.run(w.people.member, {
        serviceId: w.svc.id,
        file: csvFile([headerOf(w, 'downloads'), ['2026-01', value]]),
        dryRun: false,
      });
    expect(await run('1')).toMatchObject({ inserted: 1 });
    expect(await run('2')).toMatchObject({ inserted: 0, updated: 1 });
    expect(await run('2')).toMatchObject({ unchanged: 1, updated: 0 });
    expect(await count(w.pool, 'kpii_measurement')).toBe(1);
    expect(await count(w.pool, 'kpii_ingestion_run')).toBe(3);
  });
});

describe('who may preview, run, read the runs and fetch the template [ASVS-8.2.1] [ASVS-8.3.1]', () => {
  it('turns away every caller class that may not submit for the service', async () => {
    const w = await world();
    const ing = w.ingestion.ingestion;
    const file = csvFile([headerOf(w, 'downloads'), ['2026-01', '1']]);
    const calls: [string, (who: Actor) => Promise<unknown>][] = [
      ['preview', (who) => ing.preview(who, { serviceId: w.svc.id, file })],
      ['dry run', (who) => ing.run(who, { serviceId: w.svc.id, file, dryRun: true })],
      ['commit', (who) => ing.run(who, { serviceId: w.svc.id, file, dryRun: false })],
      [
        'form',
        (who) =>
          ing.run(who, {
            serviceId: w.svc.id,
            form: { period: '2026-01', values: { [w.ind.downloads.id]: '1' } },
            dryRun: false,
          }),
      ],
      ['runs', (who) => ing.listRuns(who, w.svc.id)],
      ['template csv', (who) => ing.template(who, w.svc.id, 'csv')],
      ['template xlsx', (who) => ing.template(who, w.svc.id, 'xlsx')],
    ];
    for (const [what, call] of calls) {
      await expect(call(anonymous), `anonymous ${what}`).rejects.toBeInstanceOf(Unauthorized);
      for (const who of [
        'plain',
        'reviewer',
        'requested',
        'rejected',
        'left',
        'elsewhere',
      ] as const)
        await expect(call(w.people[who]), `${who} ${what}`).rejects.toBeInstanceOf(Forbidden);
    }
    expect(await count(w.pool, 'kpii_measurement')).toBe(0);
    expect(await count(w.pool, 'kpii_ingestion_run')).toBe(0);
  });

  it('lets Admin, a manager and a member through, each only for the provider’s own services', async () => {
    const w = await world();
    const ing = w.ingestion.ingestion;
    for (const who of ['admin', 'manager', 'member'] as const)
      expect(
        (await ing.template(w.people[who], w.svc.id, 'csv')).bytes.length,
        who,
      ).toBeGreaterThan(0);
    await expect(ing.template(w.people.member, w.elsewhereSvc.id, 'csv')).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(ing.listRuns(w.people.member, w.elsewhereSvc.id)).rejects.toBeInstanceOf(
      Forbidden,
    );
  });

  it('reads one run only for those who may submit for its service, and answers 404 for an unknown one', async () => {
    const w = await world();
    const ing = w.ingestion.ingestion;
    const made = await ing.run(w.people.member, {
      serviceId: w.svc.id,
      form: { period: '2026-01', values: { [w.ind.downloads.id]: '1' } },
      dryRun: false,
    });
    expect((await ing.getRun(w.people.manager, made.runId!)).id).toBe(made.runId);
    await expect(ing.getRun(w.people.elsewhere, made.runId!)).rejects.toBeInstanceOf(Forbidden);
    await expect(ing.getRun(anonymous, made.runId!)).rejects.toBeInstanceOf(Unauthorized);
    expect(
      (await rejection(ing.getRun(w.people.admin, '00000000-0000-4000-8000-000000000000'))).status,
    ).toBe(404);
    expect((await rejection(ing.getRun(w.people.admin, 'nope'))).status).toBe(404);
  });
});

describe('the request', () => {
  it('is a 422, never a 500, for the shapes that are wrong as a whole', async () => {
    const w = await world();
    const ing = w.ingestion.ingestion;
    const admin = w.people.admin;
    const ok = csvFile([headerOf(w, 'downloads'), ['2026-01', '1']]);
    const form = { period: '2026-01', values: { [w.ind.downloads.id]: '1' } };
    const cases: [string, () => Promise<unknown>][] = [
      ['neither file nor form', () => ing.run(admin, { serviceId: w.svc.id, dryRun: true })],
      ['both', () => ing.run(admin, { serviceId: w.svc.id, file: ok, form, dryRun: true })],
      [
        'an unknown adapter',
        () => ing.run(admin, { serviceId: w.svc.id, file: ok, adapter: 'nope', dryRun: true }),
      ],
      [
        'a file for the form adapter',
        () => ing.run(admin, { serviceId: w.svc.id, file: ok, adapter: 'form', dryRun: true }),
      ],
      [
        'a form for a file adapter',
        () => ing.run(admin, { serviceId: w.svc.id, form, adapter: 'csv', dryRun: true }),
      ],
      [
        'an empty file',
        () =>
          ing.run(admin, {
            serviceId: w.svc.id,
            file: { name: 'a.csv', bytes: new Uint8Array() },
            dryRun: true,
          }),
      ],
      [
        'a file over 2 MiB',
        () =>
          ing.run(admin, {
            serviceId: w.svc.id,
            file: { name: 'a.csv', bytes: new Uint8Array(MAX_FILE_BYTES + 1).fill(97) },
            dryRun: true,
          }),
      ],
      [
        'a file with a header only',
        () =>
          ing.run(admin, {
            serviceId: w.svc.id,
            file: csvFile([headerOf(w, 'downloads')]),
            dryRun: true,
          }),
      ],
      [
        'a file with no values',
        () =>
          ing.run(admin, {
            serviceId: w.svc.id,
            file: csvFile([headerOf(w, 'downloads'), ['2026-01', '']]),
            dryRun: true,
          }),
      ],
      [
        'an empty form',
        () =>
          ing.run(admin, {
            serviceId: w.svc.id,
            form: { period: '2026-01', values: {} },
            dryRun: true,
          }),
      ],
      [
        'a blank form',
        () =>
          ing.run(admin, {
            serviceId: w.svc.id,
            form: { period: '2026-01', values: { [w.ind.downloads.id]: '  ' } },
            dryRun: true,
          }),
      ],
      [
        'a service id that is not one',
        () => ing.run(admin, { serviceId: 'nope', file: ok, dryRun: true }),
      ],
      ['a template of an unknown format', () => ing.template(admin, w.svc.id, 'pdf')],
      ['a template of a form', () => ing.template(admin, w.svc.id, 'form')],
    ];
    for (const [what, call] of cases) expect((await rejection(call())).status, what).toBe(422);
    expect(
      (
        await rejection(
          ing.run(admin, {
            serviceId: '00000000-0000-4000-8000-000000000000',
            file: ok,
            dryRun: true,
          }),
        )
      ).status,
    ).toBe(404);
    expect(await count(w.pool, 'kpii_ingestion_run')).toBe(0);
  });

  it('is a 422 for a service with no KPI set, for the preview and the template', async () => {
    const w = await world();
    const bare = await makeService(w.pool, { provider: w.provider.id });
    const ing = w.ingestion.ingestion;
    const file = csvFile([
      ['Period', 'x'],
      ['2026-01', '1'],
    ]);
    expect(
      (await rejection(ing.preview(w.people.member, { serviceId: bare.id, file }))).status,
    ).toBe(422);
    expect((await rejection(ing.template(w.people.member, bare.id, 'csv'))).status).toBe(422);
  });

  it('is a 422 for a form with too many values', async () => {
    const w = await world();
    const values = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`k${i}`, '1']));
    const error = await rejection(
      w.ingestion.ingestion.run(w.people.admin, {
        serviceId: w.svc.id,
        form: { period: '2026-01', values },
        dryRun: true,
      }),
    );
    expect(error.status).toBe(422);
  });
});

describe('the files', () => {
  it('lets the content decide, and the extension is a hint', async () => {
    const w = await world();
    const ing = w.ingestion.ingestion;
    const table = [headerOf(w, 'downloads'), ['2026-01', '5']];
    // a workbook saved as .csv is read as a workbook
    const asCsv = await ing.preview(w.people.member, {
      serviceId: w.svc.id,
      file: { name: 'really.csv', bytes: await workbook(table) },
      adapter: 'csv',
    });
    expect(asCsv).toMatchObject({ adapter: 'xlsx', totalRows: 1 });
    // text named .xlsx, with the xlsx adapter asked for, is read as text
    const asXlsx = await ing.preview(w.people.member, {
      serviceId: w.svc.id,
      file: { name: 'really.xlsx', bytes: bytes(writeCsv(table)) },
      adapter: 'xlsx',
    });
    expect(asXlsx).toMatchObject({ adapter: 'csv', totalRows: 1 });
    // a tab file is detected from its content
    const tsv = await ing.preview(w.people.member, {
      serviceId: w.svc.id,
      file: { name: 'a.txt', bytes: bytes(`Period\t${w.ind.downloads.name}\n2026-01\t5\n`) },
    });
    expect(tsv).toMatchObject({ adapter: 'csv', totalRows: 1, problems: [] });
  });

  it('answers a file that is neither a table nor a workbook with a problem and records the refusal, not a 500', async () => {
    const w = await world();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    const result = await w.ingestion.ingestion.run(w.people.member, {
      serviceId: w.svc.id,
      file: { name: 'logo.png', bytes: png },
      dryRun: false,
    });
    expect(result).toMatchObject({
      status: 'rejected',
      problems: [{ row: 0, column: 0, code: 'format' }],
    });
    const latin1 = Uint8Array.from(
      [...'Periode;Größe\n2026-01;1\n'].map((ch) => ch.charCodeAt(0) & 0xff),
    );
    const encoding = await w.ingestion.ingestion.preview(w.people.member, {
      serviceId: w.svc.id,
      file: { name: 'old.csv', bytes: latin1 },
    });
    expect(encoding.problems).toEqual([{ row: 0, column: 0, code: 'encoding' }]);
  });

  it('refuses a zip bomb, a truncated, an encrypted-looking and a damaged workbook as problems, and keeps no content', async () => {
    const w = await world();
    const ing = w.ingestion.ingestion;
    const good = await workbook([headerOf(w, 'downloads'), ['2026-01', '5']]);
    const refused = async (file: Uint8Array) =>
      (
        await ing.run(w.people.member, {
          serviceId: w.svc.id,
          file: { name: 'x.xlsx', bytes: file },
          adapter: 'xlsx',
          dryRun: false,
        })
      ).problems;
    expect(await refused(bomb())).toEqual([{ row: 0, column: 0, code: 'declared-too-large' }]);
    expect(await refused(good.subarray(0, good.length - 30))).toEqual([
      { row: 0, column: 0, code: 'not-a-zip' },
    ]);
    const ole = new Uint8Array(1024);
    ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(await refused(ole)).toEqual([{ row: 0, column: 0, code: 'encrypted' }]);
    expect(await count(w.pool, 'kpii_measurement')).toBe(0);
    expect(await count(w.pool, 'kpii_ingestion_run')).toBe(3);
  });

  it('reads the first sheet, or the sheet that is named, and says when there is none', async () => {
    const w = await world();
    const ing = w.ingestion.ingestion;
    const file = {
      name: 'a.xlsx',
      bytes: await workbook([headerOf(w, 'downloads'), ['2026-01', '5']], 'Data'),
    };
    expect(
      (await ing.preview(w.people.member, { serviceId: w.svc.id, file, sheet: 'Data' })).totalRows,
    ).toBe(1);
    expect(
      (await ing.preview(w.people.member, { serviceId: w.svc.id, file, sheet: 'Nope' })).problems,
    ).toEqual([{ row: 0, column: 0, code: 'sheet-not-found' }]);
  });

  it('reads the cached value of a formula and never evaluates it', async () => {
    const w = await world();
    const sheet =
      `<row r="1"><c r="A1" t="inlineStr"><is><t>Period</t></is></c><c r="B1" t="inlineStr"><is><t>${w.ind.downloads.name}</t></is></c></row>` +
      `<row r="2"><c r="A2" t="inlineStr"><is><t>2026-01</t></is></c><c r="B2"><f>1+1</f><v>7</v></c></row>`;
    const result = await w.ingestion.ingestion.run(w.people.member, {
      serviceId: w.svc.id,
      file: { name: 'f.xlsx', bytes: rawWorkbook(sheet) },
      dryRun: false,
    });
    expect(result.status).toBe('committed');
    expect((await values(w))[0]!.numeric).toBe('7');
  });

  it('reads a merged cell as its top-left value, and an empty sheet as an empty file', async () => {
    const w = await world();
    const merged = rawWorkbook(
      `<row r="1"><c r="A1" t="inlineStr"><is><t>Period</t></is></c><c r="B1" t="inlineStr"><is><t>${w.ind.downloads.name}</t></is></c></row>` +
        `<row r="2"><c r="A2" t="inlineStr"><is><t>2026-01</t></is></c><c r="B2"><v>5</v></c></row>` +
        `<row r="3"><c r="A3"/><c r="B3"/></row>`,
    );
    const preview = await w.ingestion.ingestion.preview(w.people.member, {
      serviceId: w.svc.id,
      file: { name: 'm.xlsx', bytes: merged },
    });
    expect(preview.rows).toEqual([['2026-01', '5']]);
    const empty = await w.ingestion.ingestion.preview(w.people.member, {
      serviceId: w.svc.id,
      file: { name: 'e.xlsx', bytes: rawWorkbook('') },
    });
    expect(empty.problems).toEqual([{ row: 0, column: 0, code: 'empty-file' }]);
  });
});

describe('the mapping', () => {
  it('proposes columns from the header: by name without case, by id, with the decoration of the template, and the period by its name', async () => {
    const w = await world();
    const header = [
      'MONAT',
      w.ind.downloads.name.toUpperCase(),
      w.ind.share.id,
      `${w.ind.uptime.name} (hours) *`,
      'Comment',
    ];
    const preview = await w.ingestion.ingestion.preview(w.people.member, {
      serviceId: w.svc.id,
      file: csvFile([header, ['2026-01', '1', '2', '01-00-00', 'x']]),
    });
    expect(preview).toMatchObject({
      proposed: true,
      mapping: {
        '0': 'period',
        '1': w.ind.downloads.id,
        '2': w.ind.share.id,
        '3': w.ind.uptime.id,
      },
      missing: [],
      problems: [],
    });
  });

  it('says which required columns are missing: the period and every mandatory KPI', async () => {
    const w = await world();
    const noPeriod = await w.ingestion.ingestion.preview(w.people.member, {
      serviceId: w.svc.id,
      file: csvFile([[w.ind.downloads.name], ['1']]),
    });
    expect(noPeriod.missing).toEqual(['period']);
    const noMandatory = await w.ingestion.ingestion.preview(w.people.member, {
      serviceId: w.svc.id,
      file: csvFile([
        ['Period', w.ind.share.name],
        ['2026-01', '1'],
      ]),
    });
    expect(noMandatory.missing).toEqual([w.ind.downloads.id]);
    expect(noMandatory.problems.map((problem) => problem.code)).toEqual(['missing-column']);
    const refused = await w.ingestion.ingestion.run(w.people.member, {
      serviceId: w.svc.id,
      file: csvFile([
        ['Period', w.ind.share.name],
        ['2026-01', '1'],
      ]),
      dryRun: false,
    });
    expect(refused.status).toBe('rejected');
    expect(await count(w.pool, 'kpii_measurement')).toBe(0);
  });

  it('uses the mapping the request gives over the header, and refuses one that names a thing that is not there or a target twice', async () => {
    const w = await world();
    const ing = w.ingestion.ingestion;
    const file = csvFile([
      ['when', 'a', 'b'],
      ['2026-01', '1', '2'],
    ]);
    const given = { '0': 'period', '1': w.ind.downloads.id, '2': w.ind.share.id };
    const preview = await ing.preview(w.people.member, {
      serviceId: w.svc.id,
      file,
      mapping: given,
    });
    expect(preview).toMatchObject({ proposed: false, mapping: given, problems: [] });
    const run = await ing.run(w.people.member, {
      serviceId: w.svc.id,
      file,
      mapping: given,
      dryRun: false,
    });
    expect(run).toMatchObject({ status: 'committed', inserted: 2 });
    for (const bad of [
      { '0': 'period', '1': w.ind.downloads.id, '2': w.ind.downloads.id },
      { '0': 'period', '1': w.ind.outside.id },
      { '0': 'period', '7': w.ind.downloads.id },
      { '0': 'nonsense' },
      { x: w.ind.downloads.id },
    ]) {
      const result = await ing.preview(w.people.member, {
        serviceId: w.svc.id,
        file,
        mapping: bad,
      });
      expect(
        result.problems.map((problem) => problem.code),
        JSON.stringify(bad),
      ).toContain('mapping-invalid');
    }
  });

  it('reports a blank mandatory value, a row without a period, a boolean cell and the same month twice, each with its row and column', async () => {
    const w = await world();
    const ing = w.ingestion.ingestion;
    const file = csvFile([
      headerOf(w, 'downloads', 'share'),
      ['2026-01', '', '5'], // mandatory blank
      ['', '1', '2'], // no period
      ['2026-02', '1', '2'],
      ['2026-02-10', '3', '4'], // the same month as the row above
      ['', '', ''], // skipped
      ['2026-03', '1', ''], // fine: the share is not mandatory
    ]);
    const result = await ing.run(w.people.member, { serviceId: w.svc.id, file, dryRun: true });
    expect(result.problems).toEqual([
      { row: 2, column: 2, code: 'required-value' },
      { row: 3, column: 1, code: 'period-missing' },
      { row: 5, column: 1, code: 'duplicate-row' },
    ]);
    const typed = await workbook([headerOf(w, 'downloads'), ['2026-01', true]]);
    const boolean = await ing.run(w.people.member, {
      serviceId: w.svc.id,
      file: { name: 'b.xlsx', bytes: typed },
      dryRun: true,
    });
    expect(boolean.problems).toEqual([{ row: 2, column: 2, code: 'cell-type' }]);
  });

  it('keeps at most 100 problems and never echoes a cell beyond 64 characters', async () => {
    const w = await world();
    const rows = Array.from({ length: 300 }, (_, i) => [`2026-01`, `bad-${i}`]);
    const header = ['Period', `${'H'.repeat(100)}`, w.ind.downloads.name];
    const long = await w.ingestion.ingestion.preview(w.people.member, {
      serviceId: w.svc.id,
      file: csvFile([header, ['2026-01', 'y'.repeat(500), '1']]),
    });
    expect(long.header[1]).toHaveLength(65);
    expect(long.rows[0]![1]).toHaveLength(65);
    const many = await w.ingestion.ingestion.run(w.people.member, {
      serviceId: w.svc.id,
      file: csvFile([
        ['Period', w.ind.downloads.name],
        ...rows.map((row, i) => [`2026-${String((i % 12) + 1).padStart(2, '0')}`, row[1]!]),
      ]),
      dryRun: false,
    });
    expect(many.problems).toHaveLength(100);
    expect(JSON.stringify(many)).not.toContain('bad-');
    const [run] = await w.ingestion.ingestion.listRuns(w.people.member, w.svc.id);
    expect(run!.problems).toHaveLength(100);
  });
});

describe('the run history', () => {
  it('lists the last 50 runs of one service, newest first', async () => {
    const w = await world();
    await w.pool.query(
      `insert into kpii_ingestion_run (id, service_id, adapter, status, started_at)
       select gen_random_uuid(), $1, 'csv', 'rejected', now() - (g || ' minutes')::interval from generate_series(1, 60) g`,
      [w.svc.id],
    );
    await w.pool.query(
      `insert into kpii_ingestion_run (id, service_id, adapter, status) values (gen_random_uuid(), $1, 'csv', 'rejected')`,
      [w.elsewhereSvc.id],
    );
    const runs = await w.ingestion.ingestion.listRuns(w.people.member, w.svc.id);
    expect(runs).toHaveLength(50);
    expect(runs.every((run) => run.serviceId === w.svc.id)).toBe(true);
    expect(runs.map((run) => run.startedAt.getTime())).toEqual(
      [...runs.map((run) => run.startedAt.getTime())].sort((a, b) => b - a),
    );
  });
});

describe('the import template', () => {
  /** A service whose indicators have names a spreadsheet would read as formulas. */
  async function hostile(w: World) {
    const names = ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tTabbed', '\rReturn', 'Plain'];
    const made = [];
    for (const name of names)
      made.push(
        await makeIndicator(w.pool, {
          name: `${name} ${uniq('h')}`,
          valueType: 'integer',
          unit: 'count',
        }),
      );
    const set = await makeKpiSet(w.pool, {
      name: uniq('Hostile set'),
      indicators: made.map((indicator, i) => ({
        indicatorId: indicator.id,
        necessity: i === 0 ? 'mandatory' : 'optional',
      })),
    });
    const svc = await makeService(w.pool, { provider: w.provider.id });
    await makeServiceKpis(w.pool, { serviceId: svc.id, setId: set.id });
    return { svc, made };
  }

  it('is a CSV with a byte order mark, a header with unit and mandatory marker, and the previous month as the example', async () => {
    const w = await world();
    const file = await w.ingestion.ingestion.template(w.people.member, w.svc.id, 'csv');
    expect(file.contentType).toBe('text/csv; charset=utf-8');
    expect(file.fileName).toBe(`${w.svc.slug}-import-template.csv`);
    expect([...file.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(file.bytes);
    expect(text.split('\r\n')[0]).toBe(
      `Period,${w.ind.downloads.name} (count) *,${w.ind.note.name},${w.ind.share.name} (percent),${w.ind.uptime.name},${w.ind.ratio.name}`,
    );
    expect(text.split('\r\n')[1]).toMatch(/^2026-05,,,,,$/);
  });

  it('escapes every cell that starts with =, +, -, @, a tab or a carriage return, in the CSV and in the XLSX', async () => {
    const w = await world();
    const { svc, made } = await hostile(w);
    for (const format of ['csv', 'xlsx'] as const) {
      const file = await w.ingestion.ingestion.template(w.people.member, svc.id, format);
      const preview = await w.ingestion.ingestion.preview(w.people.member, {
        serviceId: svc.id,
        file: { name: file.fileName, bytes: file.bytes },
      });
      // read back the raw cells: the reader of the preview takes the escape off, so look at the bytes
      const cells =
        format === 'csv'
          ? (await import('./csv.ts')).parseCsv(new TextDecoder().decode(file.bytes)).rows[0]!
          : (
              (await (
                await import('read-excel-file/node')
              ).readSheet(Buffer.from(file.bytes))) as string[][]
            )[0]!;
      for (const cell of cells)
        expect(/^[=+\-@\t\r]/.test(cell), `${format}: ${JSON.stringify(cell)}`).toBe(false);
      expect(cells.filter((cell) => cell.startsWith("'"))).toHaveLength(6);
      // and the template re-uploads unchanged: every column maps back to its indicator
      expect(Object.values(preview.mapping).sort(), format).toEqual(
        ['period', ...made.map((indicator) => indicator.id)].sort(),
      );
    }
  });

  it('gives the XLSX template as a workbook that reads back, and a name from the abbreviation only', async () => {
    const w = await world();
    const file = await w.ingestion.ingestion.template(w.people.member, w.svc.id, 'xlsx');
    expect(file.fileName).toBe(`${w.svc.slug}-import-template.xlsx`);
    expect(file.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const preview = await w.ingestion.ingestion.preview(w.people.member, {
      serviceId: w.svc.id,
      file: { name: file.fileName, bytes: file.bytes },
    });
    expect(preview).toMatchObject({ adapter: 'xlsx', totalRows: 1, missing: [], problems: [] });
  });

  it('re-uploads filled in, unchanged', async () => {
    const w = await world();
    for (const format of ['csv', 'xlsx'] as const) {
      const template = await w.ingestion.ingestion.template(w.people.member, w.svc.id, format);
      const preview = await w.ingestion.ingestion.preview(w.people.member, {
        serviceId: w.svc.id,
        file: { name: template.fileName, bytes: template.bytes },
      });
      expect(preview.header).toHaveLength(6);
      const filled =
        format === 'csv'
          ? bytes(
              new TextDecoder()
                .decode(template.bytes)
                .replace(/\r\n$/, '')
                .replace(/^(.*)\r\n.*$/s, `$1\r\n2026-05,10,hello,20,01-00-00,1.5\r\n`),
            )
          : await workbook([preview.header, ['2026-05', '10', 'hello', '20', '01-00-00', '1.5']]);
      const result = await w.ingestion.ingestion.run(w.people.member, {
        serviceId: w.svc.id,
        file: { name: template.fileName, bytes: filled },
        dryRun: false,
      });
      expect(result, format).toMatchObject({ status: 'committed' });
      await wipe(w);
    }
  });
});

describe('the file name of a run', () => {
  it.each([
    ['report.csv', 'report.csv'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\me\\Q1 2026.xlsx', 'Q1 2026.xlsx'],
    ['a\u0000b\u0007c.csv', 'a_b_c.csv'],
    ['<script>alert(1)</script>.csv', 'script_.csv'],
    ['.hidden', 'hidden'],
    ['...', null],
    ['', null],
    ['Größe ü.csv', 'Größe ü.csv'],
  ])('sanitises %j to %j', (input, expected) => {
    expect(sanitiseFileName(input)).toBe(expected);
  });
  it('bounds a very long name to 120 characters and keeps the extension', () => {
    const name = sanitiseFileName(`${'x'.repeat(500)}.xlsx`)!;
    expect([...name]).toHaveLength(120);
    expect(name.endsWith('.xlsx')).toBe(true);
    expect(sanitiseFileName(null)).toBeNull();
  });
});
