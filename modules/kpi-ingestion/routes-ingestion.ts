// The internal routes of the Data Submission page (M10 sprint 3): preview and run (a file as multipart, a form as JSON), the history of
// runs, the adapters, and the import template. Thin: Zod parses and bounds the input, one service call, the answer is mapped field by
// field. The plain permissions only keep out callers the role `user` does not cover; the service checks the scoped
// `kpi.ingestion.measurement.submit` on the service for every one (ADR-0034), so a person of another provider is 403 here too.
//
// A commit that is refused (anything rejected) is a 422 whose problems name each row and column, and whose message names the run that
// was recorded; a dry run answers 200 with the verdict of each value, also when some are rejected, because that is what it is for.
import {
  createRoute,
  Invalid,
  listEnvelope,
  paginate,
  z,
  type AppEnv,
  type Context,
  type RouteHandler,
} from '@scorpion/contracts';
import type { RouteRegistrar } from '@scorpion/kernel';
import {
  describeProblems,
  MAX_FILE_BYTES,
  MAX_FORM_VALUES,
  PICKER_LIMIT,
  type AdapterInfo,
  type IngestInput,
  type IngestionService,
  type PreviewResult,
  type RunRecord,
  type RunResult,
  type SubmittableService,
  type TemplateFile,
} from './service/ingestion.ts';
import { PROBLEM_MESSAGES } from './service/table.ts';
import { PERMISSION_INGEST, PERMISSION_MEASUREMENT_READ } from './service/permissions.ts';

/** The body limit of preview and run: the file's 2 MiB and the multipart envelope around it. */
export const MAX_UPLOAD_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024;

const problemCodes = Object.keys(PROBLEM_MESSAGES) as [
  keyof typeof PROBLEM_MESSAGES,
  ...(keyof typeof PROBLEM_MESSAGES)[],
];

const problemSchema = z.object({
  row: z.int().describe('The row (or line) of the file, 1-based; 0 for the file as a whole.'),
  column: z.int().describe('The column, 1-based; 0 for the row as a whole.'),
  code: z.enum(problemCodes).describe('A fixed code; no cell content is ever part of a problem.'),
});

const mappingSchema = z
  .record(z.string(), z.string())
  .describe(
    'The target of each mapped column, keyed by the 0-based index of the column: `period` or the id of an indicator of the service. A column that is absent is ignored.',
  );

const verdictSchema = z.enum(['insert', 'update', 'unchanged', 'reject']);

export const previewSchema = z.object({
  adapter: z.string().describe('The adapter that read the file (the content decides).'),
  header: z.array(z.string()).describe('The header row, each cell cut at 64 characters.'),
  rows: z
    .array(z.array(z.string()))
    .describe('The first 20 data rows, each cell cut at 64 characters.'),
  rowNumbers: z.array(z.int()).describe('The row of the file of each preview row.'),
  totalRows: z.int(),
  mapping: mappingSchema,
  proposed: z.boolean().describe('True when the mapping was proposed from the header.'),
  missing: z
    .array(z.string())
    .describe('`period` and the ids of the mandatory indicators that no column maps to.'),
  problems: z.array(problemSchema).max(100),
});

export const runResultSchema = z.object({
  status: z.enum(['preview', 'committed', 'rejected']),
  runId: z.uuid().nullable().describe('The recorded run; null for a dry run.'),
  adapter: z.string(),
  inserted: z.int(),
  updated: z.int(),
  unchanged: z.int(),
  rejected: z.int(),
  rows: z
    .array(
      z.object({
        row: z.int(),
        column: z.int(),
        indicator: z.uuid(),
        verdict: verdictSchema,
      }),
    )
    .describe('What each value of the file does (or did), in file order.'),
  problems: z.array(problemSchema).max(100),
});

export const runRecordSchema = z.object({
  id: z.uuid(),
  serviceId: z.uuid(),
  adapter: z.string(),
  actorId: z.uuid().nullable().describe('The person who ran it.'),
  fileName: z
    .string()
    .nullable()
    .describe('The sanitised name of the file; its content is never kept.'),
  status: z.enum(['committed', 'rejected']),
  inserted: z.int(),
  updated: z.int(),
  unchanged: z.int(),
  rejected: z.int(),
  problems: z.array(problemSchema).max(100),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});

export const adapterSchema = z.object({
  id: z.string(),
  labels: z.object({ en: z.string(), de: z.string().optional() }),
  input: z.enum(['file', 'values']),
  extensions: z.array(z.string()),
  mediaTypes: z.array(z.string()),
  template: z.string().nullable().describe('The extension of the import template, or null.'),
});

