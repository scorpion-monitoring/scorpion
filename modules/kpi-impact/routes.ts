// The internal routes of kpi.impact (M12 sprint 1): the consortia a Reviewer picks and the live tiles of one. Thin: Zod parses, one service call,
// the answer is mapped field by field. Both name the plain permission `kpi.impact.read`, which the role `reviewer` holds, and the service checks it
// again. `Cache-Control: no-store`: the answer follows a stage change at once and is for people who hold the permission. Never public v1.
import {
  createRoute,
  listEnvelope,
  pageMetadataSchema,
  paginate,
  paginationQuery,
  z,
  type AppEnv,
  type RouteHandler,
} from '@scorpion/contracts';
import type { RouteRegistrar } from '@scorpion/kernel';
import {
  DEFAULT_TABLE_PAGE_SIZE,
  MAX_TABLE_PAGE_SIZE,
  type ImpactService,
} from './service/impact.ts';
import { PERMISSION_READ } from './service/permissions.ts';

const consortiumSchema = z.object({
  id: z.string(),
  name: z.string(),
  abbreviation: z.string(),
});

export const getConsortiaRoute = createRoute({
  method: 'get',
  path: '/kpi/impact/consortia',
  permission: PERMISSION_READ,
  summary: 'The consortia the impact picker offers',
  description:
    'The organisations of the type `consortium`, by name without case then id, at most 500, as one page of the list envelope. `Cache-Control: no-store`.',
  responses: {
    200: {
      description: 'The consortia.',
      content: { 'application/json': { schema: listEnvelope(consortiumSchema) } },
    },
  },
});

const stageLine = z.object({
  key: z.string().describe('A term of the vocabulary `stage`.'),
  label: z.string().describe('The vocabulary’s label in the requested language.'),
  active: z
    .boolean()
    .describe('`false` for a term that was deactivated; services may still hold it.'),
  count: z.number().int(),
});

export const summarySchema = z.object({
  total: z
    .number()
    .int()
    .describe('The services counted: the published ones, or all with `includeUnpublished`.'),
  openSource: z.number().int().describe('An OSI-approved licence that is not deprecated.'),
  licenceDeprecated: z.number().int().describe('A deprecated SPDX id: not open source.'),
  licenceUnknown: z
    .number()
    .int()
    .describe('No licence, or an id the SPDX list does not know: not open source.'),
  otherLicence: z
    .number()
    .int()
    .describe(
      'A current licence that is not OSI-approved. `total` is the sum of these four counts.',
    ),
  stages: z
    .array(stageLine)
    .describe(
      'One line per term of the vocabulary `stage`, deactivated terms included, in the vocabulary’s order; zero counts are listed.',
    ),
  otherStages: z
    .array(z.object({ key: z.string(), count: z.number().int() }))
    .describe(
      'A stage key that services hold and the vocabulary does not list, by key; never dropped.',
    ),
});

export const getSummaryRoute = createRoute({
  method: 'get',
  path: '/kpi/impact/summary',
  permission: PERMISSION_READ,
  summary: 'The impact tiles of a consortium',
  description:
    'Counted live on every request: the services of the consortium (once each, however many consortia they have), how many are open source and the number per stage of the vocabulary. By default only published services are counted; `includeUnpublished=true` counts every linked service. A consortium that is not an id, names no organisation or names one that is not a consortium is 422 naming `consortium`. `Cache-Control: no-store`. The answer names no person and no contact point.',
  request: {
    query: z.strictObject({
      consortium: z.string().min(1).max(64).describe('The id of the consortium.'),
      includeUnpublished: z
        .enum(['true', 'false'])
        .optional()
        .describe('Count the unpublished services too. Default `false`.'),
      locale: z
        .string()
        .max(35)
        .optional()
        .describe('The language of the stage labels. Default `en`.'),
    }),
  },
  responses: {
    200: {
      description: 'The tiles.',
      content: { 'application/json': { schema: summarySchema } },
    },
  },
});

const rowSchema = z.object({
  serviceId: z.string(),
  name: z.string(),
  slug: z.string(),
  state: z
    .enum(['ok', 'no-data', 'no-evaluation', 'error'])
    .describe(
      '`ok`: the year has a value. `no-data`: the service has a headline and no value in the year. `no-evaluation`: it has no KPI set, or its set has no headline. `error`: the headline cannot be read. Exclusive.',
    ),
  reason: z
    .enum([
      'ok',
      'no-values',
      'no-set',
      'no-headline',
      'not-numeric',
      'value-type-unknown',
      'aggregate-not-allowed',
      'aggregate-unknown',
      'read-failed',
    ])
    .describe('Why the row is in its state, as a code a page can translate.'),
  advice: z
    .string()
    .describe(
      'What to do about the state, in English; empty for `ok`. Never a person, never a value.',
    ),
  headline: z
    .object({
      indicatorId: z.string(),
      name: z.string(),
      unit: z.string().nullable(),
      aggregate: z.string().describe('A term of the vocabulary `aggregate`.'),
      label: z
        .string()
        .describe('The vocabulary’s label of the aggregate in the requested language.'),
    })
    .nullable()
    .describe(
      'The headline of the set the service has now (the current evaluation applies to every year); `null` when there is none.',
    ),
  months: z
    .array(z.number().nullable())
    .length(12)
    .describe(
      'January first: the stored value of the month, `null` for a month with no value (never zero). A duration is in seconds.',
    ),
  yearly: z
    .number()
    .nullable()
    .describe(
      'The aggregate of the headline over the months that have a value; `null` when none has.',
    ),
  monthsWithValue: z.int().min(0).max(12).describe('The months `yearly` is over: "n of 12".'),
});

