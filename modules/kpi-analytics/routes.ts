// The internal routes of kpi.analytics (M11 sprints 3 to 5): the series and the summary of a service, the caller's own defaults, for the dashboard widgets, and the export of a service as a file. Thin: Zod parses,
// one service call, the row is mapped field by field. Both name the plain permission `kpi.analytics.read`, which the role `user` holds, and the
// service checks it again. A page is a page of KPIs, in the envelope every list uses. Never public v1.
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
import { MAX_INDICATOR_FILTER, MAX_SERIES_INDICATORS } from '@scorpion/kpi-ingestion/public';
import type { AnalyticsService, SeriesRow, SummaryRow } from './service/analytics.ts';
import { PERMISSION_EXPORT, PERMISSION_READ } from './service/permissions.ts';
import { RANGES } from './service/range.ts';

const query = paginationQuery({ defaultPageSize: 50, maxPageSize: 200 }).extend({
  service: z.uuid().describe('The id of the service.'),
  range: z
    .string()
    .max(8)
    .optional()
    .describe(
      `The window, counted back from the current month: ${RANGES.join(', ')}. Missing means 1y; it is always applied.`,
    ),
  category: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe(
      'A key of the vocabulary `thematic-category`, or `all`. Missing means every category.',
    ),
  indicators: z
    .string()
    .min(1)
    .max(4000)
    .optional()
    .describe(
      `Ids or names of KPIs of the service, separated by commas (at most ${MAX_INDICATOR_FILTER}).`,
    ),
});

const info = {
  indicatorId: z.string(),
  name: z.string(),
  valueType: z.string().describe('A key of the registry `kpi.valueType`.'),
  unit: z.string().nullable().describe('A term of the vocabulary `kpi.unit`.'),
  thematic: z.string().describe('A term of the vocabulary `thematic-category`.'),
  necessity: z
    .string()
    .nullable()
    .describe('A term of the vocabulary `necessity`; `null` for a KPI the service has dropped.'),
  current: z
    .boolean()
    .describe('The service reports the KPI now. `false`: it was dropped and its values stay.'),
};

const pointsSchema = z
  .array(
    z.object({
      period: z.string().describe('The last day of the month, `YYYY-MM-DD`.'),
      value: z
        .number()
        .nullable()
        .describe('The number, or `null` for a gap and for a text value; never zero for a gap.'),
      text: z
        .string()
        .nullable()
        .describe('The text of a text value; `null` for a number and for a gap.'),
    }),
  )
  .describe('One point per month of the window, oldest first.');

export const seriesRowSchema = z.object({ ...info, points: pointsSchema });

export const summaryRowSchema = z.object({
  ...info,
  points: pointsSchema.describe(
    'The same points the series read gives, so one read serves a dashboard of several widgets.',
  ),
  latest: z
    .object({
      period: z.string(),
      value: z.number().nullable(),
      text: z.string().describe('The canonical text of the value (a duration as `HH-MM-SS`).'),
    })
    .nullable()
    .describe('The newest month of the window with a value, or `null`.'),
  change: z
    .number()
    .nullable()
    .describe(
      'The change from the oldest to the newest value of the window, in percent; `null` (n/a) when fewer than two values exist or the oldest is 0.',
    ),
  average: z.number().nullable(),
  volatility: z.object({
    value: z
      .number()
      .nullable()
      .describe(
        'The mean absolute percentage deviation from the mean, as a fraction; `null` when it is not defined.',
      ),
    band: z
      .string()
      .nullable()
      .describe(
        '`low`, `medium` or `high` by the thresholds in the settings; `null` with the value.',
      ),
  }),
});

const window = `The window is counted back from the current month (UTC) and is always applied; \`range\` missing means \`1y\`. KPIs are the effective KPIs of the service plus any KPI it dropped that still has values in the window, by name without case then id, at most ${MAX_SERIES_INDICATORS}; pages count from 0. An unknown or malformed \`service\`, \`range\`, \`category\` or \`indicators\` is 422 naming the parameter; a service with no KPIs is an empty list.`;

export const getSeriesRoute = createRoute({
  method: 'get',
  path: '/kpi/analytics/series',
  permission: PERMISSION_READ,
  summary: 'The values of a service month by month',
  description: `One point per month of the window and KPI, gaps as \`null\`. ${window}`,
  request: { query },
  responses: {
    200: {
      description: 'A page of KPIs with their points.',
      content: { 'application/json': { schema: listEnvelope(seriesRowSchema) } },
    },
  },
});

export const getSummaryRoute = createRoute({
  method: 'get',
  path: '/kpi/analytics/summary',
  permission: PERMISSION_READ,
  summary: 'The latest value, change, average and volatility of each KPI',
  description: `Per KPI: the latest value, the change in percent, the average and the volatility with its band (thresholds from the settings). ${window}`,
  request: { query },
  responses: {
    200: {
      description: 'A page of KPIs with their figures.',
      content: { 'application/json': { schema: listEnvelope(summaryRowSchema) } },
    },
  },
});

