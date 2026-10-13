// What the pages of registry.organisations need before they render. They run on the server, after the
// permission check, and **throw** when they cannot get their data (defect 12). A part of a page that the
// caller may not see (the member list) is left out; any other failure fails the page.
import type { UiLoadContext } from '@scorpion/contracts';
import { ApiError, unwrap } from '@scorpion/contracts/client';
import {
  membershipsApiQuery,
  parseMembershipsQuery,
  parseSearchQuery,
  searchApiQuery,
} from './member-query.ts';
import { organisationsApiQuery, parseOrganisationsQuery } from './query.ts';

async function allowed<T>(call: Promise<T>): Promise<T | null> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return null;
    throw error;
  }
}

const loadTypes = async (api: UiLoadContext['api']) =>
  (await unwrap(api.GET('/organisation-types', { params: { query: {} } }))).result;

/** The detail page: the record, the profile for the JSON-LD block, the types, and the members when the caller may see them. */
export async function loadOrganisation({ api, params }: UiLoadContext) {
  const path = { id: params.id! };
  const [organisation, profile, types, members] = await Promise.all([
    unwrap(api.GET('/organisations/{id}', { params: { path } })),
    unwrap(api.GET('/organisations/{id}/schema-org', { params: { path } })),
    loadTypes(api),
    // The route is open to every signed-in person; the service refuses a caller who may not see the members.
    allowed(unwrap(api.GET('/organisations/{id}/members', { params: { path } }))),
  ]);
  return { organisation, profile, types, members: members?.result ?? null };
}

export type OrganisationData = Awaited<ReturnType<typeof loadOrganisation>>;

export async function loadAdminOrganisations({ api, url }: UiLoadContext) {
  const query = parseOrganisationsQuery(url.searchParams);
  const [answer, types] = await Promise.all([
    unwrap(api.GET('/organisations', { params: { query: organisationsApiQuery(query) } })),
    loadTypes(api),
  ]);
  return { query, organisations: answer.result, total: answer.metadata.totalCount, types };
}

export type AdminOrganisationsData = Awaited<ReturnType<typeof loadAdminOrganisations>>;

export async function loadAdminOrganisation({ api, params }: UiLoadContext) {
  const [organisation, types] = await Promise.all([
    unwrap(api.GET('/organisations/{id}', { params: { path: { id: params.id! } } })),
    loadTypes(api),
  ]);
  return { organisation, types };
}

export type AdminOrganisationData = Awaited<ReturnType<typeof loadAdminOrganisation>>;

export async function loadNewOrganisation({ api }: UiLoadContext) {
  return { organisation: undefined, types: await loadTypes(api) };
}

/** A list the page shows whole: the API never returns more than 100 rows, and the page says when there are more. */
const WHOLE = { page: '0', pageSize: '100' } as const;

/**
 * Profile, organisations: the caller's own memberships, the search, and, only when the API says the caller
 * manages an organisation, what each one needs (its record, its pending requests and its members). The page
 * draws nothing of the manager section otherwise, and a plain User never triggers these requests.
 */
export async function loadAccountOrganisations({ api, url }: UiLoadContext) {
  const search = parseSearchQuery(url.searchParams);
  const [own, summary, found, types] = await Promise.all([
    unwrap(api.GET('/account/memberships', { params: { query: WHOLE } })),
    unwrap(api.GET('/memberships/summary')),
    unwrap(api.GET('/organisations', { params: { query: searchApiQuery(search) } })),
    loadTypes(api),
  ]);
  const managed = summary.manages
    ? own.result.filter((row) => row.state === 'approved' && row.role === 'manager')
    : [];
  const sections = await Promise.all(
    managed.map(async ({ organisation }) => {
      const [record, requests, members] = await Promise.all([
        unwrap(api.GET('/organisations/{id}', { params: { path: { id: organisation.id } } })),
        unwrap(
          api.GET('/memberships', {
            params: {
              query: { ...WHOLE, organisationId: organisation.id, state: 'requested' },
            },
          }),
        ),
        unwrap(
          api.GET('/memberships', {
            params: {
              query: { ...WHOLE, organisationId: organisation.id, state: 'approved' },
            },
          }),
        ),
      ]);
      return {
        organisation: record,
        requests: requests.result,
        requestsTotal: requests.metadata.totalCount,
        members: members.result,
        membersTotal: members.metadata.totalCount,
      };
    }),
  );
  return {
    search,
    own: own.result,
    ownTotal: own.metadata.totalCount,
    summary,
    found: found.result,
    foundTotal: found.metadata.totalCount,
    types,
    sections,
  };
}

export type AccountOrganisationsData = Awaited<ReturnType<typeof loadAccountOrganisations>>;

/** Administration, membership requests: the list for the filters in the address, the organisations and the types for the filters. */
export async function loadAdminMemberships({ api, url }: UiLoadContext) {
  const query = parseMembershipsQuery(url.searchParams);
  const [answer, organisations, types] = await Promise.all([
    unwrap(api.GET('/memberships', { params: { query: membershipsApiQuery(query) } })),
    unwrap(
      api.GET('/organisations', {
        params: {
          query: organisationsApiQuery({ q: undefined, type: undefined, page: 0, pageSize: 100 }),
        },
      }),
    ),
    loadTypes(api),
  ]);
  return {
    query,
    rows: answer.result,
    total: answer.metadata.totalCount,
    organisations: organisations.result,
    organisationsTotal: organisations.metadata.totalCount,
    types,
  };
}

export type AdminMembershipsData = Awaited<ReturnType<typeof loadAdminMemberships>>;

/** One row of the lists a decider sees (requests, members, the administrator's list). */
export type ManagedRow = AdminMembershipsData['rows'][number];

/**
 * The public page of an organisation: the public record and its profile, asked of the public routes. An
 * organisation no public service names, and an unknown one, come back as the API's one 404.
 */
export async function loadPublicOrganisation({ api, params }: UiLoadContext) {
  const path = { id: params.id! };
  const [organisation, profile] = await Promise.all([
    unwrap(api.GET('/public/organisations/{id}', { params: { path } })),
    unwrap(api.GET('/public/organisations/{id}/schema-org', { params: { path } })),
  ]);
  return { organisation, profile };
}

export type PublicOrganisationData = Awaited<ReturnType<typeof loadPublicOrganisation>>;
