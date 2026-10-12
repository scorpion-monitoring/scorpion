// The HTTP routes of registry.services (internal API). Thin: Zod parses, one service call, the result is
// mapped. Every route has a permission; the service checks it again (CLAUDE.md, security rules). Sprint 1
// has no public route and no screen.
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
  PERMISSION_MANAGE,
  PERMISSION_READ,
  SORT_KEYS,
  type RoleView,
  type ServicesService,
  type ServiceSummary,
  type ServiceView,
} from './service/services.ts';

const ok = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
});
const idParam = z.object({ id: z.uuid() });

/** The most a create body may weigh: the longest values are 4000 characters, the lists are short. */
export const MAX_CREATE_BODY_BYTES = 64 * 1024;

const organisationSchema = z.object({
  role: z.string().describe('A key of the registry `service.orgRole`.'),
  id: z.string(),
  abbreviation: z.string(),
  name: z.string(),
});

const summarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  stage: z.string().describe('A term of the `stage` vocabulary.'),
  license: z.string().nullable().describe('An SPDX licence id.'),
  iconUrl: z
    .string()
    .optional()
    .describe('Where the icon is served, below the base path. Absent without an icon.'),
  public: z.boolean(),
  organisations: z.array(organisationSchema),
});

const serviceSchema = summarySchema.extend({
  description: z.string().nullable(),
  url: z.string().nullable(),
  sameAs: z.array(z.string()),
  values: z
    .record(z.string(), z.unknown())
    .describe('The values of the configured fields that are not columns, by field key.'),
  contactEmail: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The service's role address, not a user's. Present only for a reader who may see it.",
    ),
  contactType: z.string().nullable().optional().describe('Present only with `contactEmail`.'),
  redirectedFrom: z
    .string()
    .optional()
    .describe(
      'Present when the slug asked for is an old one; the record is under its current slug.',
    ),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  createdBy: z.string().nullable().optional().describe('Administrators only.'),
  updatedBy: z.string().nullable().optional().describe('Administrators only.'),
});

/**
 * The body of a create is the nested form object of the wizard (ADR-0035): the fields of the shipped
 * configuration are documented here, and a deployment's own fields are accepted at their configured
 * paths. The service validates every value and refuses a key it does not know (422).
 */
export const createServiceBody = z.looseObject({
  slug: z.string().max(200).describe('Letters, digits, ".", "_" and "-"; not shaped like a UUID.'),
  name: z.string().max(1000),
  license: z.string().max(256).optional().describe('An SPDX licence id, for example `Apache-2.0`.'),
  stage: z
    .string()
    .max(256)
    .optional()
    .describe('A term of the `stage` vocabulary. Default `DEV`.'),
  description: z.string().max(20_000).optional(),
  url: z.string().max(4000).optional(),
  sameAs: z.array(z.string().max(4000)).max(100).optional(),
  provider: z.uuid().describe('The id of an organisation that may take the role `provider`.'),
  consortia: z.array(z.uuid()).max(100).optional(),
  contact: z
    .object({
      email: z.string().max(1000).optional(),
      type: z.string().max(1000).optional(),
    })
    .optional()
    .describe('Both parts or neither.'),
});

const roleSchema = z.object({
  id: z.string(),
  label: z.string().describe('The label for the requested locale, `en` by default.'),
  labels: z.object({ en: z.string(), de: z.string().optional() }),
  orgTypes: z.array(z.string()).describe('The organisation types that may take the role.'),
  min: z.number().int(),
  max: z.number().int(),
  order: z.number().int(),
});

const licenceSchema = z.object({
  id: z.string(),
  name: z.string(),
  osiApproved: z.boolean(),
  deprecated: z.boolean().describe('A deprecated id is accepted for a service, and marked.'),
});

export const listServicesRoute = createRoute({
  method: 'get',
  path: '/services',
  permission: PERMISSION_READ,
  request: {
    query: paginationQuery().extend({
      q: z.string().max(100).optional().describe('Matches the slug or the name, without case.'),
      sort: z.enum(SORT_KEYS).optional().describe('Default `name`.'),
      dir: z.enum(['asc', 'desc']).optional().describe('Default `asc`. Ties are broken by id.'),
    }),
  },
  responses: {
    200: ok('Services in the order asked for, then by id.', listEnvelope(summarySchema)),
  },
});

export const getServiceBySlugRoute = createRoute({
  method: 'get',
  path: '/services/by-slug/{slug}',
  permission: PERMISSION_READ,
  request: { params: z.object({ slug: z.string().min(1).max(200) }) },
  responses: {
    200: ok(
      'The service. An old slug answers the current record with `redirectedFrom`.',
      serviceSchema,
    ),
    404: { description: 'No service has or had this slug.' },
  },
});

export const getServiceRoute = createRoute({
  method: 'get',
  path: '/services/{id}',
  permission: PERMISSION_READ,
  request: { params: idParam },
  responses: {
    200: ok('One service.', serviceSchema),
    404: { description: 'No such service.' },
  },
});

