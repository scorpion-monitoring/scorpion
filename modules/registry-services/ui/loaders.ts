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

// ----- the service page ---------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The slug of a service is never shaped like an id, so a segment that is one names a service by id. */
const isId = (segment: string) => UUID.test(segment);

/** The address of the page of a service. */
const pageOf = (slug: string) => `/services/${encodeURIComponent(slug)}`;

/**
 * The organisations a role may be changed to, for this caller, as the API lists them. The owning role (which
 * the schema marks `memberOnly`): only organisations the caller manages, an administrator any of the role's
 * types; a move is the one change that needs more than the right to edit. Every other role: all organisations
 * of its types, because a member may change them. The server checks the choice again.
 */
async function choicesFor(
  api: UiLoadContext['api'],
  role: WizardSchema['roles'][number],
  admin: boolean,
): Promise<OrganisationChoices> {
  if (role.memberOnly && !admin) {
    const own = await unwrap(api.GET('/account/memberships', { params: { query: WHOLE } }));
    const wanted = new Set(role.orgTypes);
    return {
      options: own.result
        .filter(
          (row) =>
            row.state === 'approved' && row.role === 'manager' && wanted.has(row.organisation.type),
        )
        .map(({ organisation }) => ({
          id: organisation.id,
          abbreviation: organisation.abbreviation,
          name: organisation.name,
        })),
      truncated: own.metadata.totalCount > own.result.length,
    };
  }
  return organisationsFor(api, role, true);
}

/** The licence of a record as words: the name from the SPDX list, the id when the list has no such entry. */
async function licenceOf(api: UiLoadContext['api'], id: string | null) {
  if (id === null) return null;
  const found = await unwrap(api.GET('/licenses', { params: { query: { q: id, limit: 20 } } }));
  const own = found.result.find((licence) => licence.id === id);
  return { id, name: own?.name ?? id, deprecated: own?.deprecated ?? false };
}

/**
 * The service page: the record (an id and an old slug answer with a redirect to the current address, thrown as
 * the shell's redirect, never returned), the Schema.org profile for the block in the head, the schema of the
 * fields (labels of the stage, the form's fields and the roles), the licence as words, and, only when the
 * API's `editableFields` says the caller may change something, the organisations the form may choose from.
 */
export async function loadService({ api, params, locale, redirect }: UiLoadContext) {
  const segment = params.slug!;
  const service = await unwrap(
    isId(segment)
      ? api.GET('/services/{id}', { params: { path: { id: segment } } })
      : api.GET('/services/by-slug/{slug}', { params: { path: { slug: segment } } }),
  );
  if (service.slug !== segment) redirect(pageOf(service.slug));
  const path = { id: service.id };
  const [profile, schema, licence] = await Promise.all([
    unwrap(api.GET('/services/{id}/schema-org', { params: { path } })),
    unwrap(api.GET('/services/schema', { params: { query: { locale } } })),
    licenceOf(api, service.license),
  ]);
  const fields = schema.steps.flatMap((step) => step.fields);
  // The roles whose organisations the form lists: those of the organisation fields the caller may change.
  const wanted = new Set(
    fields.flatMap((field) =>
      field.role && service.editableFields.includes(field.key) ? [field.role] : [],
    ),
  );
  const admin =
    wanted.size > 0 &&
    [...wanted].some((id) => schema.roles.find((role) => role.id === id)?.memberOnly)
      ? (await heldPermissions(api)).has(MANAGE)
      : false;
  const entries = await Promise.all(
    schema.roles
      .filter((role) => wanted.has(role.id))
      .map(async (role) => [role.id, await choicesFor(api, role, admin)] as const),
  );
  return { service, profile, schema, licence, organisations: Object.fromEntries(entries) };
}

export type ServiceData = Awaited<ReturnType<typeof loadService>>;

// ----- the public pages -----------------------------------------------------------------------------------

/**
 * The public page of a service: the public record and its profile, asked of the public routes with no more
 * than the request itself. A service that is not public, an unknown one and a switched-off instance all come
 * back as the API's one 404, which the shell shows as the page of an address nobody has. An id or an old slug is
 * sent on to the current address.
 */
export async function loadPublicService({ api, params, redirect }: UiLoadContext) {
  const ref = params.slug!;
  const path = { ref };
  const [service, profile] = await Promise.all([
    unwrap(api.GET('/public/services/{ref}', { params: { path } })),
    unwrap(api.GET('/public/services/{ref}/schema-org', { params: { path } })),
  ]);
  if (service.slug !== ref) redirect(`/public/services/${encodeURIComponent(service.slug)}`);
  return { service, profile };
}

export type PublicServiceData = Awaited<ReturnType<typeof loadPublicService>>;
