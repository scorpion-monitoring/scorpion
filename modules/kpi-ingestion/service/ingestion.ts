// Preview, dry run and commit of a file or a form (M10 sprint 3, plan §7 items 5 to 9), the run history and the import templates.
//
// One trust path: the client sends the bytes (or the form's values) and never parsed rows. `preview`, a dry run and a commit all
// parse the same bytes again with the same adapter, so what the page showed is what is checked, and `upsertBatch` is the only code
// that writes a measurement. A commit is refused whole when anything is rejected; the refusal is recorded as a run with its counts
// and its problems (at most 100 of `{ row, column, code }`) and nothing else. A file is parsed in memory and never stored: a run
// keeps a sanitised, bounded file name and counts, never a cell.
//
// Who may: `kpi.ingestion.measurement.submit` on the service, checked here for the preview, the run, the history and the template
// (the routes name only the plain permission; ADR-0034).
import { Invalid, NotFound, type Actor, type FieldProblem } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import { ids, type Db, type ModuleContext } from '@scorpion/kernel';
import type { KpiFrameworkPublic } from '@scorpion/kpi-framework/public';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { desc, eq } from 'drizzle-orm';
import { ingestionRun } from '../db/schema.ts';
import {
  chooseFileAdapter,
  type AdapterContext,
  type AdapterEntry,
  type AdapterInput,
  type AdapterOutput,
} from './adapters.ts';
import { escapeCell } from './escape.ts';
import type { MeasurementsService, Verdict } from './measurements.ts';
import { PERMISSION_MEASUREMENT_READ, PERMISSION_SUBMIT, RESOURCE_SERVICE } from './permissions.ts';
import { MANDATORY_NECESSITY } from './reads.ts';
import {
  PROBLEM_MESSAGES,
  uniqueProblems,
  type ProblemCode,
  type TableProblem,
  type TargetIndicator,
} from './table.ts';

/** The most bytes of a file (the route's body limit is a little more, for the multipart envelope). */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** The most values a form carries. */
export const MAX_FORM_VALUES = 500;
/** The longest stored file name. */
export const MAX_FILE_NAME = 120;
/** How many runs the history lists. */
export const RUN_LIST_LIMIT = 50;
/** How many services the picker lists at most (the person narrows it with a search). */
export const PICKER_LIMIT = 50;
/** The most problems a run keeps and an answer lists. */
export const MAX_RUN_PROBLEMS = 100;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IngestInput {
  serviceId: string;
  /** The adapter the person chose; for a file the content decides when it does not recognise the file. Default: by content (a file) or `form`. */
  adapter?: string;
  /** A file: its name (any; it is sanitised) and bytes. Exactly one of `file` and `form`. */
  file?: { name?: string | null; bytes: Uint8Array };
  form?: { period: string; values: Record<string, string> };
  /** The column mapping the person chose, keyed by the 0-based column index; omitted means "propose one". */
  mapping?: Record<string, unknown>;
  /** The sheet of a workbook, by name; the first when omitted. */
  sheet?: string;
}

export interface PreviewResult {
  adapter: string;
  header: string[];
  rows: string[][];
  rowNumbers: number[];
  totalRows: number;
  mapping: Record<string, string>;
  proposed: boolean;
  missing: string[];
  problems: TableProblem[];
}

/** What one value of the file would do (or did). */
export interface CellVerdict {
  /** The row of the file (1-based); 1 for a form. */
  row: number;
  /** The column of the value (1-based); for a form the position of the indicator. */
  column: number;
  indicator: string;
  verdict: Verdict;
}

export interface RunResult {
  /** `preview` for a dry run, `committed`, or `rejected` (nothing was written). */
  status: 'preview' | 'committed' | 'rejected';
  /** The recorded run; `null` for a dry run, and for a request that was refused before it was a run (a 422). */
  runId: string | null;
  adapter: string;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
  rows: CellVerdict[];
  problems: TableProblem[];
}

export interface RunRecord {
  id: string;
  serviceId: string;
  adapter: string;
  actorId: string | null;
  fileName: string | null;
  status: 'committed' | 'rejected';
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
  problems: TableProblem[];
  startedAt: Date;
  finishedAt: Date | null;
}

