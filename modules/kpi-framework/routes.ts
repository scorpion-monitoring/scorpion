// The HTTP routes of kpi.framework (internal API): indicators, KPI sets, their rows and evaluation, and the value
// types. Thin: Zod parses, one service call, the result is mapped. Every route has a permission and the service
// checks it again (CLAUDE.md, security rules). Writes are audited.
import {
  createRoute,
  listEnvelope,
  paginate,
  z,
  type AppEnv,
  type RouteHandler,
} from '@scorpion/contracts';
import type { RouteRegistrar } from '@scorpion/kernel';
import type { KpiFrameworkService } from './module.ts';
import {
  createIndicatorSchema,
  createSetSchema,
  evaluationSchema,
  indicatorListQuery,
  setIndicatorsSchema,
  setListQuery,
  updateIndicatorSchema,
  updateSetSchema,
} from './service/input.ts';
import type { IndicatorView, ValueTypeView } from './service/indicators.ts';
import {
  PERMISSION_INDICATOR_MANAGE,
  PERMISSION_INDICATOR_READ,
  PERMISSION_SET_MANAGE,
  PERMISSION_SET_READ,
} from './service/permissions.ts';
import type { EvaluationView, SetSummary, SetView } from './service/sets.ts';

const ok = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { 'application/json': { schema } },
});
const idParam = z.object({ id: z.uuid() });

const indicatorSchema = z.object({
  id: z.string(),
  slug: z.string().describe('Never changes; the identifier is built from it.'),
  iri: z
    .string()
    .describe('The identifier of the indicator. It identifies; it does not dereference.'),
  name: z.string(),
  description: z.string().nullable(),
  example: z.string().nullable(),
  qualitative: z.boolean(),
  valueType: z
    .string()
    .describe('A key of the registry `kpi.valueType` (see `GET /kpi/value-types`).'),
  unit: z.string().nullable().describe('A term of the vocabulary `kpi.unit`.'),
  min: z.number().nullable(),
  max: z.number().nullable(),
  thematic: z.string().describe('A term of the vocabulary `thematic-category`.'),
  measuredBy: z.array(z.string()).describe('Terms of the vocabulary `kpi.measured-by`.'),
  canBeAutomatedBy: z.array(z.string()).describe('Terms of the vocabulary `kpi.automation-tool`.'),
  setCount: z.number().int().describe('In how many KPI sets the indicator is a row.'),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  createdBy: z.string().nullable(),
  updatedBy: z.string().nullable(),
});

const setSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  iri: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  rimoCategory: z.string().nullable().describe('A term of the vocabulary `kpi.service-category`.'),
  indicatorCount: z.number().int(),
  necessityCounts: z
    .record(z.string(), z.number().int())
    .describe('Rows per term of the vocabulary `necessity`.'),
  hasEvaluation: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const evaluationOutSchema = z.object({
  setId: z.string(),
  indicatorId: z.string(),
  aggregate: z.string().describe('A term of the vocabulary `aggregate`.'),
  updatedAt: z.iso.datetime(),
});

const setSchema = setSummarySchema.extend({
  indicators: z.array(
    z.object({
      indicatorId: z.string(),
      slug: z.string(),
      name: z.string(),
      necessity: z.string().describe('A term of the vocabulary `necessity`.'),
      valueType: z.string(),
      unit: z.string().nullable(),
      thematic: z.string(),
      qualitative: z.boolean(),
    }),
  ),
  evaluation: evaluationOutSchema.nullable(),
  createdBy: z.string().nullable(),
  updatedBy: z.string().nullable(),
});

const valueTypeSchema = z.object({
  id: z.string(),
  labels: z.object({ en: z.string(), de: z.string().optional() }),
  numeric: z
    .boolean()
    .describe('Whether the type has an order: only then may an indicator have `min` and `max`.'),
  range: z
    .object({ min: z.number().optional(), max: z.number().optional() })
    .optional()
    .describe('The range the type allows by itself (a percentage is 0 to 100).'),
  aggregates: z
    .array(z.string())
    .describe('The terms of `aggregate` that make sense for the type.'),
});

const evaluationReadSchema = z.object({
  evaluation: evaluationOutSchema.nullable().describe('`null` while the set has no headline.'),
});

