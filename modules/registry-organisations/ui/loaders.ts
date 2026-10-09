// What the pages of registry.organisations need before they render. They run on the server, after the
// permission check, and **throw** when they cannot get their data (defect 12). A part of a page that the
// caller may not see (the member list) is left out; any other failure fails the page.
import type { UiLoadContext } from '@scorpion/contracts';
import { unwrap } from '@scorpion/contracts/client';

export async function loadOrganisation({ api, params }: UiLoadContext) {
  const path = { id: params.id! };
  const [organisation, profile] = await Promise.all([
    unwrap(api.GET('/organisations/{id}', { params: { path } })),
    unwrap(api.GET('/organisations/{id}/schema-org', { params: { path } })),
  ]);
  return { organisation, profile };
}

export type OrganisationData = Awaited<ReturnType<typeof loadOrganisation>>;
