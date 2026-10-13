// What the catalogue needs before it renders. It runs on the server, after the permission check, and
// **throws** when it cannot get its data (defect 12). Whether the caller may create a service is asked of
// the API (`GET /account/permissions`), not guessed from a role; a caller who may not read it simply gets
// no link.
import type { UiLoadContext } from '@scorpion/contracts';
import { ApiError, unwrap } from '@scorpion/contracts/client';
import { catalogueApiQuery, facetsApiQuery, parseCatalogueQuery } from './query.ts';

const CREATE = 'registry.services.service.create';

async function mayCreate(api: UiLoadContext['api']): Promise<boolean> {
  try {
    const held = await unwrap(
      api.GET('/account/permissions', { params: { query: { page: '0', pageSize: '500' } } }),
    );
    return held.result.some((permission) => permission.id === CREATE);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 401)) return false;
    throw error;
  }
}

export async function loadCatalogue({ api, url, locale }: UiLoadContext) {
  const query = parseCatalogueQuery(url.searchParams);
  // The filters are the facets' ids, which the module's own registry decides: the typed query names the four
  // seeded ones and the API takes the rest, hence the cast.
  const [answer, facets, canCreate] = await Promise.all([
    unwrap(
      api.GET('/services', {
        params: { query: catalogueApiQuery(query, locale) as never },
      }),
    ),
    unwrap(
      api.GET('/services/facets', {
        params: { query: facetsApiQuery(query, locale) as never },
      }),
    ),
    mayCreate(api),
  ]);
  return {
    query,
    services: answer.result,
    total: answer.metadata.totalCount,
    facets: facets.result,
    canCreate,
  };
}

export type CatalogueData = Awaited<ReturnType<typeof loadCatalogue>>;
