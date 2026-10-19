// The measurements of a service and the one way to write them (ADR-0041 Decision 1, defect 6). `upsertBatch` is called by
// the form, the CSV and XLSX adapters, the internal routes, `POST /api/v1/measurements` and the migration tool; nothing
// else writes `kpii_measurement` (a walker in `measurement-writers.test.ts` checks it). A batch is all or nothing: one bad
// row refuses the whole batch with one 422 that names every bad path, and a good batch is one statement per chunk
// (`insert … on conflict (service, indicator, period) do update … where the value differs`), so the same month twice is an
// update and never a second row.
import { Conflict, Invalid, NotFound, type Actor, type FieldProblem } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import { ids, type Db, type ModuleContext } from '@scorpion/kernel';
import type { KpiFrameworkPublic } from '@scorpion/kpi-framework/public';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { and, inArray, eq, sql } from 'drizzle-orm';
import { measurement } from '../db/schema.ts';
import { resolveIndicatorRef, type IndicatorChoice, type IndicatorRefResult } from './names.ts';
import { normalisePeriod } from './period.ts';
import { PERMISSION_SUBMIT, PERMISSION_V1_WRITE, RESOURCE_SERVICE } from './permissions.ts';
import { resolveServiceRef, type ServiceLookup } from './service-ref.ts';
import { sameColumns, toColumns, type ValueColumns } from './values.ts';

/** The most rows one batch holds (the size of an upload: the plan's limit of 5 000 data rows). */
export const MAX_BATCH_ROWS = 5000;
/** The most distinct months one batch covers: the event names them, and its schema holds 120. */
export const MAX_BATCH_MONTHS = 120;
/** The most problems one 422 lists. */
export const MAX_PROBLEMS = 100;
/** Rows per insert statement (a statement takes at most 65 535 parameters; this uses 9 per row). */
const CHUNK = 1000;

/** One value to record: the **id** of an indicator in the service's effective KPI set, a period, and a value. */
export interface MeasurementInput {
  indicator: string;
  /** `YYYY-MM` or `YYYY-MM-DD` (any day of the month); stored as the last day of that month. */
  period: string;
  /** What the indicator's value type accepts: a number or text; stored in its canonical form. */
  value: unknown;
}

export interface UpsertOptions {
  /** The adapter id (`form`, `csv`, `xlsx`) or `api`; lower-case letters, digits and `-`, at most 64. */
  source: string;
  /** The run this batch belongs to (sprint 3); the run must exist. */
  runId?: string | null;
  /** Check everything and say what would happen; write nothing and emit nothing. A bad row is a `reject` verdict, not a 422. */
  dryRun?: boolean;
}

export type Verdict = 'insert' | 'update' | 'unchanged' | 'reject';

export interface RowResult {
  /** The position of the row in the batch, 0-based. */
  index: number;
  verdict: Verdict;
  /** Why a row is rejected (a dry run only; a real run answers 422 with them). */
  problems?: FieldProblem[];
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
  rows: RowResult[];
}

export interface MeasurementsService {
  /**
   * Records the values for one service in one transaction. Needs `kpi.ingestion.measurement.submit` on the service
   * (Admin, or an approved member of its provider); the order of the answers is 401, 403, 404, 422. A row names an
   * indicator of the service's effective KPI set **now**, a period (never after the current month) and a value that the
   * indicator's type and bounds accept; the same indicator and month twice in one batch is refused. One event per
   * batch when something changed, naming ids, months and counts and never a value.
   */
  upsertBatch(
    actor: Actor,
    serviceId: string,
    rows: readonly MeasurementInput[],
    options: UpsertOptions,
  ): Promise<UpsertResult>;