const R422 = {
  description:
    'Invalid input; `errors` names every bad path (an unknown term, a bound the value type does not allow, …).',
};

// ----- indicators -----------------------------------------------------------------------------------

export const listIndicatorsRoute = createRoute({
  method: 'get',
  path: '/kpi/indicators',
  permission: PERMISSION_INDICATOR_READ,
  request: { query: indicatorListQuery },
  responses: {
    200: ok('Indicators by the sort key, then name, then id.', listEnvelope(indicatorSchema)),
    422: R422,
  },
});

export const createIndicatorRoute = createRoute({
  method: 'post',
  path: '/kpi/indicators',
  permission: PERMISSION_INDICATOR_MANAGE,
  audit: true,
  request: { body: body(createIndicatorSchema) },
  responses: {
    201: ok('The indicator.', indicatorSchema),
    409: { description: 'The name or the slug is taken (the field is named).' },
    422: R422,
  },
});

export const getIndicatorRoute = createRoute({
  method: 'get',
  path: '/kpi/indicators/{id}',
  permission: PERMISSION_INDICATOR_READ,
  request: { params: idParam },
  responses: {
    200: ok('One indicator.', indicatorSchema),
    404: { description: 'No such indicator.' },
  },
});

export const updateIndicatorRoute = createRoute({
  method: 'put',
  path: '/kpi/indicators/{id}',
  permission: PERMISSION_INDICATOR_MANAGE,
  audit: true,
  request: { params: idParam, body: body(updateIndicatorSchema) },
  responses: {
    200: ok(
      'The indicator after the change. A field left out is cleared; the slug never changes.',
      indicatorSchema,
    ),
    404: { description: 'No such indicator.' },
    409: {
      description:
        'The name is taken, or a KPI set uses the indicator as its headline with an aggregate that the new value type does not allow.',
    },
    422: R422,
  },
});

export const deleteIndicatorRoute = createRoute({
  method: 'delete',
  path: '/kpi/indicators/{id}',
  permission: PERMISSION_INDICATOR_MANAGE,
  audit: true,
  request: { params: idParam },
  responses: {
    204: { description: 'Deleted.' },
    404: { description: 'No such indicator.' },
    409: {
      description:
        '`kpi-in-use`: a KPI set (or an evaluation) still uses it. The problem names the module and the count.',
    },
  },
});

export const listValueTypesRoute = createRoute({
  method: 'get',
  path: '/kpi/value-types',
  permission: PERMISSION_INDICATOR_READ,
  responses: {
    200: ok('The registered value types, by id, all on page 0.', listEnvelope(valueTypeSchema)),
  },
});

// ----- KPI sets -------------------------------------------------------------------------------------

export const listSetsRoute = createRoute({
  method: 'get',
  path: '/kpi/sets',
  permission: PERMISSION_SET_READ,
  request: { query: setListQuery },
  responses: {
    200: ok('KPI sets by the sort key, then name, then id.', listEnvelope(setSummarySchema)),
    422: R422,
  },
});

export const createSetRoute = createRoute({
  method: 'post',
  path: '/kpi/sets',
  permission: PERMISSION_SET_MANAGE,
  audit: true,
  request: { body: body(createSetSchema) },
  responses: {
    201: ok('The KPI set, without indicators.', setSchema),
    409: { description: 'The name or the slug is taken (the field is named).' },
    422: R422,
  },
});

export const getSetRoute = createRoute({
  method: 'get',
  path: '/kpi/sets/{id}',
  permission: PERMISSION_SET_READ,
  request: { params: idParam },
  responses: {
    200: ok('One KPI set with its indicators and its evaluation.', setSchema),
    404: { description: 'No such KPI set.' },
  },
});

export const updateSetRoute = createRoute({
  method: 'put',
  path: '/kpi/sets/{id}',
  permission: PERMISSION_SET_MANAGE,
  audit: true,
  request: { params: idParam, body: body(updateSetSchema) },
  responses: {
    200: ok(
      'The KPI set after the change. A field left out is cleared; the slug never changes.',
      setSchema,
    ),
    404: { description: 'No such KPI set.' },
    409: { description: 'The name is taken.' },
    422: R422,
  },
});

