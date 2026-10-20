// `upsertByName`: `POST /api/v1/measurements` as a service call (M10 sprint 2). The legacy shape `{ kpi, value, date }`, the
// indicator by name without case or by id, the service by id or abbreviation, and the answers named in the language of the request
// (`[3].kpi`). The same write path as `upsertBatch`: the same month twice is one row, a bad item stops the whole batch, the scoped
// permission is checked for the actor. Real Postgres and the real authoriser.
import {
  Forbidden,
  Invalid,
  Unauthorized,
  type Actor,
  type FieldProblem,
  type UserActor,
} from '@scorpion/contracts';
import { makeIndicator, makeKpiSet } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useKpi } from '../test/harness.ts';
import {
  breakOutbox,
  count,
  ingestionWorld,
  payloads,
  rejection,
  stored,
  uniq,
} from '../test/world.ts';
import { PERMISSION_SUBMIT, PERMISSION_V1_WRITE } from './permissions.ts';

const h = useKpi();
const world = async () => ingestionWorld(await h.start());
const anonymous: Actor = { kind: 'anonymous' };
const EVENT = 'measurement.recorded@1';
// built from code points: an editor or a formatter may turn an escape into the raw character, and the two spellings must stay apart
const E_ACUTE = String.fromCharCode(0xe9);
const COMBINING_ACUTE = String.fromCharCode(0x301);
const token = (owner: UserActor, scopes: string[]): UserActor => ({
  ...owner,
  via: 'token',
  scopes,
});
const problems = (error: { errors?: readonly FieldProblem[] }) =>
  (error.errors ?? []).map((e) => `${e.in}:${e.path}`);

describe('upsertByName writes', () => {
  it('takes the indicator by name in any case, by id, and an extra by name; stores source api and the author [ASVS-8.2.1]', async () => {
    const w = await world();
    const { downloads, share, ratio, uptime } = w.ind;
    const result = await w.ingestion.measurements.upsertByName(w.people.member, w.svc.slug, [
      { kpi: downloads.name.toUpperCase(), value: 42, date: '2026-01' },
      { kpi: share.id, value: '12.5', date: '2026-01-15' },
      { kpi: `  ${ratio.name.toLowerCase()}  `, value: '0.25', date: '2026-02' },
      { kpi: uptime.name, value: '01-00-00', date: '2026-02-28' },
    ]);
    expect(result).toEqual({ inserted: 4, updated: 0, unchanged: 0, rejected: 0 });
    const rows = await stored(w.pool, w.svc.id);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.source === 'api')).toBe(true);
    expect(rows.every((row) => row.created_by === w.people.member.userId)).toBe(true);
    const byIndicator = new Map(rows.map((row) => [row.indicator_id, row]));
    expect(byIndicator.get(downloads.id)).toMatchObject({
      period: '2026-01-31',
      value_numeric: '42',
    });
    expect(byIndicator.get(uptime.id)).toMatchObject({
      period: '2026-02-28',
      value_numeric: '3600',
    });
    expect((await payloads(w.pool, EVENT))[0]).toMatchObject({ inserted: 4, updated: 0 });
  });

  it('takes the service by id and by abbreviation without case, and an old abbreviation', async () => {
    const w = await world();
    const item = (n: number) => [{ kpi: w.ind.downloads.name, value: n, date: '2026-03' }];
    const call = (service: string, n: number) =>
      w.ingestion.measurements.upsertByName(w.people.member, service, item(n));
    expect((await call(w.svc.id, 1)).inserted).toBe(1);
    expect((await call(w.svc.slug.toUpperCase(), 2)).updated).toBe(1);
    expect((await call(w.svc.slug, 2)).unchanged).toBe(1);
    expect(await count(w.pool, 'kpii_measurement')).toBe(1);
  });

  it('writing the same month twice is one row: the second is an update, the third is unchanged', async () => {
    const w = await world();
    const send = (value: number) =>
      w.ingestion.measurements.upsertByName(w.people.member, w.svc.id, [
        { kpi: w.ind.downloads.name, value, date: '2026-01' },
      ]);
    expect(await send(1)).toMatchObject({ inserted: 1, updated: 0, unchanged: 0 });
    expect(await send(2)).toMatchObject({ inserted: 0, updated: 1, unchanged: 0 });
    expect(await send(2)).toMatchObject({ inserted: 0, updated: 0, unchanged: 1 });
    const rows = await stored(w.pool, w.svc.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value_numeric).toBe('2');
  });

  it('gives the same rows as upsertBatch with the same data (one write path)', async () => {
    const w = await world();
    const { downloads, share } = w.ind;
    await w.ingestion.measurements.upsertByName(w.people.member, w.svc.id, [
      { kpi: downloads.name, value: 7, date: '2026-04' },
      { kpi: share.name, value: 50, date: '2026-04-10' },
    ]);
    const viaName = (await stored(w.pool, w.svc.id)).map(
      ({ indicator_id, period, value_numeric, value_text }) => ({
        indicator_id,
        period,
        value_numeric,
        value_text,
      }),
    );
    await w.pool.query('delete from kpii_measurement');
    await w.submit([w.row(downloads, '2026-04', 7), w.row(share, '2026-04-10', 50)]);
    const viaId = (await stored(w.pool, w.svc.id)).map(
      ({ indicator_id, period, value_numeric, value_text }) => ({
        indicator_id,
        period,
        value_numeric,
        value_text,
      }),
    );
    expect(viaName).toEqual(viaId);
  });
});