const formSchema = z.strictObject({
  period: z.string().min(1).max(32).describe('`YYYY-MM` or `YYYY-MM-DD` (any day of the month).'),
  values: z
    .record(z.string().max(64), z.string().max(4000))
    .refine(
      (values) => Object.keys(values).length <= MAX_FORM_VALUES,
      `at most ${MAX_FORM_VALUES} values`,
    )
    .describe('The value of each indicator by its id; a blank value is no value.'),
});

const common = {
  serviceId: z.uuid().describe('The service the values are for.'),
  adapter: z
    .string()
    .max(32)
    .optional()
    .describe('An adapter id; for a file the content decides when it does not recognise the file.'),
  sheet: z
    .string()
    .max(200)
    .optional()
    .describe('The sheet of a workbook, by name; the first by default.'),
};

/** The body as JSON: the values of a form. */
const jsonBody = z.strictObject({
  ...common,
  form: formSchema,
  mapping: mappingSchema.optional(),
  dryRun: z.boolean().optional(),
});

/** The body as multipart: a file and its parameters as text (the mapping as JSON text). */
const multipartBody = z.object({
  ...common,
  file: z
    .any()
    .openapi({ type: 'string', format: 'binary' })
    .describe('The file: CSV, TSV or XLSX, at most 2 MiB. It is read in memory and never stored.'),
  mapping: z.string().max(20_000).optional().describe('The column mapping as JSON text.'),
  dryRun: z.enum(['true', 'false']).optional(),
});

// `required` stays false on purpose: with it, `@hono/zod-openapi` runs the JSON validator on a multipart request too and refuses it. Without it the
// validator that fits the request's content type runs, and a request with no body is refused by `readInput` below.
const requestBody = (what: string) => ({
  description: what,
  content: {
    'multipart/form-data': { schema: multipartBody },
    'application/json': { schema: jsonBody },
  },
});

export const previewRoute = createRoute({
  method: 'post',
  path: '/kpi/ingestion/preview',
  permission: PERMISSION_INGEST,
  audit: true,
  maxBodyBytes: MAX_UPLOAD_BODY_BYTES,
  summary: 'Read a file and propose how its columns map',
  description:
    'Reads the file (multipart, field `file`) in memory and answers the header, the first 20 rows, the mapping (the one given, or one proposed from the header) and the problems. Nothing is written or stored. Needs the scoped `kpi.ingestion.measurement.submit` on the service.',
  request: { body: requestBody('A file as multipart, or the values of a form as JSON.') },
  responses: {
    200: {
      description: 'What was read.',
      content: { 'application/json': { schema: previewSchema } },
    },
    404: { description: 'No such service.' },
    413: { description: 'The body is larger than 2 MiB (plus the multipart envelope).' },
  },
});

export const runRoute = createRoute({
  method: 'post',
  path: '/kpi/ingestion/runs',
  permission: PERMISSION_INGEST,
  audit: true,
  maxBodyBytes: MAX_UPLOAD_BODY_BYTES,
  summary: 'Check or record the values of a file or a form',
  description:
    'Reads the same bytes again and runs the one write path. With `dryRun: true` it answers the verdict of each value (insert, update, unchanged, reject) and writes nothing. Without, it records the values and the run in one transaction (200), or refuses the whole file when anything is rejected (422, the problems name each row and column, and a run with `rejected` status is recorded). Needs the scoped `kpi.ingestion.measurement.submit` on the service.',
  request: { body: requestBody('A file as multipart, or the values of a form as JSON.') },
  responses: {
    200: {
      description: 'The verdicts of a dry run, or the committed run.',
      content: { 'application/json': { schema: runResultSchema } },
    },
    404: { description: 'No such service.' },
    413: { description: 'The body is larger than 2 MiB (plus the multipart envelope).' },
  },
});

export const listRunsRoute = createRoute({
  method: 'get',
  path: '/kpi/ingestion/runs',
  permission: PERMISSION_MEASUREMENT_READ,
  summary: 'The last runs of a service',
  description:
    'The last 50 runs of a service, newest first, in one page. Needs the scoped `kpi.ingestion.measurement.submit` on the service.',
  request: { query: z.strictObject({ service: z.uuid().describe('The id of the service.') }) },
  responses: {
    200: {
      description: 'The runs.',
      content: { 'application/json': { schema: listEnvelope(runRecordSchema) } },
    },
    404: { description: 'No such service.' },
  },
});

