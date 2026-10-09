// The HTTP routes of registry.organisations (internal API). Thin: Zod parses, one service call, the
// result is mapped. Every route has a permission; the service checks it again (CLAUDE.md, security rules).
import {
  createRoute,
  listEnvelope,
  paginate,
  paginationQuery,
  z,
  type AppEnv,
  type RouteHandler,
} from '@scorpion/contracts';
import { MAX_UPLOAD_BYTES } from '@scorpion/core-blob/public';
import type { RouteRegistrar } from '@scorpion/kernel';
import { createOrganisationSchema, updateOrganisationSchema } from './service/input.ts';
import { serializeJsonLd } from './service/schema-org.ts';
import {
  PERMISSION_MANAGE,
  PERMISSION_READ,
  type OrganisationsService,
  type OrganisationSummary,
  type OrganisationView,
} from './service/organisations.ts';

const ok = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
});
const idParam = z.object({ id: z.uuid() });

const summarySchema = z.object({
  id: z.string(),
  type: z.string(),
  typeKnown: z
    .boolean()
    .describe(
      'False when the type is no longer registered; the organisation cannot be changed then.',
    ),
  abbreviation: z.string(),
  name: z.string(),
  memberCount: z.number().int(),
});

const organisationSchema = summarySchema.extend({
  description: z.string().nullable(),
  website: z.string().nullable(),
  rorId: z.string().nullable().describe('The bare ROR id, for example `02skbsp27`.'),
  sameAs: z.array(z.string()),
  logoUrl: z
    .string()
    .optional()
    .describe(
      'Where the logo is served, below the base path (`/api/internal/files/{hash}`). Absent without a logo. The file is public by its hash.',
    ),
  contactEmail: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The organisation's role address, not a user's. Present only for a reader who may see it.",
    ),
  contactType: z.string().nullable().optional().describe('Present only with `contactEmail`.'),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  createdBy: z.string().nullable().optional().describe('Administrators only.'),
  updatedBy: z.string().nullable().optional().describe('Administrators only.'),
});

/** The Schema.org profile (plan §3). The property names are the whole list; a property without a value is absent. */
const schemaOrgSchema = z.object({
  '@context': z.literal('https://schema.org'),
  '@type': z.string().describe('The `schemaType` of the organisation type.'),
  '@id': z.string().describe('The absolute URL of the organisation page.'),
  name: z.string(),
  alternateName: z.string().optional().describe('The abbreviation.'),
  description: z.string().optional(),
  url: z.string().describe("The organisation's website, else its own page."),
  identifier: z
    .object({
      '@type': z.literal('PropertyValue'),
      propertyID: z.literal('ROR'),
      value: z.string(),
    })
    .optional(),
  sameAs: z.array(z.string()).optional(),
  logo: z.object({ '@type': z.literal('ImageObject'), url: z.string() }).optional(),
  contactPoint: z
    .object({ '@type': z.literal('ContactPoint'), email: z.string(), contactType: z.string() })
    .optional()
    .describe(
      "Only for a reader who may see the contact point: the organisation's role address, not a user's.",
    ),
});

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

const typeSchema = z.object({
  id: z.string(),
  label: z.string().describe('The label for the requested locale, `en` by default.'),
  labels: z.object({ en: z.string(), de: z.string().optional() }),
  membership: z
    .boolean()
    .describe('Whether people may become members of an organisation of this type.'),
  schemaType: z.string(),
  order: z.number().int(),
});

export const listOrganisationsRoute = createRoute({
  method: 'get',
  path: '/organisations',
  permission: PERMISSION_READ,
  request: {
    query: paginationQuery().extend({
      q: z
        .string()
        .max(100)
        .optional()
        .describe('Matches the abbreviation or the name, without case.'),
      type: z.string().max(64).optional(),
    }),
  },
  responses: {
    200: ok('Organisations by abbreviation, then id.', listEnvelope(summarySchema)),
  },
});

