// The HTTP routes of registry.services (internal API). Thin: Zod parses, one service call, the result is
// mapped. Every route has a permission; the service checks it again (CLAUDE.md, security rules). The
// delegated routes (`PATCH /services/{id}` and the icon) carry the plain `…service.read` and the service
// decides with the policy `service.member` (ADR-0034, ADR-0036). The public routes (`/public/…`) read only what a Reviewer made public (ADR-0036 part 2).
import {
  createRoute,
  NotFound,
  listEnvelope,
  paginate,
  paginationQuery,
  z,
  type AppEnv,
  type RouteHandler,
} from '@scorpion/contracts';
import { MAX_UPLOAD_BYTES } from '@scorpion/core-blob/public';
import type { RouteRegistrar } from '@scorpion/kernel';
import { serializeJsonLd } from '@scorpion/registry-organisations/public';
import type { CatalogueRow } from './service/catalogue.ts';
import { MAX_CREATE_BODY_BYTES } from './service/create-schema.ts';
import { CONTRIBUTABLE_PROPERTIES } from './service/schema-org.ts';
import {
  PERMISSION_CREATE,
  PERMISSION_PUBLISH,
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

export { MAX_CREATE_BODY_BYTES };

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

const catalogueOrganisationSchema = z.object({
  id: z.string(),
  abbreviation: z.string(),
  name: z.string(),
});

/** A row of the catalogue: never the contact point, `sameAs` or the description. */
const catalogueRowSchema = summarySchema.omit({ organisations: true }).extend({
  provider: catalogueOrganisationSchema.nullable(),
  consortia: z.array(catalogueOrganisationSchema),
});

const facetSchema = z.object({
  id: z.string().describe('A key of the registry `service.facet`; also the name of its filter.'),
  label: z.string(),
  labels: z.object({ en: z.string(), de: z.string().optional() }),
  values: z.array(
    z.object({
      key: z.string().describe('What to send as the filter; `:none` for the services with none.'),
      label: z.string(),
      count: z.number().int(),
      selected: z.boolean(),
      empty: z.literal(true).optional().describe('Set on the value that stands for "none".'),
    }),
  ),
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
  editableFields: z
    .array(z.string())
    .describe(
      'The keys of the fields the caller may write on this service: everything for an administrator, everything for a manager of the provider, everything but `slug` and `provider` for another member of it, nothing for anybody else. Screens draw their form from this; the server still refuses what is not allowed.',
    ),
  allowedActions: z
    .array(z.enum(['edit', 'publish', 'unpublish']))
    .describe(
      'What the caller may do with this service now. Screens draw their buttons from this.',
    ),
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

/**
 * The body of an update is a part of the same nested object: the fields it names change, the others are not
 * touched, and `null` clears an optional field. A field its caller may not write refuses the whole request.
 */
export const patchServiceBody = z.looseObject({
  slug: z
    .string()
    .max(200)
    .optional()
    .describe('Managers of the provider and administrators only.'),
  name: z.string().max(1000).optional(),
  license: z.string().max(256).nullable().optional(),
  stage: z.string().max(256).optional(),
  description: z.string().max(20_000).nullable().optional(),
  url: z.string().max(4000).nullable().optional(),
  sameAs: z.array(z.string().max(4000)).max(100).nullable().optional(),
  provider: z
    .uuid()
    .optional()
    .describe(
      'Managers of the provider and administrators only; a manager may move the service only to an organisation they manage.',
    ),
  consortia: z.array(z.uuid()).max(100).nullable().optional(),
  contact: z
    .object({
      email: z.string().max(1000).nullable().optional(),
      type: z.string().max(1000).nullable().optional(),
    })
    .optional()
    .describe('Both parts or neither; `null` in both clears the contact point.'),
});

const organisationNodeSchema = z.object({
  '@type': z.string(),
  '@id': z.string(),
  name: z.string(),
  url: z.string(),
});
const propertyValueSchema = z.union([z.string(), z.array(z.string())]);

/** The Schema.org `Service` profile (plan §3). The names are the whole list; a property without a value is absent. */
const schemaOrgSchema = z.object({
  '@context': z.literal('https://schema.org'),
  '@type': z.literal('Service'),
  '@id': z
    .string()
    .describe('The absolute URL of the service by id; stable across a rename of the slug.'),
  name: z.string(),
  alternateName: z.string().describe('The slug.'),
  description: z.string().optional(),
  url: z.string().optional().describe("The service's own address."),
  sameAs: z.array(z.string()).optional(),
  logo: z.object({ '@type': z.literal('ImageObject'), url: z.string() }).optional(),
  license: z.string().optional().describe('The SPDX licence page, for an id the list knows.'),
  provider: organisationNodeSchema.optional(),
  brand: z.array(organisationNodeSchema).optional().describe('The consortia.'),
  ...Object.fromEntries(
    CONTRIBUTABLE_PROPERTIES.map((name) => [name, propertyValueSchema.optional()]),
  ),
});

/**
 * The public service record (ADR-0036 part 2): a pinned list. A test walks this schema and fails when a field is
 * added to it without the ADR and the field table, and when a private field (contact point, `editableFields`,
 * `allowedActions`, `values`, `public`, an audit column, `published_*`) appears.
 */
const publicOrganisationRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  public: z.literal(true).describe('An organisation of a public service is public.'),
});
export const publicServiceSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  logoUrl: z.string().optional().describe('Below the base path. Absent without an icon.'),
  description: z.string().nullable(),
  url: z.string().nullable(),
  sameAs: z.array(z.string()),
  license: z.string().nullable().describe('An SPDX licence id.'),
  stage: z.string().describe('A term of the `stage` vocabulary.'),
  provider: publicOrganisationRefSchema,
  consortia: z.array(publicOrganisationRefSchema),
});