export const getRunRoute = createRoute({
  method: 'get',
  path: '/kpi/ingestion/runs/{id}',
  permission: PERMISSION_MEASUREMENT_READ,
  summary: 'One run',
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: 'The run.', content: { 'application/json': { schema: runRecordSchema } } },
    404: { description: 'No such run.' },
  },
});

export const submittableServicesSchema = z.object({
  id: z.uuid(),
  slug: z.string().describe('The abbreviation of the service.'),
  name: z.string(),
});

export const listSubmittableServicesRoute = createRoute({
  method: 'get',
  path: '/kpi/ingestion/services',
  permission: PERMISSION_MEASUREMENT_READ,
  summary: 'The services the caller may submit values for',
  description:
    'For the picker of the Data Submission page: the services of the search (`q`: name or abbreviation) that the caller may submit for, by name then id, at most 50 in one page. An administrator gets every service of the search, an approved member of a provider the services of that provider; each one is checked with the scoped `kpi.ingestion.measurement.submit`. A caller who may submit for none gets an empty list.',
  request: { query: z.strictObject({ q: z.string().max(100).optional() }) },
  responses: {
    200: {
      description: 'The services.',
      content: { 'application/json': { schema: listEnvelope(submittableServicesSchema) } },
    },
  },
});

export const listAdaptersRoute = createRoute({
  method: 'get',
  path: '/kpi/ingestion/adapters',
  permission: PERMISSION_MEASUREMENT_READ,
  summary: 'The ways to give values',
  description:
    'The entries of the registry `ingestion.adapter`: what the page offers and which files it accepts.',
  responses: {
    200: {
      description: 'The adapters.',
      content: { 'application/json': { schema: listEnvelope(adapterSchema) } },
    },
  },
});

export const templateRoute = createRoute({
  method: 'get',
  path: '/kpi/ingestion/template',
  permission: PERMISSION_MEASUREMENT_READ,
  summary: 'The import template of a service',
  description:
    "A header row (the period, then each indicator of the effective KPI set with its unit and `*` for a mandatory one) and an example row, as CSV (UTF-8 with a byte order mark) or XLSX. Every cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with `'`. Needs the scoped `kpi.ingestion.measurement.submit`; 422 for a service with no KPI set.",
  request: {
    query: z.strictObject({
      service: z.uuid().describe('The id of the service.'),
      format: z.string().min(1).max(32).describe('An adapter with a template: `csv` or `xlsx`.'),
    }),
  },
  responses: {
    200: {
      description: 'The file, as an attachment.',
      content: {
        'application/octet-stream': {
          schema: z.string().openapi({ type: 'string', format: 'binary' }),
        },
      },
    },
    404: { description: 'No such service.' },
  },
});

const iso = (date: Date) => date.toISOString();
const runOut = (run: RunRecord) => ({
  id: run.id,
  serviceId: run.serviceId,
  adapter: run.adapter,
  actorId: run.actorId,
  fileName: run.fileName,
  status: run.status,
  inserted: run.inserted,
  updated: run.updated,
  unchanged: run.unchanged,
  rejected: run.rejected,
  problems: run.problems.map(({ row, column, code }) => ({ row, column, code })),
  startedAt: iso(run.startedAt),
  finishedAt: run.finishedAt ? iso(run.finishedAt) : null,
});
const previewOut = (preview: PreviewResult) => ({
  adapter: preview.adapter,
  header: preview.header,
  rows: preview.rows,
  rowNumbers: preview.rowNumbers,
  totalRows: preview.totalRows,
  mapping: preview.mapping,
  proposed: preview.proposed,
  missing: preview.missing,
  problems: preview.problems,
});
const resultOut = (result: RunResult) => ({
  status: result.status,
  runId: result.runId,
  adapter: result.adapter,
  inserted: result.inserted,
  updated: result.updated,
  unchanged: result.unchanged,
  rejected: result.rejected,
  rows: result.rows,
  problems: result.problems,
});
const submittableOut = (row: SubmittableService) => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
});
const adapterOut = (adapter: AdapterInfo) => ({
  id: adapter.id,
  labels: adapter.labels.de
    ? { en: adapter.labels.en, de: adapter.labels.de }
    : { en: adapter.labels.en },
  input: adapter.input,
  extensions: adapter.extensions,
  mediaTypes: adapter.mediaTypes,
  template: adapter.template,
});

