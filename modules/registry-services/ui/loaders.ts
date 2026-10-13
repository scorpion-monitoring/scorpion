// What the catalogue needs before it renders. It runs on the server, after the permission check, and
// **throws** when it cannot get its data (defect 12). Whether the caller may create a service is asked of
// the API (`GET /account/permissions`), not guessed from a role; a caller who may not read it simply gets
// no link.
import type { UiLoadContext } from '@scorpion/contracts';
import { ApiError, unwrap } from '@scorpion/contracts/client';
import type { OrganisationChoices, WizardData, WizardSchema } from './wizard-types.ts';
import { catalogueApiQuery, facetsApiQuery, parseCatalogueQuery } from './query.ts';

const CREATE = 'registry.services.service.create';
/** Held by an administrator only: the wizard then lists every organisation, not only the caller's own. */
const MANAGE = 'registry.services.service.manage';

/** The permissions the API says the caller holds; none for a caller who may not even ask. */
async function heldPermissions(api: UiLoadContext['api']): Promise<Set<string>> {
  try {
    const held = await unwrap(
      api.GET('/account/permissions', { params: { query: { page: '0', pageSize: '500' } } }),
    );
    return new Set(held.result.map((permission) => permission.id));
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 401)) {
      return new Set();
    }
    throw error;
  }
}

const mayCreate = async (api: UiLoadContext['api']): Promise<boolean> =>
  (await heldPermissions(api)).has(CREATE);

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

/** The API never returns more than this many rows of a list. */
const WHOLE = { page: '0', pageSize: '100' } as const;

/**
 * The organisations a role may choose from, for this caller, as the API lists them: for the owning role only
 * the organisations the caller is an approved member of (an administrator: all of the role's types), for every
 * other role all organisations of the role's types. The server checks the choice again on create.
 */
async function organisationsFor(
  api: UiLoadContext['api'],
  role: WizardSchema['roles'][number],
  admin: boolean,
): Promise<OrganisationChoices> {
  if (role.memberOnly && !admin) {
    const own = await unwrap(api.GET('/account/memberships', { params: { query: WHOLE } }));
    const wanted = new Set(role.orgTypes);
    return {
      options: own.result
        .filter((row) => row.state === 'approved' && wanted.has(row.organisation.type))
        .map(({ organisation }) => ({
          id: organisation.id,
          abbreviation: organisation.abbreviation,
          name: organisation.name,
        })),
      truncated: own.metadata.totalCount > own.result.length,
    };
  }
  const answers = await Promise.all(
    role.orgTypes.map((type) =>
      unwrap(api.GET('/organisations', { params: { query: { ...WHOLE, type } } })),
    ),
  );
  return {
    options: answers
      .flatMap((answer) => answer.result)
      .map(({ id, abbreviation, name }) => ({ id, abbreviation, name }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    truncated: answers.some((answer) => answer.metadata.totalCount > answer.result.length),
  };
}

/** The wizard: the schema the server built, and the organisations each organisation field may list. */
export async function loadNewService({ api, locale }: UiLoadContext): Promise<WizardData> {
  const [schema, held] = await Promise.all([
    unwrap(api.GET('/services/schema', { params: { query: { locale } } })),
    heldPermissions(api),
  ]);
  const admin = held.has(MANAGE);
  const used = new Set(
    schema.steps.flatMap((step) =>
      step.fields.flatMap((field) => (field.role ? [field.role] : [])),
    ),
  );
  const entries = await Promise.all(
    schema.roles
      .filter((role) => used.has(role.id))
      .map(async (role) => [role.id, await organisationsFor(api, role, admin)] as const),
  );
  return { schema, organisations: Object.fromEntries(entries) };
}