  /**
   * `POST /api/v1/measurements` as a service call (M10 sprint 2): the same batch as `upsertBatch` in the legacy shape. `service`
   * is the id or the abbreviation of a service; each item is `{ kpi, value, date }` with `kpi` the indicator's **name without
   * case** or its id (`resolveIndicatorRef`). It needs the plain `kpi.ingestion.v1.write` (the order of the answers is 401, 403
   * for that, 422 for an unknown service) and then `upsertBatch`'s own scoped check on the service, for the actor, so a token
   * of a person who may not submit for that service is 403. Problems are named in the shape of the request:
   * `[3].kpi`, `[3].value`, `[3].date`. The source is `api`.
   */
  upsertByName(
    actor: Actor,
    service: string,
    items: readonly unknown[],
  ): Promise<Omit<UpsertResult, 'rows'>>;
}

export interface MeasurementsDeps {
  authz: Pick<AuthzService, 'require'>;
  services: Pick<ServicesPublic, 'existsAsSystem'> & ServiceLookup;
  kpi: Pick<KpiFrameworkPublic, 'effectiveIndicatorsAsSystem' | 'findValueType'>;
  /** "Now", for the current month. Injected so tests do not depend on the date they run on. */
  clock: () => Date;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sourcePattern = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * How a batch names its parts, so a 422 speaks the language of the request: `upsertBatch` takes `rows[i].indicator`,
 * `.period`, `.value`; the legacy API takes `[i].kpi`, `.value`, `.date`. The checks are the same.
 */
interface Naming {
  /** The path of row `i`: `rows[3]` or `[3]`. */
  row: (index: number) => string;
  indicator: string;
  period: string;
  value: string;
  /** The path of a problem with the batch as a whole (`rows`; the root of the body is ''). */
  whole: string;
  /** What the indicator reference may be: an id only, or a name or an id (the legacy `kpi`). */
  resolve: (choices: readonly IndicatorChoice[], reference: unknown) => IndicatorRefResult;
}

const BY_ID: Naming = {
  row: (index) => `rows[${index}]`,
  indicator: 'indicator',
  period: 'period',
  value: 'value',
  whole: 'rows',
  resolve: (choices, reference) =>
    typeof reference !== 'string' || !uuidPattern.test(reference)
      ? { ok: false, problem: 'must be the id of an indicator' }
      : choices.some((choice) => choice.indicatorId === reference)
        ? { ok: true, indicatorId: reference }
        : { ok: false, problem: 'is not one of the KPIs of this service' },
};

const LEGACY: Naming = {
  row: (index) => `[${index}]`,
  indicator: 'kpi',
  period: 'date',
  value: 'value',
  whole: '',
  resolve: resolveIndicatorRef,
};

const problem = (path: string, message: string): FieldProblem => ({ in: 'body', path, message });
const fail = (problems: readonly FieldProblem[], total = problems.length) =>
  new Invalid(
    total > MAX_PROBLEMS
      ? `The batch is not valid: ${total} problems, the first ${MAX_PROBLEMS} are listed.`
      : 'The batch is not valid.',
    problems.slice(0, MAX_PROBLEMS),
  );

/** A row that passed every check, with what the write needs. */
interface GoodRow {
  index: number;
  indicatorId: string;
  period: string;
  columns: ValueColumns;
}

const keyOf = (indicatorId: string, period: string) => `${indicatorId}|${period}`;

/** The name of the constraint a foreign-key error (23503) is about, looking through wrapped causes. */
function foreignKeyViolation(error: unknown): string | undefined {
  for (let e: unknown = error, depth = 0; e && depth < 4; depth++) {
    const err = e as { code?: string; constraint?: string; cause?: unknown };
    if (err.code === '23503') return err.constraint ?? '';
    e = err.cause;
  }
  return undefined;
}

export function createMeasurementsService(
  ctx: ModuleContext,
  deps: MeasurementsDeps,
): MeasurementsService {
  const db: Db = ctx.db;
  const actorId = (actor: Actor): string | null => (actor.kind === 'user' ? actor.userId : null);

  /** Every row of the batch against the KPIs of the service, its value types and the calendar. */
  async function check(serviceId: string, rows: readonly unknown[], naming: Naming) {
    // The trusted read: the scoped permission was checked above, so the actor needs no plain read permission of kpi.framework
    // (a token would otherwise need its scopes too; ADR-0041 "Amended in sprint 2"). The bounds come with the rows.
    const allowed = new Map(
      (await deps.kpi.effectiveIndicatorsAsSystem(serviceId)).map((row) => [row.indicatorId, row]),
    );
    const choices: IndicatorChoice[] = [...allowed.values()];
    const known = new Set([naming.indicator, naming.period, naming.value]);
    const now = deps.clock();

    const problems: FieldProblem[] = [];
    const results: RowResult[] = [];
    const good: GoodRow[] = [];
    const firstOf = new Map<string, number>();

    rows.forEach((raw, index) => {
      const here: FieldProblem[] = [];
      const at = (field: string) => `${naming.row(index)}.${field}`;
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        here.push(
          problem(
            naming.row(index),
            `must be an object with ${naming.indicator}, ${naming.period} and ${naming.value}`,
          ),
        );
      } else {
        const row = raw as Record<string, unknown>;
        for (const key of Object.keys(row))
          if (!known.has(key))
            here.push(problem(at(key.slice(0, 64)), 'is not a field of a measurement'));

        // The indicator.
        let indicatorId: string | undefined;
        const found = naming.resolve(choices, row[naming.indicator]);
        if (!found.ok) here.push(problem(at(naming.indicator), found.problem));
        else indicatorId = found.indicatorId;

        // The period.
        const period = normalisePeriod(row[naming.period], now);
        if (!period.ok) here.push(problem(at(naming.period), period.problem));

        // The value, by the type and the bounds of its indicator.
        let columns: ValueColumns | undefined;
        const given = row[naming.value];
        if (!(naming.value in row) || given === undefined)
          here.push(problem(at(naming.value), 'is required'));
        else if (indicatorId !== undefined) {
          const indicator = allowed.get(indicatorId)!;
          const type = deps.kpi.findValueType(indicator.valueType);
          if (!type)
            here.push(
              problem(
                at(naming.value),
                'cannot be checked: the value type of this indicator is not available',
              ),
            );
          else {
            const parsed = type.schema({ min: indicator.min, max: indicator.max }).safeParse(given);
            if (!parsed.success)
              here.push(
                problem(
                  at(naming.value),
                  parsed.error.issues[0]?.message ?? 'is not a valid value',
                ),
              );
            else {
              const mapped = toColumns(type.numeric, parsed.data);
              if (mapped.ok) columns = mapped.value;
              else here.push(problem(at(naming.value), mapped.problem));
            }
          }
        }

        // The same indicator and month twice: refused, never "the last one wins".
        if (indicatorId !== undefined && period.ok && here.length === 0 && columns !== undefined) {
          const key = keyOf(indicatorId, period.value);
          const earlier = firstOf.get(key);
          if (earlier !== undefined)
            here.push(
              problem(
                at(naming.period),
                `repeats ${naming.row(earlier)}: the same indicator and month twice in one batch`,
              ),
            );
          else {
            firstOf.set(key, index);
            good.push({ index, indicatorId, period: period.value, columns });
          }
        }
      }
      problems.push(...here);
      results.push(
        here.length === 0
          ? { index, verdict: 'unchanged' } // replaced by the real verdict below
          : { index, verdict: 'reject', problems: here },
      );
    });

    const months = new Set(good.map((row) => row.period));
    return { problems, results, good, months };
  }