/** The cache lifetime of a public answer, in seconds: the only delay before an unpublish is seen (ADR-0036). */
export const PUBLIC_MAX_AGE_SECONDS = 60;
export const PUBLIC_CACHE_CONTROL = `public, max-age=${PUBLIC_MAX_AGE_SECONDS}`;

const publicRefParam = z.object({
  ref: z.string().max(200).describe('The id or the slug (an old slug works) of a public service.'),
});
const PUBLIC_NOT_FOUND = 'There is no such service.';
const PUBLIC_REASON =
  'Anyone may read a service that a Reviewer or an administrator made public; for every other service, an unknown one, and when public reads are switched off (`service.allowPublic`), the answer is the same 404, so existence is not revealed.';

const imageBody = {
  required: true as const,
  description:
    'The image as the request body (PNG, JPEG, WebP, GIF or SVG). Its `Content-Type` is ignored: the type is determined from the content, and the file is checked and rewritten before it is stored.',
  content: {
    'application/octet-stream': {
      schema: z.string().openapi({ type: 'string', format: 'binary' }),
    },
  },
};

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

/** What a repeated query parameter arrives as: one text, or a list when it is given more than once. */
const filterParam = z.union([z.string().max(100), z.array(z.string().max(100)).max(50)]).optional();

/** The parameters that are not filters; everything else a request names is a facet of the registry `service.facet`. */
const NOT_FILTERS = new Set([
  ...Object.keys(paginationQuery().shape),
  'q',
  'sort',
  'dir',
  'locale',
]);

const filtersShape = {
  q: z.string().max(100).optional().describe('Matches the slug or the name, without case.'),
  consortium: filterParam.describe(
    'Organisation ids; repeat to choose several (OR). `:none` stands for the services that have none.',
  ),
  stage: filterParam.describe('Terms of the `stage` vocabulary; repeat to choose several (OR).'),
  license: filterParam.describe(
    'SPDX licence ids; repeat to choose several (OR). `:none` stands for the services with no licence.',
  ),
  provider: filterParam.describe('Organisation ids; repeat to choose several (OR).'),
  locale: z.string().max(35).optional().describe('The locale of the labels. Default `en`.'),
};

/**
 * The query of the catalogue and of its facets. Beyond the four filters named here, the id of any facet another
 * module contributes is a filter too; a name that is no facet is a 422, and so is a value that names nothing.
 */
