// The internal routes of kpi.ingestion (M10 sprint 2): the reads of the Data Submission page of sprint 4. The grid of one month (each
// indicator of the service's effective KPI set with the value stored for it) and the coverage of the last months (which months have
// every mandatory value). Thin: Zod parses, one service call, the row is mapped field by field. Both name the plain permission
// `kpi.ingestion.measurement.read`, which the role `user` holds, and the service checks it again. They use the same envelope as
// every list. The write of the page arrives with the adapters (sprint 3) and goes through `upsertBatch` like every other.
import {
  createRoute,
  listEnvelope,
  paginate,
  paginationQuery,
  z,
  type AppEnv,
  type RouteHandler,
} from '@scorpion/contracts';
import type { RouteRegistrar } from '@scorpion/kernel';
import {
  MAX_COVERAGE_MONTHS,
  type CoverageMonth,
  type GridRow,
  type ReadsService,
} from './service/reads.ts';
import { PERMISSION_MEASUREMENT_READ } from './service/permissions.ts';

const serviceParameter = z.uuid().describe('The id of the service.');

export const gridRowSchema = z.object({
  indicatorId: z.string(),
  name: z.string(),
  valueType: z.string().describe('A key of the registry `kpi.valueType`.'),
  unit: z.string().nullable().describe('A term of the vocabulary `kpi.unit`.'),
  necessity: z.string().describe('A term of the vocabulary `necessity`; `optional` for an extra.'),
  min: z.number().nullable(),
  max: z.number().nullable(),
  measurement: z
    .object({
      id: z.string(),
      value: z
        .string()
        .describe('The canonical text of the stored value (a duration as `HH-MM-SS`).'),
      valueNumber: z.number().nullable(),
    })
    .nullable()
    .describe('The value stored for the month, or `null` while the month has none.'),
});

export const coverageMonthSchema = z.object({
  period: z.string().describe('The last day of the month, `YYYY-MM-DD`.'),
  reported: z
    .int()
    .describe('How many indicators of the effective KPI set have a value for the month.'),
  mandatory: z
    .int()
    .describe('How many indicators of the effective KPI set are mandatory (the set as it is now).'),
  mandatoryReported: z.int().describe('How many of the mandatory indicators have a value.'),
  complete: z
    .boolean()
    .describe('No mandatory value is missing (also true while nothing is mandatory).'),
});

export const getGridRoute = createRoute({
  method: 'get',
  path: '/kpi/measurements',
  permission: PERMISSION_MEASUREMENT_READ,
  summary: 'The values of one month of a service',
  description:
    'Each indicator of the effective KPI set of the service (the rows of its KPI set, then its extras, by name without case) with the value stored for `period` (`YYYY-MM` or `YYYY-MM-DD`, any day of the month), or `measurement: null`. 404 for a service that does not exist, 422 for a bad `period`. Pages count from 0, `pageSize` is at most 500 (default 200); `totalCount` is the number of indicators.',
  request: {
    query: paginationQuery({ defaultPageSize: 200, maxPageSize: 500 }).extend({
      service: serviceParameter,
      period: z.string().min(1).max(32).describe('The month: `YYYY-MM` or `YYYY-MM-DD`.'),
    }),
  },
  responses: {
    200: {
      description: 'A page of indicators with the value of the month.',
      content: { 'application/json': { schema: listEnvelope(gridRowSchema) } },
    },
    404: { description: 'No such service.' },
  },
});

export const getCoverageRoute = createRoute({
  method: 'get',
  path: '/kpi/measurements/coverage',
  permission: PERMISSION_MEASUREMENT_READ,
  summary: 'The months of a service that have values',
  description: `The last \`months\` months (default 12, at most ${MAX_COVERAGE_MONTHS}; the current month is the last), oldest first, with how many of the effective indicators and of the mandatory ones have a value. The mandatory ones are those of the KPI set as it is now. 404 for a service that does not exist. One page holds every month.`,
  request: {
    query: z.strictObject({
      service: serviceParameter,
      months: z
        .string()
        .regex(/^\d{1,2}$/, 'must be a whole number')
        .transform(Number)
        .pipe(z.number().int().min(1).max(MAX_COVERAGE_MONTHS))
        .optional()
        .describe(`How many months, 1 to ${MAX_COVERAGE_MONTHS}; default 12.`),
    }),
  },
  responses: {
    200: {
      description: 'The months.',
      content: { 'application/json': { schema: listEnvelope(coverageMonthSchema) } },
    },
    404: { description: 'No such service.' },
  },
});

/** Field by field on purpose: a column added to a table later is not exposed by accident. */
const gridRowOut = (row: GridRow) => ({
  indicatorId: row.indicatorId,
  name: row.name,
  valueType: row.valueType,
  unit: row.unit,
  necessity: row.necessity,
  min: row.min,
  max: row.max,
  measurement: row.measurement && {
    id: row.measurement.id,
    value: row.measurement.value,
    valueNumber: row.measurement.valueNumber,
  },
});

const coverageOut = (month: CoverageMonth) => ({
  period: month.period,
  reported: month.reported,
  mandatory: month.mandatory,
  mandatoryReported: month.mandatoryReported,
  complete: month.complete,
});

export function registerRoutes(r: RouteRegistrar, reads: ReadsService) {
  r.internal(getGridRoute, (async (c) => {
    const { page, pageSize, service, period } = c.req.valid('query');
    const grid = await reads.grid(c.get('actor'), service, period);
    const from = page * pageSize;
    return c.json(
      paginate(
        { page, pageSize },
        grid.rows.length,
        grid.rows.slice(from, from + pageSize).map(gridRowOut),
      ),
      200,
    );
  }) satisfies RouteHandler<typeof getGridRoute, AppEnv>);

  r.internal(getCoverageRoute, (async (c) => {
    const { service, months } = c.req.valid('query');
    const result = await reads.coverage(c.get('actor'), service, months);
    return c.json(
      paginate({ page: 0, pageSize: result.length }, result.length, result.map(coverageOut)),
      200,
    );
  }) satisfies RouteHandler<typeof getCoverageRoute, AppEnv>);
}