  /** What each good row would do, from the rows stored now (a dry run). */
  async function classify(
    serviceId: string,
    good: readonly GoodRow[],
  ): Promise<Map<number, Verdict>> {
    const verdicts = new Map<number, Verdict>();
    if (good.length === 0) return verdicts;
    const stored = await db
      .select({
        indicatorId: measurement.indicatorId,
        period: measurement.period,
        valueNumeric: measurement.valueNumeric,
        valueText: measurement.valueText,
      })
      .from(measurement)
      .where(
        and(
          eq(measurement.serviceId, serviceId),
          inArray(measurement.indicatorId, [...new Set(good.map((row) => row.indicatorId))]),
          inArray(measurement.period, [...new Set(good.map((row) => row.period))]),
        ),
      );
    const byKey = new Map(stored.map((row) => [keyOf(row.indicatorId, row.period), row]));
    for (const row of good) {
      const existing = byKey.get(keyOf(row.indicatorId, row.period));
      verdicts.set(
        row.index,
        existing === undefined
          ? 'insert'
          : sameColumns(existing, row.columns)
            ? 'unchanged'
            : 'update',
      );
    }
    return verdicts;
  }

  /**
   * The checks that come before anything about the batch: the scoped permission first (an anonymous caller is 401 and anyone who
   * may not submit is 403, whether or not the service exists: the answer must not tell a stranger which ids are services; Admin
   * passes and learns 404 below), then that the service exists.
   */
  async function guard(actor: Actor, serviceId: string): Promise<void> {
    await deps.authz.require(actor, PERMISSION_SUBMIT, { type: RESOURCE_SERVICE, id: serviceId });
    if (!uuidPattern.test(serviceId))
      throw new Invalid('The request is not valid.', [
        problem('service', 'must be the id of a service'),
      ]);
    if (!(await deps.services.existsAsSystem(serviceId)))
      throw new NotFound('There is no such service.');
  }