const catalogueQuery = z.looseObject({
  ...filtersShape,
  sort: z
    .enum(SORT_KEYS)
    .optional()
    .describe("Default `name`. `provider` sorts by the provider's name."),
  dir: z.enum(['asc', 'desc']).optional().describe('Default `asc`. Ties are broken by id.'),
});

const facetsQuery = z.looseObject(filtersShape);

export const listServicesRoute = createRoute({
  method: 'get',
  path: '/services',
  permission: PERMISSION_READ,
  request: {
    query: z.looseObject({ ...paginationQuery().shape, ...catalogueQuery.shape }),
  },
  responses: {
    200: ok(
      'Services in the order asked for, then by id; each service once, with its provider and its consortia (none, one or many).',
      listEnvelope(catalogueRowSchema),
    ),
    422: {
      description:
        'A filter that is not a facet, or a value that names nothing (an unknown organisation, stage or licence).',
    },
  },
});

export const listServiceFacetsRoute = createRoute({
  method: 'get',
  path: '/services/facets',
  permission: PERMISSION_READ,
  request: { query: facetsQuery },
  responses: {
    200: ok(
      'The facets by `order`, all on page 0. The counts of a facet are over the services that the search and every other facet leave; a value with no service shows only when it is chosen.',
      listEnvelope(facetSchema),
    ),
    422: { description: 'As for the list.' },
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

export const getServiceSchemaOrgRoute = createRoute({
  method: 'get',
  path: '/services/{id}/schema-org',
  permission: PERMISSION_READ,
  request: { params: idParam },
  responses: {
    200: {
      description:
        'The service as a Schema.org `Service` (JSON-LD), private services included, never the contact point or the stage. `Cache-Control: private, no-cache`.',
      content: { 'application/ld+json': { schema: schemaOrgSchema } },
    },
    404: { description: 'No such service.' },
  },
});

export const getPublicServiceRoute = createRoute({
  method: 'get',
  path: '/public/services/{ref}',
  public: true,
  publicReason: PUBLIC_REASON,
  request: { params: publicRefParam },
  responses: {
    200: {
      description: `The public record of the service. \`Cache-Control: ${PUBLIC_CACHE_CONTROL}\`: an unpublish takes effect here after at most that long.`,
      content: { 'application/json': { schema: publicServiceSchema } },
    },
    404: {
      description:
        'No such service, not public, or public reads are switched off. The body is the same for all three.',
    },
  },
});

export const getPublicServiceSchemaOrgRoute = createRoute({
  method: 'get',
  path: '/public/services/{ref}/schema-org',
  public: true,
  publicReason: PUBLIC_REASON,
  request: { params: publicRefParam },
  responses: {
    200: {
      description: `The public service as a Schema.org \`Service\` (JSON-LD). \`Cache-Control: ${PUBLIC_CACHE_CONTROL}\`.`,
      content: { 'application/ld+json': { schema: schemaOrgSchema } },
    },
    404: {
      description: 'As for the public record: the same body for every service that is not public.',
    },
  },
});

export const createServiceRoute = createRoute({
  method: 'post',
  path: '/services',
  // Every User holds `create`; the service then requires an Admin or an approved member of the provider
  // (Decision 14), and answers 403 to anybody else.
  permission: PERMISSION_CREATE,
  audit: true,
  maxBodyBytes: MAX_CREATE_BODY_BYTES,
  request: {
    body: { required: true, content: { 'application/json': { schema: createServiceBody } } },
  },
  responses: {
    201: ok('The service, created with its organisations in one transaction.', serviceSchema),
    403: { description: 'The caller is neither an administrator nor a member of the provider.' },
    409: { description: 'The slug is taken, or was used by another service once.' },
    422: {
      description:
        'Invalid input: an unknown or wrong-typed organisation, stage or licence, a missing provider, a bad slug.',
    },
  },
});

export const updateServiceRoute = createRoute({
  method: 'patch',
  path: '/services/{id}',
  // ADR-0034: delegated. The plain permission lets every signed-in person reach the service, which checks
  // the scoped `edit` (and `edit-identity` for the slug and the provider) on this service and is the
  // authorization.
  permission: PERMISSION_READ,
  audit: true,
  maxBodyBytes: MAX_CREATE_BODY_BYTES,
  request: {
    params: idParam,
    body: { required: true, content: { 'application/json': { schema: patchServiceBody } } },
  },
  responses: {
    200: ok('The service with its changes.', serviceSchema),
    403: {
      description:
        'The caller may not change a field the request names. The whole request is refused, nothing is written, and the problem names fields, never values.',
    },
    404: { description: 'No such service.' },
    409: { description: 'The new slug is taken, or was used by another service once.' },
    422: {
      description: 'Invalid input, an unknown organisation, stage or licence, or no field named.',
    },
  },
});

export const setIconRoute = createRoute({
  method: 'put',
  path: '/services/{id}/icon',
  // ADR-0034: delegated, as the organisation's logo: the service checks `…service.edit` on this service
  // before the file is stored.
  permission: PERMISSION_READ,
  rateLimit: 'strict',
  maxBodyBytes: MAX_UPLOAD_BYTES,
  audit: true,
  request: { params: idParam, body: imageBody },
  responses: {
    200: ok('The service with its new icon.', serviceSchema),
    403: { description: 'The caller may not edit this service.' },
    404: { description: 'No such service.' },
    413: { description: 'The body is larger than the upload ceiling.' },
    422: { description: 'The file is empty, too big, not a supported image, or damaged.' },
  },
});

export const clearIconRoute = createRoute({
  method: 'delete',
  path: '/services/{id}/icon',
  permission: PERMISSION_READ, // delegated, see `setIconRoute`
  audit: true,
  request: { params: idParam },
  responses: {
    200: ok('The service without its icon.', serviceSchema),
    403: { description: 'The caller may not edit this service.' },
    404: { description: 'No such service, or it has no icon.' },
  },
});

export const setPublicationRoute = createRoute({
  method: 'put',
  path: '/services/{id}/publication',
  // Reviewers and Admin only: a manager or a member of the provider cannot change who may read the service.
  permission: PERMISSION_PUBLISH,
  audit: true,
  request: {
    params: idParam,
    body: {
      required: true,
      content: { 'application/json': { schema: z.strictObject({ public: z.boolean() }) } },
    },
  },
  responses: {
    200: ok(
      'The service. Setting the state it already has changes nothing and sends no event.',
      serviceSchema,
    ),
    404: { description: 'No such service.' },
    409: { description: 'Making a service public is switched off (`service.allowPublic`).' },
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

const choiceSchema = z.object({
  value: z.string(),
  label: z.string().optional().describe('Text that is ready to show, in the language asked for.'),
  labelKey: z
    .string()
    .optional()
    .describe('A key of the message catalogue, for an option the config lists.'),
});

const schemaFieldSchema = z.object({
  key: z.string(),
  path: z.string().describe('A JSON pointer into the one nested form object: `/contact/type`.'),
  type: z.string().describe('A key of the registry `service.fieldType`.'),
  widget: z.string().describe('The widget the page draws the field with.'),
  label: z.string().describe('A key of the message catalogue.'),
  help: z.string().optional().describe('A key of the message catalogue.'),
  required: z.boolean(),
  default: z.unknown().optional(),
  config: z.record(z.string(), z.unknown()),
  role: z
    .string()
    .optional()
    .describe('For an organisation field: the key of its role in `service.orgRole`.'),
  deferred: z.boolean().describe('Not part of the create body: the value is set afterwards.'),
  choices: z.array(choiceSchema).optional(),
});

const schemaStepSchema = z.object({
  id: z.string(),
  order: z.number().int(),
  title: z.string().describe('A key of the message catalogue.'),
  intro: z.array(z.string()).describe('Keys of the paragraphs above the fields.'),
  component: z.string().optional(),
  contributed: z.boolean().describe('The step comes from another module.'),
  fields: z.array(schemaFieldSchema),
  schema: z
    .record(z.string(), z.unknown())
    .describe(
      'A JSON Schema (an object with the fields at their pointers). The browser checks a step against it before it lets the person go on; the server validates the same fields with the Zod schemas of the same field types.',
    ),
});

const createSchemaSchema = z.object({
  steps: z.array(schemaStepSchema).describe('In the order of the wizard.'),
  limits: z.object({
    sameAs: z.number().int(),
    slug: z.number().int(),
    name: z.number().int(),
    description: z.number().int(),
    url: z.number().int(),
    email: z.number().int(),
    contactKind: z.number().int().describe('The kind of the contact point, such as `support`.'),
    bodyBytes: z.number().int(),
  }),
  fieldTypes: z.array(
    z.object({
      id: z.string(),
      widget: z.string(),
      labels: z.object({ en: z.string(), de: z.string().optional() }),
    }),
  ),
  roles: z.array(
    roleSchema.omit({ label: true }).extend({ label: z.string(), memberOnly: z.boolean() }),
  ),
  defaults: z.record(z.string(), z.unknown()).describe('The object a new form starts from.'),
  devConsole: z
    .boolean()
    .describe(
      'True only when the server does not run in production: the JSON console may be shown.',
    ),
});

export const getCreateSchemaRoute = createRoute({
  method: 'get',
  path: '/services/schema',
  // The schema serves the wizard, whose page needs this permission; it holds nothing of any person or service.
  permission: PERMISSION_CREATE,
  request: {
    query: z.strictObject({
      locale: z.string().max(35).optional().describe('The locale of the labels. Default `en`.'),
    }),
  },
  responses: {
    200: ok(
      'The steps, fields, limits and registry data of the create wizard.',
      createSchemaSchema,
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

/** The filters of a request: every parameter that is not the search, the sort or the page, as a list of values. */
function filtersOf(params: Record<string, unknown>): Record<string, string[]> {
  const filters: Record<string, string[]> = {};
  for (const [name, value] of Object.entries(params)) {
    if (NOT_FILTERS.has(name) || value === undefined) continue;
    // The schema allows a text or a list of texts; anything else is not a filter value and the service refuses it.
    filters[name] = (Array.isArray(value) ? value : [value]).map((entry) =>
      typeof entry === 'string' ? entry : '',
    );
  }
  return filters;
}

const rowOut = (s: CatalogueRow) => ({
  id: s.id,
  slug: s.slug,
  name: s.name,
  stage: s.stage,
  license: s.license,
  ...(s.iconUrl !== undefined && { iconUrl: s.iconUrl }),
  public: s.public,
  provider: s.provider && {
    id: s.provider.id,
    abbreviation: s.provider.abbreviation,
    name: s.provider.name,
  },
  consortia: s.consortia.map(({ id, abbreviation, name }) => ({ id, abbreviation, name })),
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
  editableFields: s.editableFields,
  allowedActions: s.allowedActions,
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
    const { page, pageSize, locale, q, sort, dir, ...rest } = c.req.valid('query');
    const { services, total } = await service.list(
      c.get('actor'),
      { q, sort, dir, filters: filtersOf(rest) },
      { page, pageSize },
      locale,
    );
    return c.json(paginate({ page, pageSize }, total, services.map(rowOut)), 200);
  }) satisfies RouteHandler<typeof listServicesRoute, AppEnv>);

  r.internal(listServiceFacetsRoute, (async (c) => {
    const { locale, q, ...rest } = c.req.valid('query');
    const facets = await service.facets(c.get('actor'), { q, filters: filtersOf(rest) }, locale);
    return c.json(
      paginate({ page: 0, pageSize: Math.max(facets.length, 1) }, facets.length, facets),
      200,
    );
  }) satisfies RouteHandler<typeof listServiceFacetsRoute, AppEnv>);

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

  // Before `/services/{id}`: a path with one more segment is never an id.
  r.internal(getCreateSchemaRoute, (async (c) => {
    return c.json(await service.createSchema(c.get('actor'), c.req.valid('query').locale), 200);
  }) satisfies RouteHandler<typeof getCreateSchemaRoute, AppEnv>);

  r.internal(getServiceBySlugRoute, (async (c) => {
    return c.json(
      serviceOut(await service.getBySlug(c.get('actor'), c.req.valid('param').slug)),
      200,
    );
  }) satisfies RouteHandler<typeof getServiceBySlugRoute, AppEnv>);

  r.internal(getServiceRoute, (async (c) => {
    return c.json(serviceOut(await service.get(c.get('actor'), c.req.valid('param').id)), 200);
  }) satisfies RouteHandler<typeof getServiceRoute, AppEnv>);

  r.internal(getServiceSchemaOrgRoute, (async (c) => {
    const profile = await service.schemaOrg(c.get('actor'), c.req.valid('param').id);
    // The only way the profile becomes a string (`serializeJsonLd`), also for a plain API answer.
    return new Response(serializeJsonLd(profile), {
      status: 200,
      headers: {
        'content-type': 'application/ld+json; charset=utf-8',
        'cache-control': 'private, no-cache',
        'x-content-type-options': 'nosniff',
      },
    });
  }) satisfies RouteHandler<typeof getServiceSchemaOrgRoute, AppEnv>);

  r.internal(getPublicServiceRoute, (async (c) => {
    const record = await service.getPublicAsSystem(c.req.valid('param').ref);
    if (!record) throw new NotFound(PUBLIC_NOT_FOUND);
    // Field by field on purpose: a field added to the record later is not public by accident.
    return c.json(
      {
        id: record.id,
        slug: record.slug,
        name: record.name,
        ...(record.logoUrl !== undefined && { logoUrl: record.logoUrl }),
        description: record.description,
        url: record.url,
        sameAs: record.sameAs,
        license: record.license,
        stage: record.stage,
        provider: record.provider,
        consortia: record.consortia,
      },
      200,
      { 'cache-control': PUBLIC_CACHE_CONTROL },
    );
  }) satisfies RouteHandler<typeof getPublicServiceRoute, AppEnv>);

  r.internal(getPublicServiceSchemaOrgRoute, (async (c) => {
    const profile = await service.schemaOrgPublicAsSystem(c.req.valid('param').ref);
    if (!profile) throw new NotFound(PUBLIC_NOT_FOUND);
    return new Response(serializeJsonLd(profile), {
      status: 200,
      headers: {
        'content-type': 'application/ld+json; charset=utf-8',
        'cache-control': PUBLIC_CACHE_CONTROL,
        'x-content-type-options': 'nosniff',
      },
    });
  }) satisfies RouteHandler<typeof getPublicServiceSchemaOrgRoute, AppEnv>);

  r.internal(createServiceRoute, (async (c) => {
    return c.json(serviceOut(await service.create(c.get('actor'), c.req.valid('json'))), 201);
  }) satisfies RouteHandler<typeof createServiceRoute, AppEnv>);

  r.internal(updateServiceRoute, (async (c) => {
    const { id } = c.req.valid('param');
    return c.json(serviceOut(await service.update(c.get('actor'), id, c.req.valid('json'))), 200);
  }) satisfies RouteHandler<typeof updateServiceRoute, AppEnv>);

  r.internal(setIconRoute, (async (c) => {
    const { id } = c.req.valid('param');
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    return c.json(serviceOut(await service.setIcon(c.get('actor'), id, bytes)), 200);
  }) satisfies RouteHandler<typeof setIconRoute, AppEnv>);

  r.internal(clearIconRoute, (async (c) => {
    return c.json(
      serviceOut(await service.clearIcon(c.get('actor'), c.req.valid('param').id)),
      200,
    );
  }) satisfies RouteHandler<typeof clearIconRoute, AppEnv>);

  r.internal(setPublicationRoute, (async (c) => {
    const { id } = c.req.valid('param');
    return c.json(
      serviceOut(await service.setPublication(c.get('actor'), id, c.req.valid('json'))),
      200,
    );
  }) satisfies RouteHandler<typeof setPublicationRoute, AppEnv>);
}