describe('upsertByName names what is wrong in the shape of the request, and writes nothing', () => {
  it('names an unknown, an ambiguous and an outside KPI on [i].kpi, a bad value on [i].value and a bad month on [i].date, all at once', async () => {
    const s = await h.start();
    const w = await ingestionWorld(s);
    // two indicators whose names are the same word (é composed and decomposed): the database tells them apart, a person does not
    const stem = uniq('Twin');
    const twin1 = await makeIndicator(s.pool, {
      name: `${stem} caf${E_ACUTE}`,
      valueType: 'integer',
    });
    const twin2 = await makeIndicator(s.pool, {
      name: `${stem} cafe${COMBINING_ACUTE}`,
      valueType: 'integer',
    });
    const set = await makeKpiSet(s.pool, {
      name: uniq('twin set'),
      indicators: [
        { indicatorId: twin1.id, necessity: 'optional' },
        { indicatorId: twin2.id, necessity: 'optional' },
        { indicatorId: w.ind.downloads.id, necessity: 'mandatory' },
      ],
    });
    await s.pool.query('update kpif_service_set set set_id = $1 where service_id = $2', [
      set.id,
      w.svc.id,
    ]);
    const error = await rejection(
      w.ingestion.measurements.upsertByName(w.people.member, w.svc.id, [
        { kpi: w.ind.downloads.name, value: 1, date: '2026-01' }, // fine
        { kpi: 'No such indicator', value: 1, date: '2026-01' }, // unknown
        { kpi: twin1.name.toUpperCase(), value: 1, date: '2026-01' }, // ambiguous
        { kpi: w.ind.outside.name, value: 1, date: '2026-01' }, // real, not the service's
        { kpi: w.ind.downloads.name, value: 'many', date: '2026-02' }, // bad value
        { kpi: w.ind.downloads.name, value: 1, date: '2026-13' }, // bad month
        { kpi: w.ind.downloads.name, value: 1, date: '2999-01' }, // the future
      ]),
    );
    expect(error).toBeInstanceOf(Invalid);
    expect(error.status).toBe(422);
    expect(problems(error)).toEqual([
      'body:[1].kpi',
      'body:[2].kpi',
      'body:[3].kpi',
      'body:[4].value',
      'body:[5].date',
      'body:[6].date',
    ]);
    expect(await count(w.pool, 'kpii_measurement')).toBe(0);
    expect(await payloads(w.pool, EVENT)).toEqual([]);
    // no message repeats what was sent
    for (const e of error.errors ?? []) {
      expect(e.message).not.toContain('No such indicator');
      expect(e.message).not.toContain('many');
    }
  });

  it('refuses the same indicator and month twice, by name and by id, naming the earlier item', async () => {
    const w = await world();
    const error = await rejection(
      w.ingestion.measurements.upsertByName(w.people.member, w.svc.id, [
        { kpi: w.ind.downloads.name, value: 1, date: '2026-01' },
        { kpi: w.ind.downloads.id, value: 2, date: '2026-01-20' },
      ]),
    );
    expect(problems(error)).toEqual(['body:[1].date']);
    expect(error.errors![0]!.message).toContain('[0]');
    expect(await count(w.pool, 'kpii_measurement')).toBe(0);
  });

  it('names an item that is not an object, an unknown field and a missing value', async () => {
    const w = await world();
    const error = await rejection(
      w.ingestion.measurements.upsertByName(w.people.member, w.svc.id, [
        'text',
        { kpi: w.ind.downloads.name, value: 1, date: '2026-01', extra: true },
        { kpi: w.ind.downloads.name, date: '2026-02' },
        null,
      ]),
    );
    expect(problems(error)).toEqual(['body:[0]', 'body:[1].extra', 'body:[2].value', 'body:[3]']);
  });

  it('is 422 naming the batch for an empty list, and for more months than one batch holds', async () => {
    const w = await world();
    const none = await rejection(
      w.ingestion.measurements.upsertByName(w.people.member, w.svc.id, []),
    );
    expect(problems(none)).toEqual(['body:']);
    const manyMonths = Array.from({ length: 121 }, (_, n) => {
      const year = 2010 + Math.floor(n / 12);
      return {
        kpi: w.ind.downloads.name,
        value: n,
        date: `${year}-${String((n % 12) + 1).padStart(2, '0')}`,
      };
    });
    const wide = await rejection(
      w.ingestion.measurements.upsertByName(w.people.member, w.svc.id, manyMonths),
    );
    expect(problems(wide)).toEqual(['body:']);
  });

  it('is 422 naming `service` for a service that does not exist, for anyone who may use the route', async () => {
    const w = await world();
    const item = [{ kpi: w.ind.downloads.name, value: 1, date: '2026-01' }];
    for (const who of [w.people.admin, w.people.member, w.people.plain]) {
      for (const service of [
        'no-such-service',
        '0198f3a8-5b21-7d40-9c1e-2a7f6b3d9e10',
        '',
        '   ',
      ]) {
        const error = await rejection(w.ingestion.measurements.upsertByName(who, service, item));
        expect(error.status).toBe(422);
        expect(problems(error)).toEqual(['query:service']);
      }
    }
  });
});