  /** The batch itself, after `guard`: its shape, every row, then the write (or the verdicts of a dry run). */
  async function run(
    actor: Actor,
    serviceId: string,
    rows: readonly unknown[],
    options: UpsertOptions,
    naming: Naming,
  ): Promise<UpsertResult> {
    const parameter: FieldProblem[] = [];
    if (typeof options?.source !== 'string' || !sourcePattern.test(options.source))
      parameter.push(
        problem('source', 'must be an adapter id of lower-case letters, digits and "-"'),
      );
    if (
      options?.runId != null &&
      (typeof options.runId !== 'string' || !uuidPattern.test(options.runId))
    )
      parameter.push(problem('runId', 'must be the id of a run'));
    if (!Array.isArray(rows))
      parameter.push(problem(naming.whole, 'must be a list of measurements'));
    else if (rows.length === 0)
      parameter.push(problem(naming.whole, 'must hold at least one measurement'));
    else if (rows.length > MAX_BATCH_ROWS)
      parameter.push(problem(naming.whole, `must hold at most ${MAX_BATCH_ROWS} measurements`));
    if (parameter.length > 0) throw fail(parameter);

    const { problems, results, good, months } = await check(serviceId, rows, naming);
    if (months.size > MAX_BATCH_MONTHS)
      throw fail([
        problem(naming.whole, `must cover at most ${MAX_BATCH_MONTHS} months; split the batch`),
      ]);

    const dryRun = options.dryRun === true;
    if (problems.length > 0 && !dryRun) throw fail(problems);

    if (dryRun) {
      const verdicts = await classify(serviceId, good);
      for (const result of results)
        if (result.verdict !== 'reject') result.verdict = verdicts.get(result.index)!;
      return tally(results);
    }

    // Rows go in one order whatever the batch's, so two batches for the same service never wait for each other in a circle.
    const ordered = [...good].sort(
      (a, b) => a.indicatorId.localeCompare(b.indicatorId) || a.period.localeCompare(b.period),
    );
    const by = actorId(actor);
    try {
      return await db.tx(async (tx) => {
        const written = new Map<string, boolean>();
        for (let from = 0; from < ordered.length; from += CHUNK) {
          const chunk = ordered.slice(from, from + CHUNK);
          const returned = await tx
            .insert(measurement)
            .values(
              chunk.map((row) => ({
                id: ids.uuidv7(),
                serviceId,
                indicatorId: row.indicatorId,
                period: row.period,
                valueNumeric: row.columns.valueNumeric,
                valueText: row.columns.valueText,
                source: options.source,
                runId: options.runId ?? null,
                createdBy: by,
                updatedBy: by,
              })),
            )
            .onConflictDoUpdate({
              target: [measurement.serviceId, measurement.indicatorId, measurement.period],
              set: {
                valueNumeric: sql`excluded.value_numeric`,
                valueText: sql`excluded.value_text`,
                source: sql`excluded.source`,
                runId: sql`excluded.run_id`,
                updatedAt: sql`now()`,
                updatedBy: sql`excluded.updated_by`,
              },
              // The same value again changes nothing: no write, no new `updated_at`, and the row is not returned.
              setWhere: sql`(${measurement.valueNumeric}, ${measurement.valueText}) is distinct from (excluded.value_numeric, excluded.value_text)`,
            })
            .returning({
              indicatorId: measurement.indicatorId,
              period: measurement.period,
              // `xmax` is 0 on a row this statement inserted and not on one it updated.
              inserted: sql<boolean>`(xmax = 0)`,
            });
          for (const row of returned) written.set(keyOf(row.indicatorId, row.period), row.inserted);
        }
        for (const row of good) {
          const state = written.get(keyOf(row.indicatorId, row.period));
          results[row.index]!.verdict =
            state === undefined ? 'unchanged' : state ? 'insert' : 'update';
        }
        const summary = tally(results);
        if (summary.inserted + summary.updated > 0) {
          const changed = new Set(
            good
              .filter((row) => results[row.index]!.verdict !== 'unchanged')
              .map((row) => row.period),
          );
          await ctx.events.emit('measurement.recorded@1', {
            serviceId,
            runId: options.runId ?? null,
            periods: [...changed].sort(),
            inserted: summary.inserted,
            updated: summary.updated,
            actorId: by,
          });
        }
        return summary;
      });
    } catch (error) {
      const key = foreignKeyViolation(error);
      if (key === undefined) throw error;
      // The run does not exist; or an indicator was deleted after its KPI set was read (the key `restrict`s the other way).
      if (key.includes('run_id'))
        throw new Invalid('The request is not valid.', [
          problem('runId', 'is not a run that exists'),
        ]);
      throw new Conflict('An indicator was deleted meanwhile; nothing was recorded, try again.');
    }
  }

