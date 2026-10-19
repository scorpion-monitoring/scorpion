// The v1 routes of kpi.ingestion (the public API, `/api/v1`, ADR-0037, M10 sprint 2): the time series of a service and the first
// write of the public API. Thin: Zod parses, one service call, the row is mapped field by field. A token reaches the read with the
// scope `kpi.ingestion.v1.read`, and the write with `kpi.ingestion.v1.write` **and** an owner who may submit for that service
// (the service checks the scoped `kpi.ingestion.measurement.submit`, ADR-0015); a person with a session who holds the permission
// reaches them too (a cookie write needs the CSRF header like any other).
//
// The legacy shape is kept (`{ kpi, value, date }`, the envelope with `result` and not the legacy `data`, 0-based pages) and every
// field beyond it is an addition (ADR-0037 decision 9).
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
import { MAX_INDICATOR_FILTER, type MeasurementRead, type ReadsService } from './service/reads.ts';
import type { MeasurementsService } from './service/measurements.ts';
import { PERMISSION_V1_READ, PERMISSION_V1_WRITE } from './service/permissions.ts';

/** The most items one `POST /api/v1/measurements` carries (the legacy shape; a bigger import goes through the page). */
export const MAX_API_ITEMS = 500;

/**
 * The largest body of that route, in bytes. 500 items of the legacy shape are about 60 kB, but a text value may be 4 000
 * characters, a name 200 and a date 32: 500 × (4 000 + 200 + 32 + about 40 of JSON) is 2.14 MB for plain ASCII, so the limit is
 * 3 MiB. The server-wide 1 MiB would refuse a batch of 500 long texts that the schema accepts. Anything over is 413 before the
 * body is read.
 */
export const MAX_API_BODY_BYTES = 3 * 1024 * 1024;

const MAX_NAME = 200;
const MAX_VALUE = 4000;
const MAX_DATE = 32;

/** A comma-separated list: at most 50 values, none empty, none longer than a name. */
const indicatorList = z
  .string()
  .max(MAX_INDICATOR_FILTER * (MAX_NAME + 1))
  .transform((text) => text.split(',').map((value) => value.trim()))
  .pipe(
    z.array(z.string().min(1, 'must not be empty').max(MAX_NAME)).min(1).max(MAX_INDICATOR_FILTER),
  )
  .optional()
  .describe(
    'Indicators of the service, comma-separated: each is the name of the indicator (without case) or its id. A name that contains a comma is given by id.',
  );

/** A measurement as v1 returns it: the legacy `kpi`, `value` and `date`, and what is added. */
export const measurementV1Schema = z.object({
  kpi: z.string().describe('The name of the indicator (the legacy field).'),
  value: z
    .string()
    .describe(
      'The value as text, as the legacy API returned it: what the value type of the indicator formats (a duration as `HH-MM-SS`, a number as a decimal, text as written). `valueNumber` has the number.',
    ),
  date: z
    .string()
    .describe('The last day of the month the value belongs to, `YYYY-MM-DD` (the legacy field).'),
  id: z.string().describe('The id of the measurement (a UUID).'),
  indicatorId: z.string().describe('The id of the indicator (a UUID), as in `GET /indicators`.'),
  iri: z
    .string()
    .describe('The identifier of the indicator. It identifies; it does not dereference.'),
  service: z.string().describe('The abbreviation of the service, as in `GET /services`.'),
  period: z.string().describe('The same day as `date`.'),
  valueNumber: z
    .number()
    .nullable()
    .describe('The value as a number for a numeric type (a duration in seconds), else `null`.'),
});

const EXAMPLE_MEASUREMENT = {
  kpi: 'Page views',
  value: '12450',
  date: '2026-03-31',
  id: '0198f3b1-4c07-7e19-8d52-6a0f93c1b7e4',
  indicatorId: '0198f3a8-9e03-7a52-b4c7-81d05f2e6a47',
  iri: 'https://registry.example.org/kpi/indicator/page-views',
  service: 'EXAMPLE-SVC',
  period: '2026-03-31',
  valueNumber: 12450,
};

const serviceParameter = (what: string) =>
  z.string().min(1).max(64).describe(`${what} The id or the abbreviation of a service.`);

export const listMeasurementsV1Route = createRoute({
  method: 'get',
  path: '/measurements',
  permission: PERMISSION_V1_READ,
  audit: true,
  summary: 'List the measurements of a service',
  description:
    'The values reported for one service, one row per indicator and month. `service` is required (the id or the abbreviation of a service; a request for every service is an export, not this list). `indicators` keeps the named indicators (names without case, or ids), `start` and `stop` keep the months from and up to the given one (`YYYY-MM` or `YYYY-MM-DD`; any day of a month means that month). An unknown service or indicator, a bad `start` or `stop`, an unknown parameter and a `start` after `stop` are 422 naming the parameter. Sorted by month, then by indicator name without case, then by id, so the order holds across pages; pages count from 0 and `pageSize` is at most 100 (default 100). `totalCount` is the size of the filtered set. A value of an indicator the service no longer reports is still listed. The list is `result`, not the legacy `data`.',
  request: {
    query: paginationQuery({ defaultPageSize: 100 }).extend({
      service: serviceParameter('Required.'),
      indicators: indicatorList,
      start: z
        .string()
        .min(1)
        .max(MAX_DATE)
        .optional()
        .describe('From this month on: `YYYY-MM` or `YYYY-MM-DD`.'),
      stop: z
        .string()
        .min(1)
        .max(MAX_DATE)
        .optional()
        .describe('Up to this month: `YYYY-MM` or `YYYY-MM-DD`.'),
    }),
  },
  responses: {
    200: {
      description: 'A page of measurements.',
      content: {
        'application/json': {
          schema: listEnvelope(measurementV1Schema),
          example: {
            metadata: { currentPage: 0, pageSize: 100, totalCount: 1, totalPages: 1 },
            result: [EXAMPLE_MEASUREMENT],
          },
        },
      },
    },
  },
});

