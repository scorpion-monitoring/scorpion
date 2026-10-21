// The internal routes of kpi.analytics (M11 sprint 3): the series and the summary of a service for the dashboard of sprint 4. Thin: Zod parses,
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
import { PERMISSION_READ } from './service/permissions.ts';
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

export const seriesRowSchema = z.object({
  ...info,
  points: z
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
    .describe('One point per month of the window, oldest first.'),
});

export const summaryRowSchema = z.object({
  ...info,
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
}
