// The internal routes of the publications of a service (ADR-0056). Thin: Zod parses and bounds the input, one service
// call, the answer is mapped field by field. The write routes are delegated (ADR-0034): they carry the plain read, which
// keeps out anyone who is not signed in, and the service checks the scoped `bibliometrics.publication.write` on the
// service, so a person of another provider is 403. Every answer is `no-store`: it depends on who asks.
import {
  createRoute,
  listEnvelope,
  paginate,
  paginationQuery,
  z,
  type AppEnv,
  type Context,
  type RouteHandler,
} from '@scorpion/contracts';
import { DOI_MAX_INPUT_LENGTH } from '@scorpion/integrations';
import type { RouteRegistrar } from '@scorpion/kernel';
import { PERMISSION_READ } from './service/permissions.ts';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type Publication,
  type PublicationsService,
} from './service/publications.ts';

const BASE = '/bibliometrics/services/{serviceId}/publications';

export const publicationMetadataSchema = z.object({
  status: z
    .enum(['ok', 'not-found', 'failed'])
    .describe(
      '`ok`: the registration agency answered. `not-found`: doi.org does not know the DOI. `failed`: the lookup did not work and is tried again later.',
    ),
  title: z.string().nullable().describe('At most 1000 characters; set when `status` is `ok`.'),
  authors: z.array(z.string()).max(100).describe('Display names, at most 100.'),
  issued: z
    .string()
    .regex(/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/)
    .nullable()
    .describe('`2020`, `2020-09` or `2020-09-16`: as precise as the agency knows it.'),
  container: z.string().nullable().describe('The journal, or the repository (such as Zenodo).'),
  type: z
    .string()
    .nullable()
    .describe('The CSL type: `journal-article`, `software`, `dataset`, ...'),
  resolvedAt: z.iso.datetime(),
});

export const publicationSchema = z.object({
  id: z.uuid(),
  serviceId: z.uuid(),
  doi: z
    .string()
    .describe('Normalised: lower case, without a `https://doi.org/` or `doi:` prefix.'),
  addedBy: z.uuid().nullable(),
  addedAt: z.iso.datetime(),
  metadata: publicationMetadataSchema
    .nullable()
    .describe('`null` until the DOI is looked up (lookups are turned off).'),
});

const serviceParam = z.object({ serviceId: z.uuid().describe('The id of the service.') });

export const listPublicationsRoute = createRoute({
  method: 'get',
  path: BASE,
  permission: PERMISSION_READ,
  summary: 'The publications of a service',
  description: `The publications of a service with their metadata, newest first (by the date they were issued; unknown dates last), then by id. ${DEFAULT_PAGE_SIZE} per page by default, at most ${MAX_PAGE_SIZE}; pages count from 0.`,
  request: {
    params: serviceParam,
    query: paginationQuery({ defaultPageSize: DEFAULT_PAGE_SIZE, maxPageSize: MAX_PAGE_SIZE }),
  },
  responses: {
    200: {
      description: 'One page of publications.',
      content: { 'application/json': { schema: listEnvelope(publicationSchema) } },
    },
    404: { description: 'No such service.' },
  },
});

export const addPublicationRoute = createRoute({
  method: 'post',
  path: BASE,
  // Delegated (ADR-0034): the service checks the scoped `bibliometrics.publication.write` on the service.
  permission: PERMISSION_READ,
  rateLimit: 'default',
  summary: 'Add a publication to a service',
  description:
    'Adds a publication by DOI (`10.1234/abc`, also with a `https://doi.org/` or `doi:` prefix) and looks up its title, authors and date before answering. A failed lookup keeps the publication with `failed` metadata. Needs `bibliometrics.publication.write` on the service: Admin, or a member of its provider.',
  request: {
    params: serviceParam,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.strictObject({
            doi: z
              .string()
              .min(1)
              .max(DOI_MAX_INPUT_LENGTH)
              .describe('The DOI, with or without a `https://doi.org/` or `doi:` prefix.'),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'The publication.',
      content: { 'application/json': { schema: publicationSchema } },
    },
    404: { description: 'No such service.' },
    409: { description: 'The service lists this DOI already.' },
  },
});

export const removePublicationRoute = createRoute({
  method: 'delete',
  path: `${BASE}/{publicationId}`,
  // Delegated (ADR-0034), as the add.
  permission: PERMISSION_READ,
  summary: 'Remove a publication of a service',
  description:
    'Removes a publication of this service by its id. A publication of another service is a 404 and is not touched. Needs `bibliometrics.publication.write` on the service.',
  request: {
    params: serviceParam.extend({ publicationId: z.uuid().describe('The id of the publication.') }),
  },
  responses: {
    204: { description: 'The publication is removed.' },
    404: { description: 'No such service, or the service has no such publication.' },
  },
});

/** The answer for one publication, field by field. */
export function publicationOut(item: Publication): z.output<typeof publicationSchema> {
  return {
    id: item.id,
    serviceId: item.serviceId,
    doi: item.doi,
    addedBy: item.addedBy,
    addedAt: item.addedAt.toISOString(),
    metadata: item.metadata && {
      status: item.metadata.status,
      title: item.metadata.title,
      authors: item.metadata.authors,
      issued: item.metadata.issued,
      container: item.metadata.container,
      type: item.metadata.type,
      resolvedAt: item.metadata.resolvedAt.toISOString(),
    },
  };
}

const noStore = (c: Context) => c.header('cache-control', 'no-store');

export function registerRoutes(r: RouteRegistrar, publications: PublicationsService) {
  r.internal(listPublicationsRoute, (async (c) => {
    const { serviceId } = c.req.valid('param');
    const query = c.req.valid('query');
    const page = await publications.list(c.get('actor'), serviceId, query);
    noStore(c);
    return c.json(paginate(query, page.totalCount, page.items.map(publicationOut)), 200);
  }) satisfies RouteHandler<typeof listPublicationsRoute, AppEnv>);

  r.internal(addPublicationRoute, (async (c) => {
    const { serviceId } = c.req.valid('param');
    const { doi } = c.req.valid('json');
    const added = await publications.add(c.get('actor'), serviceId, doi);
    noStore(c);
    return c.json(publicationOut(added), 201);
  }) satisfies RouteHandler<typeof addPublicationRoute, AppEnv>);

  r.internal(removePublicationRoute, (async (c) => {
    const { serviceId, publicationId } = c.req.valid('param');
    await publications.remove(c.get('actor'), serviceId, publicationId);
    noStore(c);
    return c.body(null, 204);
  }) satisfies RouteHandler<typeof removePublicationRoute, AppEnv>);
}
