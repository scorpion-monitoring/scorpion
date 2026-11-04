// The internal routes of kpi.impact (M12 sprint 1): the consortia a Reviewer picks and the live tiles of one. Thin: Zod parses, one service call,
// the answer is mapped field by field. Both name the plain permission `kpi.impact.read`, which the role `reviewer` holds, and the service checks it
// again. `Cache-Control: no-store`: the answer follows a stage change at once and is for people who hold the permission. Never public v1.
import {
  createRoute,
  listEnvelope,
  paginate,
  z,
  type AppEnv,
  type RouteHandler,
} from '@scorpion/contracts';
import type { RouteRegistrar } from '@scorpion/kernel';
import type { ImpactService } from './service/impact.ts';
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
}