export interface TemplateFile {
  /** From the service's abbreviation, never from free text. */
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface AdapterInfo {
  id: string;
  labels: { en: string; de?: string | undefined };
  input: 'file' | 'values';
  extensions: string[];
  mediaTypes: string[];
  /** The extension of the import template, when the adapter has one. */
  template: string | null;
}

/** A service the person may submit for, as the picker shows it. */
export interface SubmittableService {
  id: string;
  /** The abbreviation (the current slug). */
  slug: string;
  name: string;
}

export interface IngestionService {
  /**
   * The services the person may submit for, by name or abbreviation, at most `PICKER_LIMIT` (name, then id). An administrator
   * gets every service of the search, an approved member of a provider the services of that provider; every row is checked with the
   * scoped `kpi.ingestion.measurement.submit`, so the list can only be shorter than the rule allows, never longer.
   */
  submittableServices(
    actor: Actor,
    query: { q?: string | undefined },
  ): Promise<SubmittableService[]>;
  /** The adapters of the registry (no permission needed: they say nothing about any service). */
  adapters(): AdapterInfo[];
  /** The header, the first rows, the mapping (given or proposed) and the problems. Writes nothing. */
  preview(actor: Actor, input: IngestInput): Promise<PreviewResult>;
  /**
   * Parses again from the same bytes and runs `upsertBatch`: with `dryRun` it answers the verdict of each value and writes
   * nothing (nothing is stored); without, it writes and records the run, in one transaction, or refuses the whole file when
   * anything is rejected and records that.
   */
  run(actor: Actor, input: IngestInput & { dryRun: boolean }): Promise<RunResult>;
  /** The last 50 runs of a service, newest first. */
  listRuns(actor: Actor, serviceId: string): Promise<RunRecord[]>;
  getRun(actor: Actor, runId: string): Promise<RunRecord>;
  /** The import template of a service in the format of an adapter that has one (`csv`, `xlsx`). */
  template(actor: Actor, serviceId: string, format: string): Promise<TemplateFile>;
}

export interface IngestionDeps {
  authz: Pick<AuthzService, 'require' | 'can'>;
  services: Pick<ServicesPublic, 'existsAsSystem' | 'findByIdsAsSystem' | 'listForPickerAsSystem'>;
  kpi: Pick<KpiFrameworkPublic, 'effectiveIndicatorsAsSystem'>;
  measurements: Pick<MeasurementsService, 'upsertBatch'>;
  adapters: ReadonlyMap<string, AdapterEntry>;
  clock: () => Date;
}

const invalid = (path: string, message: string, where = 'body') =>
  new Invalid('The request is not valid.', [{ in: where, path, message }]);

/**
 * A file name that is safe to store and show: no path, no control or markup characters, at most 120 characters, the extension kept.
 * `null` when nothing is left.
 */
export function sanitiseFileName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} ._()+-]/gu, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[.\s]+/, '')
    .trim();
  if (cleaned === '') return null;
  if ([...cleaned].length <= MAX_FILE_NAME) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 && cleaned.length - dot <= 9 ? cleaned.slice(dot) : '';
  return (
    [...cleaned.slice(0, dot > 0 ? dot : cleaned.length)]
      .slice(0, MAX_FILE_NAME - extension.length)
      .join('') + extension
  );
}

/** The code of a problem `upsertBatch` found in row `index` of the batch, from the field it names. */
function codeOf(problem: FieldProblem): ProblemCode {
  if (problem.path.endsWith('.indicator')) return 'indicator-invalid';
  if (problem.path.endsWith('.period'))
    return problem.message.startsWith('repeats') ? 'duplicate-row' : 'period-invalid';
  return 'value-invalid';
}

const ROW_CODES = new Set<ProblemCode>([
  'period-missing',
  'required-value',
  'cell-type',
  'field-too-long',
  'quote-in-field',
  'text-after-quote',
  'unterminated-quote',
]);

/** The sentences of a list of problems, for a 422 (the page of sprint 4 has its own words). */
export function describeProblems(problems: readonly TableProblem[]): FieldProblem[] {
  return problems.map((problem) => ({
    in: 'body',
    path: problem.row === 0 ? 'file' : `rows[${problem.row}].columns[${problem.column}]`,
    message: PROBLEM_MESSAGES[problem.code],
  }));
}