/** What the request carries, as the service takes it. A mapping that is not JSON, or not an object, is a 422. */
async function readInput(c: Context<AppEnv>): Promise<{ input: IngestInput; dryRun: boolean }> {
  const type = c.req.header('content-type') ?? '';
  if (type.toLowerCase().startsWith('multipart/form-data')) {
    const body = (
      c.req as unknown as { valid(target: 'form'): z.infer<typeof multipartBody> }
    ).valid('form');
    if (!(body.file instanceof File))
      throw new Invalid('The request is not valid.', [
        { in: 'body', path: 'file', message: 'must be a file' },
      ]);
    let mapping: Record<string, unknown> | undefined;
    if (body.mapping !== undefined && body.mapping !== '') {
      try {
        const parsed: unknown = JSON.parse(body.mapping);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
          throw new Error();
        mapping = parsed as Record<string, unknown>;
      } catch {
        throw new Invalid('The request is not valid.', [
          { in: 'body', path: 'mapping', message: 'must be a JSON object' },
        ]);
      }
    }
    return {
      input: {
        serviceId: body.serviceId,
        ...(body.adapter !== undefined ? { adapter: body.adapter } : {}),
        ...(body.sheet !== undefined ? { sheet: body.sheet } : {}),
        ...(mapping ? { mapping } : {}),
        file: { name: body.file.name, bytes: new Uint8Array(await body.file.arrayBuffer()) },
      },
      dryRun: body.dryRun === 'true',
    };
  }
  const body = (c.req as unknown as { valid(target: 'json'): z.infer<typeof jsonBody> }).valid(
    'json',
  );
  // `valid('json')` is `{}` when the request had no body at all (the body is optional in the schema, see `requestBody`).
  if ((body.serviceId as string | undefined) === undefined || (body.form as unknown) === undefined)
    throw new Invalid('The request is not valid.', [
      {
        in: 'body',
        path: '',
        message: 'must be a file as multipart or the values of a form as JSON',
      },
    ]);
  return {
    input: {
      serviceId: body.serviceId,
      ...(body.adapter !== undefined ? { adapter: body.adapter } : {}),
      ...(body.mapping ? { mapping: body.mapping } : {}),
      form: body.form,
    },
    dryRun: body.dryRun === true,
  };
}

export function registerIngestionRoutes(r: RouteRegistrar, ingestion: IngestionService) {
  r.internal(previewRoute, (async (c) => {
    const { input } = await readInput(c);
    return c.json(previewOut(await ingestion.preview(c.get('actor'), input)), 200);
  }) satisfies RouteHandler<typeof previewRoute, AppEnv>);

  r.internal(runRoute, (async (c) => {
    const { input, dryRun } = await readInput(c);
    const result = await ingestion.run(c.get('actor'), { ...input, dryRun });
    if (result.status === 'rejected')
      throw new Invalid(
        `The file was refused and nothing was recorded (run ${result.runId}).`,
        describeProblems(result.problems),
      );
    return c.json(resultOut(result), 200);
  }) satisfies RouteHandler<typeof runRoute, AppEnv>);

  r.internal(listRunsRoute, (async (c) => {
    const { service } = c.req.valid('query');
    const runs = await ingestion.listRuns(c.get('actor'), service);
    return c.json(
      paginate({ page: 0, pageSize: Math.max(runs.length, 1) }, runs.length, runs.map(runOut)),
      200,
    );
  }) satisfies RouteHandler<typeof listRunsRoute, AppEnv>);

  r.internal(getRunRoute, (async (c) => {
    const { id } = c.req.valid('param');
    return c.json(runOut(await ingestion.getRun(c.get('actor'), id)), 200);
  }) satisfies RouteHandler<typeof getRunRoute, AppEnv>);

  r.internal(listSubmittableServicesRoute, (async (c) => {
    const { q } = c.req.valid('query');
    const rows = await ingestion.submittableServices(c.get('actor'), { q });
    return c.json(
      paginate({ page: 0, pageSize: PICKER_LIMIT }, rows.length, rows.map(submittableOut)),
      200,
    );
  }) satisfies RouteHandler<typeof listSubmittableServicesRoute, AppEnv>);

  r.internal(listAdaptersRoute, ((c) => {
    const adapters = ingestion.adapters();
    return c.json(
      paginate(
        { page: 0, pageSize: Math.max(adapters.length, 1) },
        adapters.length,
        adapters.map(adapterOut),
      ),
      200,
    );
  }) satisfies RouteHandler<typeof listAdaptersRoute, AppEnv>);

  r.internal(templateRoute, (async (c) => {
    const { service, format } = c.req.valid('query');
    const file: TemplateFile = await ingestion.template(c.get('actor'), service, format);
    return c.body(file.bytes as Uint8Array<ArrayBuffer>, 200, {
      'content-type': file.contentType,
      'content-disposition': `attachment; filename="${file.fileName}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    });
  }) satisfies RouteHandler<typeof templateRoute, AppEnv>);
}
