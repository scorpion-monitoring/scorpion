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
import {
  HISTORY_MAX_POINTS,
  MANUAL_COOLDOWN_SECONDS,
  type CitationService,
  type History,
  type ServiceCitations,
} from './service/citations.ts';
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
  citedByCount: z
    .number()
    .int()
    .min(0)
    .nullable()
    .describe(
      'The latest citation count of the citation source. `null` while it is unknown: not asked yet, not found by the source, or the request failed. Never a 0 that was not counted.',
    ),
  citationsAsOf: z.iso
    .datetime()
    .nullable()
    .describe('When `citedByCount` was taken; `null` with it.'),
  issued: z
    .string()
    .regex(/^\d{4}-\d{2}(?:-\d{2})?$/)
    .nullable()
    .describe(
      'The month (`2020-09`) or day (`2020-09-16`) a member of the provider gave; it wins over `metadata.issued`. `null` until one is given.',
    ),
  monthKnown: z
    .boolean()
    .describe(
      'Whether the date that counts (`issued`, else `metadata.issued`) names a month. The Publications KPI needs one for every publication.',
    ),
});

export const serviceCitationsSchema = z
  .object({
    source: z
      .string()
      .nullable()
      .describe('The id of the citation source the counts come from (`openalex`).'),
    sourceLabel: z
      .string()
      .nullable()
      .describe('The name of that source (`OpenAlex`), for "not found in OpenAlex".'),
    total: z
      .number()
      .int()
      .min(0)
      .nullable()
      .describe('The sum of the known counts of the service; `null` when no publication has one.'),
    found: z.number().int().min(0).describe('How many publications have a count.'),
    of: z.number().int().min(0).describe('How many publications the service lists.'),
  })
  .describe('The citations of the whole service (all pages): "312 citations, 4 of 5 found".');

export const publicationListSchema = listEnvelope(publicationSchema).extend({
  citations: serviceCitationsSchema,
  undated: z
    .number()
    .int()
    .min(0)
    .describe(
      'How many publications of the service (all pages) have no date precise to the month; a member of the provider is asked to give it.',
    ),
  canEdit: z
    .boolean()
    .describe(
      'Whether the caller may add and remove publications of this service and check its citations now (`bibliometrics.publication.write` on the service).',
    ),
});

export const historyPointSchema = z.object({
  source: z.string().describe('The id of the citation source.'),
  day: z.iso.date().describe('The UTC day of the count.'),
  citedByCount: z.number().int().min(0),
  takenAt: z.iso.datetime(),
});

export const publicationHistorySchema = z.object({
  publicationId: z.uuid(),
  doi: z.string(),
  points: z
    .array(historyPointSchema)
    .max(HISTORY_MAX_POINTS)
    .describe(
      `Oldest first; at most one point per source and day (the latest count of that day), the last ${HISTORY_MAX_POINTS}. A week with no count (not found, failed) has no point.`,
    ),
});

export const refreshAcceptedSchema = z.object({
  runIds: z
    .array(z.uuid())
    .describe(
      'One run per citation source that is on (usually one, OpenAlex). The counts arrive when the job has run.',
    ),
});

const serviceParam = z.object({ serviceId: z.uuid().describe('The id of the service.') });

const publicationParams = serviceParam.extend({
  publicationId: z.uuid().describe('The id of the publication.'),
});