export function createIngestionService(ctx: ModuleContext, deps: IngestionDeps): IngestionService {
  const db: Db = ctx.db;
  const actorId = (actor: Actor): string | null => (actor.kind === 'user' ? actor.userId : null);

  /** The scoped check, then the service, then its effective KPI set as the adapters need it. */
  async function prepare(actor: Actor, serviceId: string): Promise<AdapterContext> {
    await deps.authz.require(actor, PERMISSION_SUBMIT, { type: RESOURCE_SERVICE, id: serviceId });
    if (typeof serviceId !== 'string' || !uuidPattern.test(serviceId))
      throw invalid('serviceId', 'must be the id of a service');
    if (!(await deps.services.existsAsSystem(serviceId)))
      throw new NotFound('There is no such service.');
    const rows = await deps.kpi.effectiveIndicatorsAsSystem(serviceId);
    if (rows.length === 0)
      throw invalid(
        'serviceId',
        'has no KPI set: choose KPIs for the service before reporting values',
      );
    const indicators: TargetIndicator[] = rows.map((row) => ({
      indicatorId: row.indicatorId,
      name: row.name,
      mandatory: row.necessity === MANDATORY_NECESSITY,
      valueType: row.valueType,
      unit: row.unit,
    }));
    return { indicators, clock: deps.clock };
  }

  /** The adapter for a request and what to give it; a 422 for a request that is wrong as a whole. */
  function choose(input: IngestInput): {
    adapter: AdapterEntry | undefined;
    fileName: string | null;
    adapterInput: AdapterInput;
  } {
    const hasFile = input.file !== undefined;
    const hasForm = input.form !== undefined;
    if (hasFile === hasForm) throw invalid('', 'send exactly one of a file and a form');
    if (input.adapter !== undefined && !deps.adapters.has(input.adapter))
      throw invalid('adapter', 'is not an adapter of this instance');
    if (input.mapping !== undefined && Object.keys(input.mapping).length > 200)
      throw invalid('mapping', 'names too many columns');
    const requested = input.adapter === undefined ? undefined : deps.adapters.get(input.adapter);

    if (input.form) {
      const adapter = requested ?? deps.adapters.get('form');
      if (!adapter || adapter.input !== 'values')
        throw invalid('adapter', 'does not take the values of a form');
      const entries = Object.entries(input.form.values ?? {});
      if (entries.length > MAX_FORM_VALUES)
        throw invalid('form.values', `holds more than ${MAX_FORM_VALUES} values`);
      for (const [key, value] of entries)
        if (typeof value !== 'string' || value.length > 4000)
          throw invalid(
            `form.values.${key.slice(0, 40)}`,
            'must be text of at most 4000 characters',
          );
      return { adapter, fileName: null, adapterInput: { form: input.form } };
    }

    const file = input.file!;
    if (!(file.bytes instanceof Uint8Array)) throw invalid('file', 'must be a file');
    if (file.bytes.length === 0) throw invalid('file', 'is empty');
    if (file.bytes.length > MAX_FILE_BYTES) throw invalid('file', 'is larger than 2 MiB');
    if (requested && requested.input !== 'file') throw invalid('adapter', 'does not read files');
    const fileName = sanitiseFileName(file.name);
    return {
      adapter: chooseFileAdapter(deps.adapters, input.adapter, file.bytes),
      fileName,
      adapterInput: {
        bytes: file.bytes,
        fileName,
        ...(input.mapping ? { mapping: input.mapping } : {}),
        ...(input.sheet !== undefined ? { sheet: input.sheet.slice(0, 200) } : {}),
      },
    };
  }

  const refused = (): AdapterOutput => ({
    header: [],
    preview: { rows: [], rowNumbers: [] },
    totalRows: 0,
    targets: [],
    mapping: {},
    proposed: true,
    missing: [],
    rows: [],
    problems: [{ row: 0, column: 0, code: 'format' }],
  });

  async function parse(actor: Actor, input: IngestInput) {
    const context = await prepare(actor, input.serviceId);
    const chosen = choose(input);
    const output = chosen.adapter
      ? await chosen.adapter.parse(chosen.adapterInput, context)
      : refused();
    return { ...chosen, output, context };
  }

  async function record(
    actor: Actor,
    serviceId: string,
    adapter: string,
    fileName: string | null,
    problems: readonly TableProblem[],
    rejected: number,
  ): Promise<string> {
    const id = ids.uuidv7();
    const now = deps.clock();
    await db.insert(ingestionRun).values({
      id,
      serviceId,
      adapter: adapter.slice(0, 64),
      actorId: actorId(actor),
      fileName,
      status: 'rejected',
      rejected,
      problems: problems.slice(0, MAX_RUN_PROBLEMS),
      startedAt: now,
      finishedAt: now,
    });
    return id;
  }

  const toRecord = (row: typeof ingestionRun.$inferSelect): RunRecord => ({
    id: row.id,
    serviceId: row.serviceId,
    adapter: row.adapter,
    actorId: row.actorId,
    fileName: row.fileName,
    status: row.status as RunRecord['status'],
    inserted: row.inserted,
    updated: row.updated,
    unchanged: row.unchanged,
    rejected: row.rejected,
    problems: row.problems as TableProblem[],
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  });

  return {
    adapters() {
      return [...deps.adapters.values()].map((entry) => ({
        id: entry.id,
        labels: entry.labels,
        input: entry.input,
        extensions: entry.accepts.extensions,
        mediaTypes: entry.accepts.mediaTypes,
        template: entry.template?.extension ?? null,
      }));
    },

    async preview(actor, input) {
      const { adapter, output } = await parse(actor, input);
      return {
        adapter: adapter?.id ?? 'unknown',
        header: output.header,
        rows: output.preview.rows,
        rowNumbers: output.preview.rowNumbers,
        totalRows: output.totalRows,
        mapping: output.mapping,
        proposed: output.proposed,
        missing: output.missing,
        problems: uniqueProblems(output.problems, MAX_RUN_PROBLEMS),
      };
    },

    async run(actor, input) {
      const { adapter, fileName, output } = await parse(actor, input);
      const adapterId = adapter?.id ?? input.adapter ?? 'unknown';
      const batch = output.rows.map((row) => ({
        indicator: row.indicator,
        period: row.period,
        value: row.value,
      }));
      if (batch.length === 0 && output.problems.length === 0)
        throw invalid(input.form ? 'form' : 'file', 'holds no values to record');

      // The dry run is the check, for a preview and for a commit alike: the same code, the same bytes.
      const checked =
        batch.length === 0
          ? {
              rejected: 0,
              rows: [] as { verdict: Verdict; problems?: FieldProblem[] }[],
              inserted: 0,
              updated: 0,
              unchanged: 0,
            }
          : await deps.measurements.upsertBatch(actor, input.serviceId, batch, {
              source: adapterId,
              dryRun: true,
            });

      const found: TableProblem[] = [...output.problems];
      checked.rows.forEach((result, index) => {
        if (result.verdict !== 'reject') return;
        const origin = output.rows[index]!.origin;
        for (const problem of result.problems ?? [])
          found.push({
            row: origin.row,
            column: problem.path.endsWith('.period') ? origin.periodColumn : origin.column,
            code: codeOf(problem),
          });
      });
      const problems = uniqueProblems(found, MAX_RUN_PROBLEMS);
      const rowsRejected = new Set(
        output.problems
          .filter((problem) => ROW_CODES.has(problem.code) && problem.row >= 1)
          .map((problem) => problem.row),
      ).size;
      const rejected = checked.rejected + rowsRejected;
      const cells: CellVerdict[] = output.rows.map((row, index) => ({
        row: row.origin.row,
        column: row.origin.column,
        indicator: row.indicator,
        verdict: checked.rows[index]!.verdict,
      }));
      const base = { adapter: adapterId, rows: cells, problems };

      if (input.dryRun)
        return {
          ...base,
          status: 'preview',
          runId: null,
          inserted: checked.inserted,
          updated: checked.updated,
          unchanged: checked.unchanged,
          rejected,
        };

      // Anything wrong refuses the whole file; the refusal is a run with its counts and its problems, and nothing else.
      if (problems.length > 0) {
        const runId = await record(actor, input.serviceId, adapterId, fileName, problems, rejected);
        return {
          ...base,
          status: 'rejected',
          runId,
          inserted: 0,
          updated: 0,
          unchanged: 0,
          rejected,
        };
      }

      // The commit: the run, the values and their event in one transaction. `upsertBatch` runs inside it as a savepoint, so a
      // failure anywhere leaves neither the run nor a value.
      return db.tx(async (tx) => {
        const runId = ids.uuidv7();
        const started = deps.clock();
        await tx.insert(ingestionRun).values({
          id: runId,
          serviceId: input.serviceId,
          adapter: adapterId.slice(0, 64),
          actorId: actorId(actor),
          fileName,
          status: 'committed',
          startedAt: started,
        });
        const written = await deps.measurements.upsertBatch(actor, input.serviceId, batch, {
          source: adapterId,
          runId,
        });
        await tx
          .update(ingestionRun)
          .set({
            inserted: written.inserted,
            updated: written.updated,
            unchanged: written.unchanged,
            finishedAt: deps.clock(),
          })
          .where(eq(ingestionRun.id, runId));
        return {
          ...base,
          status: 'committed' as const,
          runId,
          inserted: written.inserted,
          updated: written.updated,
          unchanged: written.unchanged,
          rejected: 0,
          rows: output.rows.map((row, index) => ({
            row: row.origin.row,
            column: row.origin.column,
            indicator: row.indicator,
            verdict: written.rows[index]!.verdict,
          })),
        };
      });
    },

    async submittableServices(actor, query) {
      await deps.authz.require(actor, PERMISSION_MEASUREMENT_READ);
      if (actor.kind !== 'user') return [];
      // Whoever holds the scoped permission without naming a service holds it everywhere (the role Admin); everybody else only through
      // the provider they belong to. Either way each row is asked again below, so a candidate never becomes an entry by itself.
      const everywhere = await deps.authz.can(actor, PERMISSION_SUBMIT);
      const candidates = await deps.services.listForPickerAsSystem({
        q: query.q,
        ...(everywhere ? {} : { memberOf: actor.userId }),
        limit: PICKER_LIMIT,
      });
      const allowed = await Promise.all(
        candidates.map((row) =>
          deps.authz.can(actor, PERMISSION_SUBMIT, { type: RESOURCE_SERVICE, id: row.id }),
        ),
      );
      return candidates.filter((_, index) => allowed[index]);
    },

    async listRuns(actor, serviceId) {
      await deps.authz.require(actor, PERMISSION_SUBMIT, { type: RESOURCE_SERVICE, id: serviceId });
      if (typeof serviceId !== 'string' || !uuidPattern.test(serviceId))
        throw invalid('serviceId', 'must be the id of a service');
      if (!(await deps.services.existsAsSystem(serviceId)))
        throw new NotFound('There is no such service.');
      const rows = await db
        .select()
        .from(ingestionRun)
        .where(eq(ingestionRun.serviceId, serviceId))
        .orderBy(desc(ingestionRun.startedAt), desc(ingestionRun.id))
        .limit(RUN_LIST_LIMIT);
      return rows.map(toRecord);
    },

    async getRun(actor, runId) {
      if (typeof runId !== 'string' || !uuidPattern.test(runId))
        throw new NotFound('There is no such run.');
      const [row] = await db.select().from(ingestionRun).where(eq(ingestionRun.id, runId));
      if (!row) throw new NotFound('There is no such run.');
      await deps.authz.require(actor, PERMISSION_SUBMIT, {
        type: RESOURCE_SERVICE,
        id: row.serviceId,
      });
      return toRecord(row);
    },

    async template(actor, serviceId, format) {
      const context = await prepare(actor, serviceId);
      const adapter = deps.adapters.get(format);
      if (!adapter?.template)
        throw invalid('format', 'is not a format with an import template', 'query');
      const [service] = await deps.services.findByIdsAsSystem([serviceId]);
      const month = new Date(deps.clock());
      month.setUTCDate(1);
      month.setUTCMonth(month.getUTCMonth() - 1);
      const example = month.toISOString().slice(0, 7);
      const header = [
        'Period',
        ...context.indicators.map(
          (indicator) =>
            `${indicator.name}${indicator.unit ? ` (${indicator.unit})` : ''}${indicator.mandatory ? ' *' : ''}`,
        ),
      ];
      // Every cell is escaped: names are administrators' text, and a cell that starts with `=`, `+`, `-`, `@`, a tab or a CR is a formula
      // to a spreadsheet. The example row holds the period and no values, so it re-uploads as "nothing to record".
      const rows = [header, [example, ...context.indicators.map(() => '')]].map((row) =>
        row.map(escapeCell),
      );
      const stem =
        (service?.slug ?? 'service')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60) || 'service';
      return {
        fileName: `${stem}-import-template.${adapter.template.extension}`,
        contentType: adapter.template.contentType,
        bytes: await adapter.template.write(rows),
      };
    },
  };
}
