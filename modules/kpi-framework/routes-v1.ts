// The v1 routes of kpi.framework (the public API, `/api/v1`, ADR-0037). Thin: Zod parses, one service call, the row is
// mapped field by field. A token reaches them with the scope `kpi.framework.v1.read`; a person with a session who
// holds the permission reaches them too. Every field beyond the legacy shape is an addition (ADR-0037 decision 9).
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
import { PERMISSION_V1_READ } from './service/permissions.ts';
import type { CategoryV1, IndicatorV1, V1Service } from './service/v1.ts';

/** A category as v1 returns it: the legacy `name` and what is added to it. */
export const categoryV1Schema = z.object({
  name: z.string().describe('The name of the KPI set (the legacy category).'),
  id: z.string().describe('The id of the KPI set (a UUID).'),
  iri: z.string().describe('The identifier of the set. It identifies; it does not dereference.'),
  description: z.string().nullable().describe('Plain text.'),
  rimoCategory: z
    .string()
    .nullable()
    .describe('The IRI of the RIMO service category the set maps to, or `null`.'),
  indicators: z.int().describe('How many indicators the set has.'),
});

export const indicatorV1Schema = z.object({
  name: z.string(),
  description: z.string().nullable().describe('Plain text.'),
  type: z
    .string()
    .describe(
      'The legacy name of the value type: `number` for an integer, else the key of `valueType`.',
    ),
  thematicCategory: z
    .string()
    .describe('A term of the vocabulary `thematic-category` (Bibliographic, Usage, ...).'),
  selected: z
    .boolean()
    .describe(
      'Whether the indicator is in the effective KPI set of the service asked for with `service`; always `false` without one.',
    ),
  necessity: z
    .string()
    .nullable()
    .describe(
      'A term of the vocabulary `necessity`: the necessity in the set asked for with `category`, else in the effective KPI set of the service asked for with `service`, else `null`.',
    ),
  id: z.string().describe('The id of the indicator (a UUID).'),
  iri: z
    .string()
    .describe('The identifier of the indicator. It identifies; it does not dereference.'),
  example: z.string().nullable(),
  valueType: z.string().describe('A key of the registry `kpi.valueType`.'),
  qualitative: z.boolean(),
  unit: z
    .object({
      key: z.string(),
      symbol: z.string().nullable(),
      iri: z.string().describe('The Units Ontology IRI of a seeded unit, else an IRI minted here.'),
    })
    .nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  measuredBy: z.array(z.string()).describe('Terms of the vocabulary `kpi.measured-by`.'),
  canBeAutomatedBy: z.array(z.string()).describe('Terms of the vocabulary `kpi.automation-tool`.'),
});

const EXAMPLE_CATEGORY = {
  name: 'Data resources',
  id: '0198f3a8-5b21-7d40-9c1e-2a7f6b3d9e10',
  iri: 'https://registry.example.org/kpi/set/data-resources',
  description: 'Services that offer data to researchers.',
  rimoCategory: 'http://w3id.org/RIMO#DataResource',
  indicators: 12,
};

const EXAMPLE_INDICATOR = {
  name: 'Page views',
  description: 'How often the pages of the service were opened.',
  type: 'number',
  thematicCategory: 'Usage',
  selected: true,
  necessity: 'mandatory',
  id: '0198f3a8-9e03-7a52-b4c7-81d05f2e6a47',
  iri: 'https://registry.example.org/kpi/indicator/page-views',
  example: '12 450 page views in March',
  valueType: 'integer',
  qualitative: false,
  unit: { key: 'count', symbol: null, iri: 'http://purl.obolibrary.org/obo/UO_0000189' },
  min: 0,
  max: null,
  measuredBy: ['web-analytics'],
  canBeAutomatedBy: [],
};

const envelope = (example: unknown) => ({
  metadata: { currentPage: 0, pageSize: 100, totalCount: 1, totalPages: 1 },
  result: [example],
});

export const listCategoriesV1Route = createRoute({
  method: 'get',
  path: '/categories',
  permission: PERMISSION_V1_READ,
  audit: true,
  summary: 'List the KPI sets',
  description:
    'The KPI sets (the legacy "categories"), each once. Sorted by name without case, then by id; pages count from 0 and `pageSize` is at most 100 (default 100). `totalCount` is the number of sets.',
  request: { query: paginationQuery({ defaultPageSize: 100 }) },
  responses: {
    200: {
      description: 'A page of KPI sets.',
      content: {
        'application/json': {
          schema: listEnvelope(categoryV1Schema),
          example: envelope(EXAMPLE_CATEGORY),
        },
      },
    },
  },
});

export const listIndicatorsV1Route = createRoute({
  method: 'get',
  path: '/indicators',
  permission: PERMISSION_V1_READ,
  audit: true,
  summary: 'List the indicators',
  description:
    'The indicators. `category` (the name of a KPI set, without case) keeps the indicators of that set and gives their necessity in it. `service` (the abbreviation of a service, without case) marks the indicators of its effective KPI set with `selected: true` and, without `category`, gives their necessity there; it does not remove the others. A `category` that names no set and a `service` that names no service is 422. Sorted by name without case, then by id; pages count from 0 and `pageSize` is at most 100 (default 100). `totalCount` is the size of the filtered set.',
  request: {
    query: paginationQuery({ defaultPageSize: 100 }).extend({
      category: z.string().min(1).max(200).optional().describe('The name of a KPI set.'),
      service: z.string().min(1).max(64).optional().describe('The abbreviation of a service.'),
    }),
  },
  responses: {
    200: {
      description: 'A page of indicators.',
      content: {
        'application/json': {
          schema: listEnvelope(indicatorV1Schema),
          example: envelope(EXAMPLE_INDICATOR),
        },
      },
    },
  },
});

/** Field by field on purpose: a column added to a table later is not exposed by accident. */
const categoryOut = (c: CategoryV1) => ({
  name: c.name,
  id: c.id,
  iri: c.iri,
  description: c.description,
  rimoCategory: c.rimoCategory,
  indicators: c.indicators,
});

const indicatorOut = (i: IndicatorV1) => ({
  name: i.name,
  description: i.description,
  type: i.type,
  thematicCategory: i.thematicCategory,
  selected: i.selected,
  necessity: i.necessity,
  id: i.id,
  iri: i.iri,
  example: i.example,
  valueType: i.valueType,
  qualitative: i.qualitative,
  unit: i.unit,
  min: i.min,
  max: i.max,
  measuredBy: i.measuredBy,
  canBeAutomatedBy: i.canBeAutomatedBy,
});

export function registerV1Routes(r: RouteRegistrar, service: V1Service) {
  r.public('v1', listCategoriesV1Route, (async (c) => {
    const { page, pageSize } = c.req.valid('query');
    const result = await service.categories(c.get('actor'), { page, pageSize });
    return c.json(
      paginate({ page, pageSize }, result.total, result.categories.map(categoryOut)),
      200,
    );
  }) satisfies RouteHandler<typeof listCategoriesV1Route, AppEnv>);

  r.public('v1', listIndicatorsV1Route, (async (c) => {
    const { page, pageSize, category, service: serviceName } = c.req.valid('query');
    const result = await service.indicators(
      c.get('actor'),
      { category, service: serviceName },
      { page, pageSize },
    );
    return c.json(
      paginate({ page, pageSize }, result.total, result.indicators.map(indicatorOut)),
      200,
    );
  }) satisfies RouteHandler<typeof listIndicatorsV1Route, AppEnv>);
}
