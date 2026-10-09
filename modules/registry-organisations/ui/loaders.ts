// What the pages of registry.organisations need before they render. They run on the server, after the
// permission check, and **throw** when they cannot get their data (defect 12). A part of a page that the
// caller may not see (the member list) is left out; any other failure fails the page.
import type { UiLoadContext } from '@scorpion/contracts';
import { ApiError, unwrap } from '@scorpion/contracts/client';
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
