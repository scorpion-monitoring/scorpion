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
import { normalisePeriod } from './period.ts';
import { PERMISSION_SUBMIT, RESOURCE_SERVICE } from './permissions.ts';
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
}

export interface MeasurementsDeps {
  authz: Pick<AuthzService, 'require'>;
  services: Pick<ServicesPublic, 'existsAsSystem'>;
  kpi: Pick<KpiFrameworkPublic, 'serviceKpis' | 'indicators' | 'findValueType'>;
  /** "Now", for the current month. Injected so tests do not depend on the date they run on. */
  clock: () => Date;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sourcePattern = /^[a-z][a-z0-9-]{0,63}$/;
const KNOWN_KEYS = new Set(['indicator', 'period', 'value']);

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
  async function check(actor: Actor, serviceId: string, rows: readonly unknown[]) {
    const view = await deps.kpi.serviceKpis.get(actor, serviceId);
    const allowed = new Map(view.rows.map((row) => [row.indicatorId, row]));
    const now = deps.clock();

    // The bounds of an indicator are not part of the effective set: read each indicator the batch uses, once.
    const used = new Set<string>();
    for (const row of rows) {
      const id = (row as { indicator?: unknown } | null)?.indicator;
      if (typeof id === 'string' && allowed.has(id)) used.add(id);
    }
    const bounds = new Map<string, { min: number | null; max: number | null }>();
    await Promise.all(
      [...used].map(async (id) => {
        try {
          const found = await deps.kpi.indicators.get(actor, id);
          bounds.set(id, { min: found.min, max: found.max });
        } catch (error) {
          // Deleted since the set was read: the row reports it below, nothing is thrown from here.
          if (!(error instanceof NotFound)) throw error;
        }
      }),
    );

    const problems: FieldProblem[] = [];
    const results: RowResult[] = [];
    const good: GoodRow[] = [];
    const firstOf = new Map<string, number>();

    rows.forEach((raw, index) => {
      const here: FieldProblem[] = [];
      const at = (field: string) => `rows[${index}].${field}`;
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        here.push(problem(`rows[${index}]`, 'must be an object with indicator, period and value'));
      } else {
        const row = raw as Record<string, unknown>;
        for (const key of Object.keys(row))
          if (!KNOWN_KEYS.has(key))
            here.push(problem(at(key.slice(0, 64)), 'is not a field of a measurement'));

        // The indicator.
        let indicatorId: string | undefined;
        if (typeof row.indicator !== 'string' || !uuidPattern.test(row.indicator))
          here.push(problem(at('indicator'), 'must be the id of an indicator'));
        else if (!allowed.has(row.indicator) || !bounds.has(row.indicator))
          here.push(problem(at('indicator'), 'is not one of the KPIs of this service'));
        else indicatorId = row.indicator;

        // The period.
        const period = normalisePeriod(row.period, now);
        if (!period.ok) here.push(problem(at('period'), period.problem));

        // The value, by the type and the bounds of its indicator.
        let columns: ValueColumns | undefined;
        if (!('value' in row) || row.value === undefined)
          here.push(problem(at('value'), 'is required'));
        else if (indicatorId !== undefined) {
          const indicator = allowed.get(indicatorId)!;
          const type = deps.kpi.findValueType(indicator.valueType);
          if (!type)
            here.push(
              problem(
                at('value'),
                'cannot be checked: the value type of this indicator is not available',
              ),
            );
          else {
            const parsed = type.schema(bounds.get(indicatorId)).safeParse(row.value);
            if (!parsed.success)
              here.push(
                problem(at('value'), parsed.error.issues[0]?.message ?? 'is not a valid value'),
              );
            else {
              const mapped = toColumns(type.numeric, parsed.data);
              if (mapped.ok) columns = mapped.value;
              else here.push(problem(at('value'), mapped.problem));
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
                at('period'),
                `repeats rows[${earlier}]: the same indicator and month twice in one batch`,
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

  return {
    async upsertBatch(actor, serviceId, rows, options) {
      // The scoped permission first: an anonymous caller is 401 and anyone who may not submit is 403, whether or not the
      // service exists (the answer must not tell a stranger which ids are services). Admin passes and learns 404 below.
      await deps.authz.require(actor, PERMISSION_SUBMIT, { type: RESOURCE_SERVICE, id: serviceId });
      if (!uuidPattern.test(serviceId))
        throw new Invalid('The request is not valid.', [
          problem('service', 'must be the id of a service'),
        ]);
      if (!(await deps.services.existsAsSystem(serviceId)))
        throw new NotFound('There is no such service.');

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
      if (!Array.isArray(rows)) parameter.push(problem('rows', 'must be a list of measurements'));
      else if (rows.length === 0)
        parameter.push(problem('rows', 'must hold at least one measurement'));
      else if (rows.length > MAX_BATCH_ROWS)
        parameter.push(problem('rows', `must hold at most ${MAX_BATCH_ROWS} measurements`));
      if (parameter.length > 0) throw fail(parameter);

      const { problems, results, good, months } = await check(actor, serviceId, rows);
      if (months.size > MAX_BATCH_MONTHS)
        throw fail([
          problem('rows', `must cover at most ${MAX_BATCH_MONTHS} months; split the batch`),
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
            for (const row of returned)
              written.set(keyOf(row.indicatorId, row.period), row.inserted);
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