export const defaultsSchema = z.object({
  service: z
    .string()
    .nullable()
    .describe(
      'The default service: the stored one while it exists, else the first service (by name) of the caller’s own providers, else `null`. Never an arbitrary service.',
    ),
  range: z.enum(RANGES).describe('The default range; always one of the five.'),
  category: z
    .string()
    .describe('A key of `categories`, or `all`; a stored key that is no longer a term is `all`.'),
  categories: z
    .array(z.object({ key: z.string(), label: z.string() }))
    .describe('The thematic categories a filter offers, in order: the one list the reads use.'),
});

export const getDefaultsRoute = createRoute({
  method: 'get',
  path: '/kpi/analytics/defaults',
  permission: PERMISSION_READ,
  summary: 'The caller’s own dashboard defaults',
  description:
    'The service, range and thematic category a new widget starts with, repaired (a stored value that is no longer valid is replaced), with the default service resolved, and the categories the filters offer. It is about the caller only and takes no user id. `Cache-Control: no-store`. The generic `PUT /preferences/kpi.analytics.defaults` stores the values.',
  responses: {
    200: {
      description: 'The defaults of the caller.',
      content: { 'application/json': { schema: defaultsSchema } },
    },
  },
});

export const exportRoute = createRoute({
  method: 'get',
  path: '/kpi/analytics/export',
  permission: PERMISSION_EXPORT,
  audit: true,
  summary: 'The values of a service as a CSV or XLSX file',
  description: `One row per KPI (name, unit, then one column per month of the window; empty where a KPI has no value), as an attachment. The CSV is UTF-8 with a byte order mark; the XLSX writes the month headings as text. Every text cell that starts with \`=\`, \`+\`, \`-\`, \`@\`, a tab or a carriage return is prefixed with \`'\`. The file name is the service's abbreviation, the word \`kpis\`, the range and the extension. ${window} \`format\` is a key of the registry \`analytics.exporter\` (\`csv\` or \`xlsx\`); every KPI of the window is in the file, up to ${MAX_SERIES_INDICATORS}. An export holds names, units and values of a service everyone signed in may read, and no person.`,
  request: {
    query: z.strictObject({
      service: query.shape.service,
      range: query.shape.range,
      category: query.shape.category,
      format: z
        .string()
        .min(1)
        .max(32)
        .describe('The file format: `csv` or `xlsx`. Any other is 422 naming `format`.'),
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
  },
});

const list = (value: string | undefined) => value?.split(',');

/** Field by field on purpose: a field added to a type later is not exposed by accident. */
const infoOut = (row: SeriesRow | SummaryRow) => ({
  indicatorId: row.indicatorId,
  name: row.name,
  valueType: row.valueType,
  unit: row.unit,
  thematic: row.thematic,
  necessity: row.necessity,
  current: row.current,
});

export function registerRoutes(r: RouteRegistrar, analytics: AnalyticsService) {
  r.internal(getSeriesRoute, (async (c) => {
    const { page, pageSize, service, range, category, indicators } = c.req.valid('query');
    const result = await analytics.series(
      c.get('actor'),
      { service, range, category, indicators: list(indicators) },
      { page, pageSize },
    );
    return c.json(
      paginate(
        { page, pageSize },
        result.total,
        result.rows.map((row) => ({
          ...infoOut(row),
          points: row.points.map((point) => ({
            period: point.period,
            value: point.value,
            text: point.text,
          })),
        })),
      ),
      200,
    );
  }) satisfies RouteHandler<typeof getSeriesRoute, AppEnv>);

  r.internal(getSummaryRoute, (async (c) => {
    const { page, pageSize, service, range, category, indicators } = c.req.valid('query');
    const result = await analytics.summary(
      c.get('actor'),
      { service, range, category, indicators: list(indicators) },
      { page, pageSize },
    );
    return c.json(
      paginate(
        { page, pageSize },
        result.total,
        result.rows.map((row) => ({
          ...infoOut(row),
          points: row.points.map((point) => ({
            period: point.period,
            value: point.value,
            text: point.text,
          })),
          latest: row.latest && {
            period: row.latest.period,
            value: row.latest.value,
            text: row.latest.text,
          },
          change: row.change,
          average: row.average,
          volatility: { value: row.volatility.value, band: row.volatility.band },
        })),
      ),
      200,
    );
  }) satisfies RouteHandler<typeof getSummaryRoute, AppEnv>);

  r.internal(exportRoute, (async (c) => {
    const { service, range, category, format } = c.req.valid('query');
    const file = await analytics.export(c.get('actor'), { service, range, category }, format);
    return c.body(file.bytes as Uint8Array<ArrayBuffer>, 200, {
      'content-type': file.mediaType,
      'content-disposition': `attachment; filename="${file.fileName}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    });
  }) satisfies RouteHandler<typeof exportRoute, AppEnv>);

  r.internal(getDefaultsRoute, (async (c) => {
    // About the caller, so no shared cache may keep it.
    c.header('cache-control', 'no-store');
    const own = await analytics.defaults(c.get('actor'));
    return c.json(
      {
        service: own.service,
        range: own.range,
        category: own.category,
        categories: own.categories.map(({ key, label }) => ({ key, label })),
      },
      200,
    );
  }) satisfies RouteHandler<typeof getDefaultsRoute, AppEnv>);
}