export const createServiceRoute = createRoute({
  method: 'post',
  path: '/services',
  // Sprint 1: Admin only. Sprint 2 changes the permission to `…service.create` and adds the rule that
  // the caller is an Admin or an approved member of the provider (ADR-0036).
  permission: PERMISSION_MANAGE,
  audit: true,
  maxBodyBytes: MAX_CREATE_BODY_BYTES,
  request: {
    body: { required: true, content: { 'application/json': { schema: createServiceBody } } },
  },
  responses: {
    201: ok('The service, created with its organisations in one transaction.', serviceSchema),
    409: { description: 'The slug is taken, or was used by another service once.' },
    422: {
      description:
        'Invalid input: an unknown or wrong-typed organisation, stage or licence, a missing provider, a bad slug.',
    },
  },
});

export const listLicencesRoute = createRoute({
  method: 'get',
  path: '/licenses',
  permission: PERMISSION_READ,
  request: {
    query: z.strictObject({
      q: z.string().max(100).optional().describe('Matches the SPDX id or the name, without case.'),
      limit: z.coerce.number().int().min(1).max(100).optional().describe('Default 20.'),
    }),
  },
  responses: {
    200: ok(
      'SPDX licences for the licence field: exact id first, then prefix, then the rest; all on page 0.',
      listEnvelope(licenceSchema),
    ),
  },
});

export const listServiceRolesRoute = createRoute({
  method: 'get',
  path: '/service-roles',
  permission: PERMISSION_READ,
  request: {
    query: z.strictObject({
      locale: z.string().max(35).optional().describe('The locale of `label`. Default `en`.'),
    }),
  },
  responses: {
    200: ok(
      'The roles an organisation can play on a service, by `order`, all on page 0.',
      listEnvelope(roleSchema),
    ),
  },
});

const summaryOut = (s: ServiceSummary) => ({
  id: s.id,
  slug: s.slug,
  name: s.name,
  stage: s.stage,
  license: s.license,
  ...(s.iconUrl !== undefined && { iconUrl: s.iconUrl }),
  public: s.public,
  organisations: s.organisations.map(({ role, id, abbreviation, name }) => ({
    role,
    id,
    abbreviation,
    name,
  })),
});

/** Field by field on purpose: a column added to the table later is not exposed by accident. */
const serviceOut = (s: ServiceView) => ({
  ...summaryOut(s),
  description: s.description,
  url: s.url,
  sameAs: s.sameAs,
  values: s.values,
  ...(s.contactEmail !== undefined && { contactEmail: s.contactEmail, contactType: s.contactType }),
  ...(s.redirectedFrom !== undefined && { redirectedFrom: s.redirectedFrom }),
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
  ...(s.createdBy !== undefined && { createdBy: s.createdBy, updatedBy: s.updatedBy }),
});

const roleOut = (r: RoleView) => ({
  id: r.id,
  label: r.label,
  labels: r.labels,
  orgTypes: r.orgTypes,
  min: r.min,
  max: r.max,
  order: r.order,
});

export function registerServiceRoutes(r: RouteRegistrar, service: ServicesService) {
  r.internal(listServicesRoute, (async (c) => {
    const { page, pageSize, ...filter } = c.req.valid('query');
    const { services, total } = await service.list(c.get('actor'), filter, { page, pageSize });
    return c.json(paginate({ page, pageSize }, total, services.map(summaryOut)), 200);
  }) satisfies RouteHandler<typeof listServicesRoute, AppEnv>);

  r.internal(listLicencesRoute, (async (c) => {
    const { q, limit } = c.req.valid('query');
    const licences = await service.searchLicences(c.get('actor'), q ?? '', limit);
    return c.json(
      paginate({ page: 0, pageSize: Math.max(licences.length, 1) }, licences.length, licences),
      200,
    );
  }) satisfies RouteHandler<typeof listLicencesRoute, AppEnv>);

  r.internal(listServiceRolesRoute, (async (c) => {
    const roles = await service.listRoles(c.get('actor'), c.req.valid('query').locale);
    return c.json(
      paginate({ page: 0, pageSize: Math.max(roles.length, 1) }, roles.length, roles.map(roleOut)),
      200,
    );
  }) satisfies RouteHandler<typeof listServiceRolesRoute, AppEnv>);

  r.internal(getServiceBySlugRoute, (async (c) => {
    return c.json(
      serviceOut(await service.getBySlug(c.get('actor'), c.req.valid('param').slug)),
      200,
    );
  }) satisfies RouteHandler<typeof getServiceBySlugRoute, AppEnv>);

  r.internal(getServiceRoute, (async (c) => {
    return c.json(serviceOut(await service.get(c.get('actor'), c.req.valid('param').id)), 200);
  }) satisfies RouteHandler<typeof getServiceRoute, AppEnv>);

  r.internal(createServiceRoute, (async (c) => {
    return c.json(serviceOut(await service.create(c.get('actor'), c.req.valid('json'))), 201);
  }) satisfies RouteHandler<typeof createServiceRoute, AppEnv>);
}
