// The v1 route of registry.organisations (the public API, `/api/v1`, ADR-0037). Thin: Zod parses, one service
// call, the row is mapped field by field. A token reaches it with the scope `registry.organisations.v1.read`.
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
// Constants and types only: `public.ts` re-exports this route for its contract test, and the web app imports `public.ts`.
import type { OrganisationsService, ProviderV1 } from './service/organisations.ts';
import { PERMISSION_V1_READ } from './service/permissions.ts';

/** A provider as v1 returns it: the legacy `abbreviation` and `name`, and what is added (ADR-0037 decision 9). */
export const providerV1Schema = z.object({
  id: z.string().describe('The id of the provider (a UUID).'),
  abbreviation: z.string(),
  name: z.string(),
  description: z.string().nullable().describe('Plain text.'),
  website: z.string().nullable(),
  rorId: z.string().nullable().describe('The bare ROR id, for example `02skbsp27`.'),
  sameAs: z.array(z.string()),
  isMember: z
    .boolean()
    .describe(
      'Whether the owner of the token is an approved member of the provider (a manager is a member).',
    ),
});

export const listProvidersV1Route = createRoute({
  method: 'get',
  path: '/providers',
  permission: PERMISSION_V1_READ,
  audit: true,
  summary: 'List the providers',
  description:
    'All providers, or with `is_member` the ones the owner of the token is an approved member of (`true`) or all the others (`false`). Sorted by abbreviation without case, then by id; pages count from 0 and `pageSize` is at most 100 (default 100). `totalCount` is the size of the filtered set. The contact point of a provider is never part of this API.',
  request: {
    query: paginationQuery({ defaultPageSize: 100 }).extend({
      is_member: z
        .enum(['true', 'false'])
        .optional()
        .describe(
          '`true`: the providers the token owner is an approved member of. `false`: all the others. Absent: all providers.',
        ),
    }),
  },
  responses: {
    200: {
      description: 'A page of providers.',
      content: {
        'application/json': {
          schema: listEnvelope(providerV1Schema),
          example: {
            metadata: { currentPage: 0, pageSize: 100, totalCount: 1, totalPages: 1 },
            result: [
              {
                id: '0198f3a2-7c1e-7b52-9d3a-4e1f6a2b8c10',
                abbreviation: 'EXAMPLE-ORG',
                name: 'Example Research Institute',
                description: 'An example research institute.',
                website: 'https://www.example.org',
                rorId: '02skbsp27',
                sameAs: ['https://www.wikidata.org/wiki/Q42'],
                isMember: true,
              },
            ],
          },
        },
      },
    },
  },
});

/** Field by field on purpose: a column added to the table later is not exposed by accident. */
const providerOut = (p: ProviderV1) => ({
  id: p.id,
  abbreviation: p.abbreviation,
  name: p.name,
  description: p.description,
  website: p.website,
  rorId: p.rorId,
  sameAs: p.sameAs,
  isMember: p.isMember,
});

export function registerV1Routes(r: RouteRegistrar, service: OrganisationsService) {
  r.public('v1', listProvidersV1Route, (async (c) => {
    const { page, pageSize, is_member } = c.req.valid('query');
    const { providers, total } = await service.listProvidersV1(
      c.get('actor'),
      { isMember: is_member === undefined ? undefined : is_member === 'true' },
      { page, pageSize },
    );
    return c.json(paginate({ page, pageSize }, total, providers.map(providerOut)), 200);
  }) satisfies RouteHandler<typeof listProvidersV1Route, AppEnv>);
}