export const deleteSetRoute = createRoute({
  method: 'delete',
  path: '/kpi/sets/{id}',
  permission: PERMISSION_SET_MANAGE,
  audit: true,
  request: { params: idParam },
  responses: {
    204: { description: 'Deleted, with its rows and its evaluation.' },
    404: { description: 'No such KPI set.' },
    409: { description: '`kpi-in-use`: a service uses the set (from M9 sprint 3).' },
  },
});

export const setIndicatorsRoute = createRoute({
  method: 'put',
  path: '/kpi/sets/{id}/indicators',
  permission: PERMISSION_SET_MANAGE,
  audit: true,
  request: { params: idParam, body: body(setIndicatorsSchema) },
  responses: {
    200: ok(
      'The set after the change. The rows listed replace the rows the set had, in one transaction; an indicator not listed is removed, and the evaluation with it when it was the headline.',
      setSchema,
    ),
    404: { description: 'No such KPI set.' },
    409: { description: 'An indicator of the list was deleted while the request ran.' },
    422: {
      description:
        'An unknown indicator, an indicator listed twice, or a necessity that is not an active term (an empty one included); `errors` names `indicators[i].indicatorId` or `indicators[i].necessity`.',
    },
  },
});

export const getEvaluationRoute = createRoute({
  method: 'get',
  path: '/kpi/sets/{id}/evaluation',
  permission: PERMISSION_SET_READ,
  request: { params: idParam },
  responses: {
    200: ok('The headline of the set.', evaluationReadSchema),
    404: { description: 'No such KPI set.' },
  },
});

export const setEvaluationRoute = createRoute({
  method: 'put',
  path: '/kpi/sets/{id}/evaluation',
  permission: PERMISSION_SET_MANAGE,
  audit: true,
  request: { params: idParam, body: body(evaluationSchema) },
  responses: {
    200: ok('The headline after the change.', evaluationOutSchema),
    404: { description: 'No such KPI set.' },
    422: {
      description:
        'The indicator is not in the set, the aggregate does not fit its value type, or the aggregate is not an active term.',
    },
  },
});

// ----- the mappers: field by field, so a column added to a table later is not exposed by accident ---

const indicatorOut = (v: IndicatorView) => ({
  id: v.id,
  slug: v.slug,
  iri: v.iri,
  name: v.name,
  description: v.description,
  example: v.example,
  qualitative: v.qualitative,
  valueType: v.valueType,
  unit: v.unit,
  min: v.min,
  max: v.max,
  thematic: v.thematic,
  measuredBy: v.measuredBy,
  canBeAutomatedBy: v.canBeAutomatedBy,
  setCount: v.setCount,
  createdAt: v.createdAt.toISOString(),
  updatedAt: v.updatedAt.toISOString(),
  createdBy: v.createdBy,
  updatedBy: v.updatedBy,
});

const setSummaryOut = (v: SetSummary) => ({
  id: v.id,
  slug: v.slug,
  iri: v.iri,
  name: v.name,
  description: v.description,
  rimoCategory: v.rimoCategory,
  indicatorCount: v.indicatorCount,
  necessityCounts: v.necessityCounts,
  hasEvaluation: v.hasEvaluation,
  createdAt: v.createdAt.toISOString(),
  updatedAt: v.updatedAt.toISOString(),
});

const evaluationOut = (v: EvaluationView) => ({
  setId: v.setId,
  indicatorId: v.indicatorId,
  aggregate: v.aggregate,
  updatedAt: v.updatedAt.toISOString(),
});

const setOut = (v: SetView) => ({
  ...setSummaryOut(v),
  indicators: v.indicators.map((row) => ({
    indicatorId: row.indicatorId,
    slug: row.slug,
    name: row.name,
    necessity: row.necessity,
    valueType: row.valueType,
    unit: row.unit,
    thematic: row.thematic,
    qualitative: row.qualitative,
  })),
  evaluation: v.evaluation ? evaluationOut(v.evaluation) : null,
  createdBy: v.createdBy,
  updatedBy: v.updatedBy,
});

const valueTypeOut = (v: ValueTypeView) => ({
  id: v.id,
  labels: v.labels.de === undefined ? { en: v.labels.en } : { en: v.labels.en, de: v.labels.de },
  numeric: v.numeric,
  ...(v.range && { range: v.range }),
  aggregates: v.aggregates,
});