export const getOrganisationRoute = createRoute({
  method: 'get',
  path: '/organisations/{id}',
  permission: PERMISSION_READ,
  request: { params: idParam },
  responses: {
    200: ok('One organisation.', organisationSchema),
    404: { description: 'No such organisation.' },
  },
});

export const getSchemaOrgRoute = createRoute({
  method: 'get',
  path: '/organisations/{id}/schema-org',
  permission: PERMISSION_READ,
  request: { params: idParam },
  responses: {
    200: {
      description:
        'The organisation as a Schema.org `Organization` (JSON-LD). `Cache-Control: private, no-cache`: what it holds depends on the reader.',
      content: { 'application/ld+json': { schema: schemaOrgSchema } },
    },
    404: { description: 'No such organisation.' },
  },
});

export const setLogoRoute = createRoute({
  method: 'put',
  path: '/organisations/{id}/logo',
  permission: PERMISSION_MANAGE,
  rateLimit: 'strict',
  maxBodyBytes: MAX_UPLOAD_BYTES,
  audit: true,
  request: { params: idParam, body: imageBody },
  responses: {
    200: ok('The organisation with its new logo.', organisationSchema),
    404: { description: 'No such organisation.' },
    413: { description: 'The body is larger than the upload ceiling.' },
    422: { description: 'The file is empty, too big, not a supported image, or damaged.' },
  },
});

export const clearLogoRoute = createRoute({
  method: 'delete',
  path: '/organisations/{id}/logo',
  permission: PERMISSION_MANAGE,
  audit: true,
  request: { params: idParam },
  responses: {
    200: ok('The organisation without its logo.', organisationSchema),
    404: { description: 'No such organisation, or it has no logo.' },
  },
});

export const createOrganisationRoute = createRoute({
  method: 'post',
  path: '/organisations',
  permission: PERMISSION_MANAGE,
  audit: true,
  request: {
    body: { required: true, content: { 'application/json': { schema: createOrganisationSchema } } },
  },
  responses: {
    201: ok('The organisation.', organisationSchema),
    409: { description: 'The abbreviation, the name or the ROR id is taken.' },
    422: { description: 'Unknown type or invalid input.' },
  },
});

export const updateOrganisationRoute = createRoute({
  method: 'patch',
  path: '/organisations/{id}',
  permission: PERMISSION_MANAGE,
  audit: true,
  request: {
    params: idParam,
    body: { required: true, content: { 'application/json': { schema: updateOrganisationSchema } } },
  },
  responses: {
    200: ok('The organisation after the change.', organisationSchema),
    404: { description: 'No such organisation.' },
    409: {
      description:
        'The abbreviation, the name or the ROR id is taken, the type is not registered, or `organisation-in-use` for a change of type.',
    },
    422: { description: 'Unknown type or invalid input.' },
  },
});

export const deleteOrganisationRoute = createRoute({
  method: 'delete',
  path: '/organisations/{id}',
  permission: PERMISSION_MANAGE,
  audit: true,
  request: { params: idParam },
  responses: {
    204: { description: 'Deleted.' },
    404: { description: 'No such organisation.' },
    409: { description: '`organisation-in-use`: a module still refers to it.' },
  },
});

export const listOrganisationTypesRoute = createRoute({
  method: 'get',
  path: '/organisation-types',
  permission: PERMISSION_READ,
  request: {
    query: z.strictObject({
      locale: z.string().max(35).optional().describe('The locale of `label`. Default `en`.'),
    }),
  },
  responses: {
    200: ok('The registered types, by `order`, then id, all on page 0.', listEnvelope(typeSchema)),
  },
});

const summaryOut = (o: OrganisationSummary) => ({
  id: o.id,
  type: o.type,
  typeKnown: o.typeKnown,
  abbreviation: o.abbreviation,
  name: o.name,
  memberCount: o.memberCount,
});

