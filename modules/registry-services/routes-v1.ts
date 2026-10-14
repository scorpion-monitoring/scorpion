// The v1 routes of registry.services (the public API, `/api/v1`, ADR-0037). Thin: Zod parses, one service call, the
// row is mapped field by field. A token reaches them with the scope `registry.services.v1.read`. The Schema.org
// answer is the internal one: the same builder and `serializeJsonLd`, never the contact point.
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
import { serializeJsonLd } from '@scorpion/registry-organisations/public';
import { schemaOrgSchema } from './routes.ts';
import {
  PERMISSION_V1_READ,
  type ServiceRecordV1,
  type ServicesService,
  type ServiceV1,
} from './service/services.ts';

const MAX_VALUES = 50;
const MAX_VALUE_LENGTH = 64;

/** A comma-separated list of values: at most 50, none empty, none longer than 64 characters. */
const list = (description: string) =>
  z
    .string()
    .max(MAX_VALUES * (MAX_VALUE_LENGTH + 1))
    .transform((text) => text.split(',').map((value) => value.trim()))
    .pipe(
      z.array(z.string().min(1, 'must not be empty').max(MAX_VALUE_LENGTH)).min(1).max(MAX_VALUES),
    )
    .optional()
    .describe(description);

/** A service as v1 returns it: the legacy fields with `provider` and `consortia` as abbreviations, and what is added (ADR-0037 decision 9). */
export const serviceV1Schema = z.object({
  id: z.string().describe('The id of the service (a UUID).'),
  abbreviation: z.string().describe('The current slug of the service.'),
  name: z.string(),
  stage: z.string().describe('The key of a term of the `stage` vocabulary.'),
  license: z.string().nullable().describe('An SPDX licence id.'),
  public: z
    .boolean()
    .describe('Whether anonymous readers may see the service on the public pages.'),
  provider: z.string().nullable().describe('The abbreviation of the provider.'),
  providerId: z.string().nullable().describe('The id of the provider, as in `GET /providers`.'),
  consortia: z
    .array(z.string())
    .describe('The abbreviations of the consortia, by name; `[]` for none.'),
  consortiaIds: z
    .array(z.string())
    .describe('The ids of the consortia, in the order of `consortia`.'),
});

export const serviceRecordV1Schema = serviceV1Schema.extend({
  description: z.string().nullable().describe('Plain text.'),
  url: z.string().nullable(),
  sameAs: z.array(z.string()),
});

const EXAMPLE_SERVICE = {
  id: '0198f3a5-1d44-7e08-a6b1-93c2d0f47e55',
  abbreviation: 'BRIDGE',
  name: 'BRIDGE Data Portal',
  stage: 'PROD',
  license: 'Apache-2.0',
  public: false,
  provider: 'IPK',
  providerId: '0198f3a2-7c1e-7b52-9d3a-4e1f6a2b8c10',
  consortia: ['DE-NBI', 'NFDI4Biodiversity'],
  consortiaIds: ['0198f3a3-02b9-7a14-8c6d-5b7e1f9a3d20', '0198f3a3-5e87-7c90-b2f4-6a1d8e0c4b31'],
};

const idParam = z.object({ id: z.uuid().describe('The id of the service.') });

export const listServicesV1Route = createRoute({
  method: 'get',
  path: '/services',
  permission: PERMISSION_V1_READ,
  audit: true,
  summary: 'List the services',
  description:
    'The services, each once, whatever the number of its consortia (`[]` for none). A service that is not public is listed too, with `public: false`. Filters are combined with AND; a comma-separated list inside one filter is OR, compared without case (at most 50 values). An abbreviation that names no service or provider, and a stage or licence that names nothing, is 422. Sorted by abbreviation without case, then by id; pages count from 0 and `pageSize` is at most 100 (default 100). `totalCount` is the size of the filtered set. The contact point of a service is never part of this API.',
  request: {
    query: paginationQuery({ defaultPageSize: 100 }).extend({
      service: list('Abbreviations of services, comma-separated.'),
      provider: list('Abbreviations of providers, comma-separated: the services they provide.'),
      stage: list('Keys of the `stage` vocabulary, comma-separated.'),
      license: list('SPDX licence ids, comma-separated.'),
    }),
  },
  responses: {
    200: {
      description: 'A page of services.',
      content: {
        'application/json': {
          schema: listEnvelope(serviceV1Schema),
          example: {
            metadata: { currentPage: 0, pageSize: 100, totalCount: 1, totalPages: 1 },
            result: [EXAMPLE_SERVICE],
          },
        },
      },
    },
  },
});