export const tableSchema = z.object({
  metadata: pageMetadataSchema,
  result: z.array(rowSchema),
  year: z.int(),
  years: z
    .array(z.int())
    .describe('The years offered: the current year and the nine before it, newest first.'),
});

export const getTableRoute = createRoute({
  method: 'get',
  path: '/kpi/impact/table',
  permission: PERMISSION_READ,
  summary: 'The yearly impact table of a consortium',
  description:
    'One row per service of the consortium for one calendar year, computed live from the evaluation of its KPI set and its measurements: a page of services by name without case, then id (default 50, at most 200). By default only published services; `includeUnpublished=true` adds the others. The current evaluation applies to every year. A `consortium` that is not a consortium and a `year` outside the years offered are 422 naming the parameter; a consortium with no services is an empty list. `Cache-Control: no-store`. The answer names no person.',
  request: {
    query: paginationQuery({
      defaultPageSize: DEFAULT_TABLE_PAGE_SIZE,
      maxPageSize: MAX_TABLE_PAGE_SIZE,
    }).extend({
      consortium: z.string().min(1).max(64).describe('The id of the consortium.'),
      year: z.string().min(1).max(8).describe('A calendar year of the years offered.'),
      includeUnpublished: z
        .enum(['true', 'false'])
        .optional()
        .describe('Include the unpublished services. Default `false`.'),
      locale: z
        .string()
        .max(35)
        .optional()
        .describe('The language of the aggregate labels. Default `en`.'),
    }),
  },
  responses: {
    200: {
      description: 'The table.',
      content: { 'application/json': { schema: tableSchema } },
    },
  },
});

export function registerRoutes(r: RouteRegistrar, impact: ImpactService) {
  r.internal(getConsortiaRoute, (async (c) => {
    c.header('cache-control', 'no-store');
    const rows = await impact.consortia(c.get('actor'));
    return c.json(
      paginate(
        { page: 0, pageSize: Math.max(rows.length, 1) },
        rows.length,
        rows.map(({ id, name, abbreviation }) => ({ id, name, abbreviation })),
      ),
      200,
    );
  }) satisfies RouteHandler<typeof getConsortiaRoute, AppEnv>);

  r.internal(getSummaryRoute, (async (c) => {
    c.header('cache-control', 'no-store');
    const { consortium, includeUnpublished, locale } = c.req.valid('query');
    const tiles = await impact.summary(c.get('actor'), {
      consortium,
      includeUnpublished: includeUnpublished === 'true',
      locale,
    });
    return c.json(
      {
        total: tiles.total,
        openSource: tiles.openSource,
        licenceDeprecated: tiles.licenceDeprecated,
        licenceUnknown: tiles.licenceUnknown,
        otherLicence: tiles.otherLicence,
        stages: tiles.stages.map(({ key, label, active, count }) => ({
          key,
          label,
          active,
          count,
        })),
        otherStages: tiles.otherStages.map(({ key, count }) => ({ key, count })),
      },
      200,
    );
  }) satisfies RouteHandler<typeof getSummaryRoute, AppEnv>);

  r.internal(getTableRoute, (async (c) => {
    c.header('cache-control', 'no-store');
    const { consortium, year, includeUnpublished, locale, page, pageSize } = c.req.valid('query');
    const view = await impact.table(c.get('actor'), {
      consortium,
      year,
      includeUnpublished: includeUnpublished === 'true',
      locale,
      page,
      pageSize,
    });
    return c.json(
      {
        ...paginate(
          { page: view.page, pageSize: view.pageSize },
          view.totalCount,
          view.rows.map((row) => ({
            serviceId: row.serviceId,
            name: row.name,
            slug: row.slug,
            state: row.state,
            reason: row.reason,
            advice: row.advice,
            headline: row.headline && {
              indicatorId: row.headline.indicatorId,
              name: row.headline.name,
              unit: row.headline.unit,
              aggregate: row.headline.aggregate,
              label: row.headline.label,
            },
            months: row.months,
            yearly: row.yearly,
            monthsWithValue: row.monthsWithValue,
          })),
        ),
        year: view.year,
        years: view.years,
      },
      200,
    );
  }) satisfies RouteHandler<typeof getTableRoute, AppEnv>);
}