  return {
    async upsertBatch(actor, serviceId, rows, options) {
      await guard(actor, serviceId);
      return run(actor, serviceId, rows, options, BY_ID);
    },

    async upsertByName(actor, service, items) {
      // The plain scope of the route first, then the service: an abbreviation cannot be authorised before it is a service. A
      // service is readable by every signed-in person (ADR-0036), so naming an unknown one discloses nothing.
      await deps.authz.require(actor, PERMISSION_V1_WRITE);
      const found = await resolveServiceRef(
        deps.services,
        typeof service === 'string' ? service : '',
      );
      if (!found)
        throw new Invalid('The request is not valid.', [
          {
            in: 'query',
            path: 'service',
            message: 'must be the id or the abbreviation of a service',
          },
        ]);
      await guard(actor, found.id);
      const { inserted, updated, unchanged, rejected } = await run(
        actor,
        found.id,
        items,
        { source: 'api' },
        LEGACY,
      );
      return { inserted, updated, unchanged, rejected };
    },
  };
}

function tally(results: readonly RowResult[]): UpsertResult {
  const count = (verdict: Verdict) => results.filter((row) => row.verdict === verdict).length;
  return {
    inserted: count('insert'),
    updated: count('update'),
    unchanged: count('unchanged'),
    rejected: count('reject'),
    rows: [...results],
  };
}