describe('upsertByName: who may use it', () => {
  it('turns away an anonymous caller (401) and a person without the plain write permission or who may not submit for the service (403) [ASVS-8.2.1] [ASVS-8.3.1]', async () => {
    const w = await world();
    const item = [{ kpi: w.ind.downloads.name, value: 1, date: '2026-01' }];
    const call = (who: Actor, service = w.svc.id) =>
      w.ingestion.measurements.upsertByName(who, service, item);
    await expect(call(anonymous)).rejects.toBeInstanceOf(Unauthorized);
    // no role at all: not even the plain permission
    await expect(call(await w.actor())).rejects.toBeInstanceOf(Forbidden);
    // holds the plain permission through the role user, but may not submit for this service
    for (const who of ['plain', 'reviewer', 'requested', 'rejected', 'left', 'elsewhere'] as const)
      await expect(call(w.people[who]), who).rejects.toBeInstanceOf(Forbidden);
    expect(await count(w.pool, 'kpii_measurement')).toBe(0);
    // Admin, a manager and a member are let in
    for (const who of ['admin', 'manager', 'member'] as const)
      expect((await call(w.people[who])).rejected, who).toBe(0);
    expect(await count(w.pool, 'kpii_measurement')).toBe(1);
  });

  it('needs the scope of the route and an owner who may submit: a token with only one of the two is refused [ASVS-8.2.1] [ASVS-8.3.1]', async () => {
    const w = await world();
    const item = [{ kpi: w.ind.downloads.name, value: 1, date: '2026-01' }];
    const call = (who: Actor) => w.ingestion.measurements.upsertByName(who, w.svc.id, item);
    // the owner is a member: the scopes decide
    await expect(call(token(w.people.member, []))).rejects.toBeInstanceOf(Forbidden);
    await expect(call(token(w.people.member, [PERMISSION_V1_WRITE]))).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(call(token(w.people.member, [PERMISSION_SUBMIT]))).rejects.toBeInstanceOf(
      Forbidden,
    );
    // both scopes and an owner who may submit: through, with no scope of kpi.framework
    expect(
      (await call(token(w.people.member, [PERMISSION_V1_WRITE, PERMISSION_SUBMIT]))).inserted,
    ).toBe(1);
    // both scopes, an owner who may not submit for this service: refused
    await expect(
      call(token(w.people.elsewhere, [PERMISSION_V1_WRITE, PERMISSION_SUBMIT])),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      call(token(w.people.plain, [PERMISSION_V1_WRITE, PERMISSION_SUBMIT])),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it('refuses a member of another provider on this service and lets them write to their own [ASVS-8.2.1]', async () => {
    const w = await world();
    const item = [{ kpi: w.ind.downloads.name, value: 1, date: '2026-01' }];
    await expect(
      w.ingestion.measurements.upsertByName(w.people.elsewhere, w.svc.slug, item),
    ).rejects.toBeInstanceOf(Forbidden);
    // their own service has no such KPI: refused on what is asked, not on the right
    const own = await rejection(
      w.ingestion.measurements.upsertByName(w.people.elsewhere, w.elsewhereSvc.id, item),
    );
    expect(problems(own)).toEqual(['body:[0].kpi']);
  });

  it('refuses a member who left at the next call', async () => {
    const w = await world();
    const item = [{ kpi: w.ind.downloads.name, value: 1, date: '2026-01' }];
    expect(
      (await w.ingestion.measurements.upsertByName(w.people.member, w.svc.id, item)).inserted,
    ).toBe(1);
    await w.pool.query(
      "update org_membership set state = 'left' where organisation_id = $1 and user_id = $2",
      [w.provider.id, w.people.member.userId],
    );
    await expect(
      w.ingestion.measurements.upsertByName(w.people.member, w.svc.id, item),
    ).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('upsertByName is all or nothing', () => {
  it('leaves no row and no event when the event cannot be stored', async () => {
    const w = await world();
    const undo = await breakOutbox(w.pool);
    try {
      await expect(
        w.ingestion.measurements.upsertByName(w.people.member, w.svc.id, [
          { kpi: w.ind.downloads.name, value: 1, date: '2026-01' },
          { kpi: w.ind.share.name, value: 2, date: '2026-01' },
        ]),
      ).rejects.toThrow();
    } finally {
      await undo();
    }
    expect(await count(w.pool, 'kpii_measurement')).toBe(0);
  });
});