export const listPublicationsRoute = createRoute({
  method: 'get',
  path: BASE,
  permission: PERMISSION_READ,
  summary: 'The publications of a service',
  description: `The publications of a service with their metadata and citation counts, and the citation total of the service, newest first (by the date they were issued; unknown dates last), then by id. ${DEFAULT_PAGE_SIZE} per page by default, at most ${MAX_PAGE_SIZE}; pages count from 0.`,
  request: {
    params: serviceParam,
    query: paginationQuery({ defaultPageSize: DEFAULT_PAGE_SIZE, maxPageSize: MAX_PAGE_SIZE }),
  },
  responses: {
    200: {
      description: 'One page of publications.',
      content: { 'application/json': { schema: publicationListSchema } },
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
    params: publicationParams,
  },
  responses: {
    204: { description: 'The publication is removed.' },
    404: { description: 'No such service, or the service has no such publication.' },
  },
});

export const datePublicationRoute = createRoute({
  method: 'patch',
  path: `${BASE}/{publicationId}`,
  // Delegated (ADR-0034), as the add: the service checks `bibliometrics.publication.write` on the service.
  permission: PERMISSION_READ,
  rateLimit: 'default',
  summary: 'Give the date a publication was issued',
  description:
    'Sets the month (`2020-09`) or day (`2020-09-16`) a publication of this service was issued, which then wins over the date of the registration agency, or takes it back with `null`. Not before 1900 and not after the current month. Needs `bibliometrics.publication.write` on the service: Admin, or a member of its provider.',
  request: {
    params: publicationParams,
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.strictObject({
            issued: z
              .string()
              .max(10)
              .nullable()
              .describe('`2020-09`, `2020-09-16`, or `null` to use the agency date again.'),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'The publication.',
      content: { 'application/json': { schema: publicationSchema } },
    },
    404: { description: 'No such service, or the service has no such publication.' },
  },
});

export const publicationHistoryRoute = createRoute({
  method: 'get',
  path: `${BASE}/{publicationId}/history`,
  permission: PERMISSION_READ,
  summary: 'The citation history of a publication',
  description: `The citation counts of a publication of this service over time: at most one per source and day (the latest), the last ${HISTORY_MAX_POINTS}, oldest first. A publication of another service is a 404.`,
  request: { params: publicationParams },
  responses: {
    200: {
      description: 'The history.',
      content: { 'application/json': { schema: publicationHistorySchema } },
    },
    404: { description: 'No such service, or the service has no such publication.' },
  },
});

export const refreshCitationsRoute = createRoute({
  method: 'post',
  path: '/bibliometrics/services/{serviceId}/citations/refresh',
  // Delegated (ADR-0034), as the add: the service checks `bibliometrics.publication.write` on the service.
  permission: PERMISSION_READ,
  rateLimit: 'strict',
  summary: 'Check the citations of a service now',
  description: `Queues a citation refresh of this service's publications and answers at once with the runs. Refused for ${MANUAL_COOLDOWN_SECONDS / 60} minutes after the last one of the service (429 with \`Retry-After\`), so the instance's daily budget at the citation source is not spent by hand. Needs \`bibliometrics.publication.write\` on the service: Admin, or a member of its provider.`,
  request: { params: serviceParam },
  responses: {
    202: {
      description: 'The refresh is queued.',
      content: { 'application/json': { schema: refreshAcceptedSchema } },
    },
    404: { description: 'No such service.' },
    409: { description: 'Citation lookups are turned off on this instance.' },
    429: { description: 'The citations of this service were checked less than ten minutes ago.' },
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
    citedByCount: item.citedByCount,
    citationsAsOf: item.citationsAsOf?.toISOString() ?? null,
    issued: item.issued,
    monthKnown: item.monthKnown,
  };
}

function citationsOut(value: ServiceCitations): z.output<typeof serviceCitationsSchema> {
  return {
    source: value.source,
    sourceLabel: value.sourceLabel,
    total: value.total,
    found: value.found,
    of: value.of,
  };
}

function historyOut(value: History): z.output<typeof publicationHistorySchema> {
  return {
    publicationId: value.publicationId,
    doi: value.doi,
    points: value.points.map((point) => ({
      source: point.source,
      day: point.day,
      citedByCount: point.citedByCount,
      takenAt: point.takenAt.toISOString(),
    })),
  };
}

const noStore = (c: Context) => c.header('cache-control', 'no-store');

export function registerRoutes(
  r: RouteRegistrar,
  publications: PublicationsService,
  citations: CitationService,
) {
  r.internal(listPublicationsRoute, (async (c) => {
    const { serviceId } = c.req.valid('param');
    const query = c.req.valid('query');
    const page = await publications.list(c.get('actor'), serviceId, query);
    noStore(c);
    return c.json(
      {
        ...paginate(query, page.totalCount, page.items.map(publicationOut)),
        citations: citationsOut(page.citations),
        undated: page.undated,
        canEdit: page.canEdit,
      },
      200,
    );
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

  r.internal(datePublicationRoute, (async (c) => {
    const { serviceId, publicationId } = c.req.valid('param');
    const { issued } = c.req.valid('json');
    const dated = await publications.setIssued(c.get('actor'), serviceId, publicationId, issued);
    noStore(c);
    return c.json(publicationOut(dated), 200);
  }) satisfies RouteHandler<typeof datePublicationRoute, AppEnv>);

  r.internal(publicationHistoryRoute, (async (c) => {
    const { serviceId, publicationId } = c.req.valid('param');
    const history = await citations.history(c.get('actor'), serviceId, publicationId);
    noStore(c);
    return c.json(historyOut(history), 200);
  }) satisfies RouteHandler<typeof publicationHistoryRoute, AppEnv>);

  r.internal(refreshCitationsRoute, (async (c) => {
    const { serviceId } = c.req.valid('param');
    const accepted = await citations.requestRefresh(c.get('actor'), serviceId);
    noStore(c);
    return c.json({ runIds: accepted.runIds }, 202);
  }) satisfies RouteHandler<typeof refreshCitationsRoute, AppEnv>);
}