/** Field by field on purpose: a column added to the table later is not exposed by accident. */
const organisationOut = (o: OrganisationView) => ({
  ...summaryOut(o),
  description: o.description,
  website: o.website,
  rorId: o.rorId,
  sameAs: o.sameAs,
  ...(o.logoUrl !== undefined && { logoUrl: o.logoUrl }),
  ...(o.contactEmail !== undefined && { contactEmail: o.contactEmail, contactType: o.contactType }),
  createdAt: o.createdAt.toISOString(),
  updatedAt: o.updatedAt.toISOString(),
  ...(o.createdBy !== undefined && { createdBy: o.createdBy, updatedBy: o.updatedBy }),
});

export function registerOrganisationRoutes(r: RouteRegistrar, service: OrganisationsService) {
  r.internal(listOrganisationsRoute, (async (c) => {
    const { page, pageSize, ...filter } = c.req.valid('query');
    const { organisations, total } = await service.list(c.get('actor'), filter, { page, pageSize });
    return c.json(paginate({ page, pageSize }, total, organisations.map(summaryOut)), 200);
  }) satisfies RouteHandler<typeof listOrganisationsRoute, AppEnv>);

  r.internal(listOrganisationTypesRoute, (async (c) => {
    const types = await service.listTypes(c.get('actor'), c.req.valid('query').locale);
    return c.json(
      paginate({ page: 0, pageSize: Math.max(types.length, 1) }, types.length, types),
      200,
    );
  }) satisfies RouteHandler<typeof listOrganisationTypesRoute, AppEnv>);

  r.internal(getOrganisationRoute, (async (c) => {
    return c.json(organisationOut(await service.get(c.get('actor'), c.req.valid('param').id)), 200);
  }) satisfies RouteHandler<typeof getOrganisationRoute, AppEnv>);

  r.internal(getSchemaOrgRoute, (async (c) => {
    const profile = await service.schemaOrg(c.get('actor'), c.req.valid('param').id);
    // The only way the profile becomes a string (`serializeJsonLd`), also for a plain API answer.
    return new Response(serializeJsonLd(profile), {
      status: 200,
      headers: {
        'content-type': 'application/ld+json; charset=utf-8',
        // The contact point depends on the reader: no shared cache may keep it.
        'cache-control': 'private, no-cache',
        'x-content-type-options': 'nosniff',
      },
    });
  }) satisfies RouteHandler<typeof getSchemaOrgRoute, AppEnv>);

  r.internal(setLogoRoute, (async (c) => {
    // The body is capped by the route (`maxBodyBytes`); the service checks the caller first, then the file.
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    return c.json(
      organisationOut(await service.setLogo(c.get('actor'), c.req.valid('param').id, bytes)),
      200,
    );
  }) satisfies RouteHandler<typeof setLogoRoute, AppEnv>);

  r.internal(clearLogoRoute, (async (c) => {
    return c.json(
      organisationOut(await service.clearLogo(c.get('actor'), c.req.valid('param').id)),
      200,
    );
  }) satisfies RouteHandler<typeof clearLogoRoute, AppEnv>);

  r.internal(createOrganisationRoute, (async (c) => {
    return c.json(organisationOut(await service.create(c.get('actor'), c.req.valid('json'))), 201);
  }) satisfies RouteHandler<typeof createOrganisationRoute, AppEnv>);

  r.internal(updateOrganisationRoute, (async (c) => {
    const updated = await service.update(
      c.get('actor'),
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    return c.json(organisationOut(updated), 200);
  }) satisfies RouteHandler<typeof updateOrganisationRoute, AppEnv>);

  r.internal(deleteOrganisationRoute, (async (c) => {
    await service.delete(c.get('actor'), c.req.valid('param').id);
    return c.body(null, 204);
  }) satisfies RouteHandler<typeof deleteOrganisationRoute, AppEnv>);
}