export const getServiceV1Route = createRoute({
  method: 'get',
  path: '/services/{id}',
  permission: PERMISSION_V1_READ,
  audit: true,
  summary: 'Get one service',
  description:
    'One service by id: the fields of the list and the description, the address and the `sameAs` links. A service that is not public is returned too, with `public: false`. The contact point is never part of this API.',
  request: { params: idParam },
  responses: {
    200: {
      description: 'The service.',
      content: {
        'application/json': {
          schema: serviceRecordV1Schema,
          example: {
            ...EXAMPLE_SERVICE,
            description: 'A portal for plant genomic data.',
            url: 'https://bridge.ipk-gatersleben.de',
            sameAs: [],
          },
        },
      },
    },
    404: { description: 'No such service.' },
  },
});

export const getServiceSchemaOrgV1Route = createRoute({
  method: 'get',
  path: '/services/{id}/schema-org',
  permission: PERMISSION_V1_READ,
  audit: true,
  summary: 'Get one service as Schema.org',
  description:
    'The service as a Schema.org `Service` (JSON-LD), built as the instance builds it for its own pages: the same properties, no contact point and no stage. A service that is not public is returned too.',
  request: { params: idParam },
  responses: {
    200: {
      description: 'The Schema.org profile.',
      content: {
        'application/ld+json': {
          schema: schemaOrgSchema,
          example: {
            '@context': 'https://schema.org',
            '@type': 'Service',
            '@id': 'https://scorpion.example.org/services/0198f3a5-1d44-7e08-a6b1-93c2d0f47e55',
            name: 'BRIDGE Data Portal',
            alternateName: 'BRIDGE',
            url: 'https://bridge.ipk-gatersleben.de',
          },
        },
      },
    },
    404: { description: 'No such service.' },
  },
});

/** Field by field on purpose: a column added to the table later is not exposed by accident. */
const serviceOut = (s: ServiceV1) => ({
  id: s.id,
  abbreviation: s.abbreviation,
  name: s.name,
  stage: s.stage,
  license: s.license,
  public: s.public,
  provider: s.provider,
  providerId: s.providerId,
  consortia: s.consortia,
  consortiaIds: s.consortiaIds,
});

const recordOut = (s: ServiceRecordV1) => ({
  ...serviceOut(s),
  description: s.description,
  url: s.url,
  sameAs: s.sameAs,
});

export function registerV1Routes(r: RouteRegistrar, service: ServicesService) {
  r.public('v1', listServicesV1Route, (async (c) => {
    const { page, pageSize, service: services, provider, stage, license } = c.req.valid('query');
    const result = await service.listV1(
      c.get('actor'),
      { services, providers: provider, stage, license },
      { page, pageSize },
    );
    return c.json(paginate({ page, pageSize }, result.total, result.services.map(serviceOut)), 200);
  }) satisfies RouteHandler<typeof listServicesV1Route, AppEnv>);

  r.public('v1', getServiceV1Route, (async (c) => {
    return c.json(recordOut(await service.getV1(c.get('actor'), c.req.valid('param').id)), 200);
  }) satisfies RouteHandler<typeof getServiceV1Route, AppEnv>);

  r.public('v1', getServiceSchemaOrgV1Route, (async (c) => {
    const profile = await service.schemaOrgV1(c.get('actor'), c.req.valid('param').id);
    // The only way the profile becomes a string (`serializeJsonLd`), as for the internal route.
    return new Response(serializeJsonLd(profile), {
      status: 200,
      headers: {
        'content-type': 'application/ld+json; charset=utf-8',
        'cache-control': 'private, no-cache',
        'x-content-type-options': 'nosniff',
      },
    });
  }) satisfies RouteHandler<typeof getServiceSchemaOrgV1Route, AppEnv>);
}