export function registerKpiRoutes(r: RouteRegistrar, service: KpiFrameworkService) {
  r.internal(listIndicatorsRoute, (async (c) => {
    const { page, pageSize, ...filter } = c.req.valid('query');
    const { indicators, total } = await service.indicators.list(c.get('actor'), filter, {
      page,
      pageSize,
    });
    return c.json(paginate({ page, pageSize }, total, indicators.map(indicatorOut)), 200);
  }) satisfies RouteHandler<typeof listIndicatorsRoute, AppEnv>);

  r.internal(listValueTypesRoute, (async (c) => {
    const types = (await service.indicators.valueTypes(c.get('actor'))).map(valueTypeOut);
    return c.json(
      paginate({ page: 0, pageSize: Math.max(types.length, 1) }, types.length, types),
      200,
    );
  }) satisfies RouteHandler<typeof listValueTypesRoute, AppEnv>);

  r.internal(createIndicatorRoute, (async (c) => {
    return c.json(
      indicatorOut(await service.indicators.create(c.get('actor'), c.req.valid('json'))),
      201,
    );
  }) satisfies RouteHandler<typeof createIndicatorRoute, AppEnv>);

  r.internal(getIndicatorRoute, (async (c) => {
    return c.json(
      indicatorOut(await service.indicators.get(c.get('actor'), c.req.valid('param').id)),
      200,
    );
  }) satisfies RouteHandler<typeof getIndicatorRoute, AppEnv>);

  r.internal(updateIndicatorRoute, (async (c) => {
    const updated = await service.indicators.update(
      c.get('actor'),
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    return c.json(indicatorOut(updated), 200);
  }) satisfies RouteHandler<typeof updateIndicatorRoute, AppEnv>);

  r.internal(deleteIndicatorRoute, (async (c) => {
    await service.indicators.delete(c.get('actor'), c.req.valid('param').id);
    return c.body(null, 204);
  }) satisfies RouteHandler<typeof deleteIndicatorRoute, AppEnv>);

  r.internal(listSetsRoute, (async (c) => {
    const { page, pageSize, ...filter } = c.req.valid('query');
    const { sets, total } = await service.sets.list(c.get('actor'), filter, { page, pageSize });
    return c.json(paginate({ page, pageSize }, total, sets.map(setSummaryOut)), 200);
  }) satisfies RouteHandler<typeof listSetsRoute, AppEnv>);

  r.internal(createSetRoute, (async (c) => {
    return c.json(setOut(await service.sets.create(c.get('actor'), c.req.valid('json'))), 201);
  }) satisfies RouteHandler<typeof createSetRoute, AppEnv>);

  r.internal(getSetRoute, (async (c) => {
    return c.json(setOut(await service.sets.get(c.get('actor'), c.req.valid('param').id)), 200);
  }) satisfies RouteHandler<typeof getSetRoute, AppEnv>);

  r.internal(updateSetRoute, (async (c) => {
    const updated = await service.sets.update(
      c.get('actor'),
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    return c.json(setOut(updated), 200);
  }) satisfies RouteHandler<typeof updateSetRoute, AppEnv>);

  r.internal(deleteSetRoute, (async (c) => {
    await service.sets.delete(c.get('actor'), c.req.valid('param').id);
    return c.body(null, 204);
  }) satisfies RouteHandler<typeof deleteSetRoute, AppEnv>);

  r.internal(setIndicatorsRoute, (async (c) => {
    const updated = await service.sets.setIndicators(
      c.get('actor'),
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    return c.json(setOut(updated), 200);
  }) satisfies RouteHandler<typeof setIndicatorsRoute, AppEnv>);

  r.internal(getEvaluationRoute, (async (c) => {
    const current = await service.evaluation.get(c.get('actor'), c.req.valid('param').id);
    return c.json({ evaluation: current ? evaluationOut(current) : null }, 200);
  }) satisfies RouteHandler<typeof getEvaluationRoute, AppEnv>);

  r.internal(setEvaluationRoute, (async (c) => {
    const saved = await service.evaluation.set(
      c.get('actor'),
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    return c.json(evaluationOut(saved), 200);
  }) satisfies RouteHandler<typeof setEvaluationRoute, AppEnv>);
}