/** One value of a batch, in the legacy shape. Unknown fields are refused. */
export const measurementItemSchema = z.strictObject({
  kpi: z
    .string()
    .min(1)
    .max(MAX_NAME)
    .describe('The name of an indicator of the service (without case), or its id.'),
  value: z
    .union([z.string().max(MAX_VALUE), z.number()])
    .describe(
      'What the value type of the indicator accepts: a number, or text (a duration as `HH-MM-SS`, a percentage as a number from 0 to 100).',
    ),
  date: z
    .string()
    .min(1)
    .max(MAX_DATE)
    .describe(
      'The month: `YYYY-MM`, or any day `YYYY-MM-DD` of it. It is stored as the last day of the month. Not after the current month.',
    ),
});

export const submittedV1Schema = z.object({
  inserted: z.int().describe('Values stored for a month that had none.'),
  updated: z.int().describe('Values that replaced a different one.'),
  unchanged: z.int().describe('Values that were the same as the stored one: not written.'),
});

export const writeMeasurementsV1Route = createRoute({
  method: 'post',
  path: '/measurements',
  permission: PERMISSION_V1_WRITE,
  audit: true,
  maxBodyBytes: MAX_API_BODY_BYTES,
  summary: 'Record the measurements of a service',
  description: `Upserts a batch of 1 to ${MAX_API_ITEMS} values for one service: a month that already has a value for that indicator is updated, never duplicated. The batch is all or nothing: one bad item is a 422 that names every bad path (\`[3].kpi\`, \`[3].value\`, \`[3].date\`) and nothing is stored. Only the KPIs the service has (its KPI set and its extra indicators) are accepted, a value must fit the type and the bounds of its indicator, a month after the current one is refused, and the same indicator and month twice in one batch is refused. \`service\` is the id or the abbreviation of a service; an unknown one is 422 naming \`service\`. The token needs two scopes, \`${PERMISSION_V1_WRITE}\` (this route) and \`kpi.ingestion.measurement.submit\` (the permission the service checks), and its owner must be allowed to submit for that service (an approved member of its provider, or an Admin): else 403. A body over 3 MiB is 413. Structural errors of the JSON (a missing field, a wrong type) are named by their position, \`0.kpi\`.`,
  request: {
    query: z.strictObject({ service: serviceParameter('Required.') }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.array(measurementItemSchema).min(1).max(MAX_API_ITEMS),
          example: [
            { kpi: 'Page views', value: 12450, date: '2026-03' },
            { kpi: 'Uptime', value: '720-00-00', date: '2026-03-31' },
          ],
        },
      },
    },
  },
  responses: {
    200: {
      description: 'The batch was recorded.',
      content: {
        'application/json': {
          schema: submittedV1Schema,
          example: { inserted: 1, updated: 1, unchanged: 0 },
        },
      },
    },
    409: {
      description:
        'An indicator was deleted while the batch was written; nothing was recorded, try again.',
    },
    413: { description: 'The body is larger than 3 MiB.' },
  },
});

/** Field by field on purpose: a column added to the table later is not exposed by accident. */
const measurementOut = (m: MeasurementRead) => ({
  kpi: m.kpi,
  value: m.value,
  date: m.date,
  id: m.id,
  indicatorId: m.indicatorId,
  iri: m.iri,
  service: m.service,
  period: m.period,
  valueNumber: m.valueNumber,
});

export function registerV1Routes(
  r: RouteRegistrar,
  reads: ReadsService,
  measurements: MeasurementsService,
) {
  r.public('v1', listMeasurementsV1Route, (async (c) => {
    const { page, pageSize, service, indicators, start, stop } = c.req.valid('query');
    const result = await reads.list(
      c.get('actor'),
      { service, indicators, start, stop },
      { page, pageSize },
    );
    return c.json(paginate({ page, pageSize }, result.total, result.rows.map(measurementOut)), 200);
  }) satisfies RouteHandler<typeof listMeasurementsV1Route, AppEnv>);

  r.public('v1', writeMeasurementsV1Route, (async (c) => {
    const { service } = c.req.valid('query');
    const { inserted, updated, unchanged } = await measurements.upsertByName(
      c.get('actor'),
      service,
      c.req.valid('json'),
    );
    return c.json({ inserted, updated, unchanged }, 200);
  }) satisfies RouteHandler<typeof writeMeasurementsV1Route, AppEnv>);
}
