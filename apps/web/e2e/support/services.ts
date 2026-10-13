// What the service journeys need: organisations of both kinds with names that cannot clash, services made
// through the API as the administrator, and a catalogue of known shape. Each journey makes its own data
// under a tag of its own (the specs of a run share one database, and a retry must not meet what its first
// try left), and searches for the tag so that the counts it asserts are its own.
import { expect } from './fixtures.ts';
import { unique, type AdminApi } from './admin.ts';
import { makeOrg, uniqueAbbreviation, type Org } from './members.ts';

/** A consortium with this abbreviation. */
export async function makeConsortium(api: AdminApi, abbreviation: string): Promise<Org> {
  const created = await api.send('POST', '/organisations', {
    type: 'consortium',
    abbreviation,
    name: `${abbreviation} consortium`,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return {
    id: (created.body as { id: string }).id,
    abbreviation,
    name: `${abbreviation} consortium`,
  };
}

export interface NewService {
  name: string;
  provider: string;
  consortia?: string[];
  stage?: string;
  license?: string;
}

/** Creates a service as the signed-in administrator; the slug is made from the tag. */
export async function makeCatalogueService(
  api: AdminApi,
  slug: string,
  service: NewService,
): Promise<{ id: string; slug: string; name: string }> {
  const created = await api.send('POST', '/services', { slug, ...service });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return { id: (created.body as { id: string }).id, slug, name: service.name };
}

export interface Catalogue {
  tag: string;
  providers: [Org, Org];
  consortia: [Org, Org];
  /** The service with two consortia, the one with none, and the one in development. */
  zeta: { id: string; slug: string; name: string };
  alpha: { id: string; slug: string; name: string };
  /** The 22 services that fill the pages: all in production, provider 1, consortium 1. */
  fillers: { id: string; slug: string; name: string }[];
  total: number;
}

/**
 * 24 services under one tag: `Zeta` (in development, two consortia), `Alpha` (in production, no consortium, a
 * second provider, a licence) and 22 fillers (in production, one consortium). Searching the tag isolates them
 * from the services of other specs, and the facets count over that search too.
 */
export async function seedCatalogue(api: AdminApi, tag = unique('cat')): Promise<Catalogue> {
  const providers: [Org, Org] = [
    await makeOrg(api, uniqueAbbreviation('CPA')),
    await makeOrg(api, uniqueAbbreviation('CPB')),
  ];
  const consortia: [Org, Org] = [
    await makeConsortium(api, uniqueAbbreviation('CCA')),
    await makeConsortium(api, uniqueAbbreviation('CCB')),
  ];
  const zeta = await makeCatalogueService(api, `${tag}-zeta`, {
    name: `${tag} Zeta`,
    provider: providers[0].id,
    consortia: [consortia[0].id, consortia[1].id],
    stage: 'DEV',
  });
  const alpha = await makeCatalogueService(api, `${tag}-alpha`, {
    name: `${tag} Alpha`,
    provider: providers[1].id,
    stage: 'PROD',
    license: 'MIT',
  });
  const fillers = [];
  for (let i = 1; i <= 22; i++) {
    fillers.push(
      await makeCatalogueService(api, `${tag}-fill-${String(i).padStart(2, '0')}`, {
        name: `${tag} Fill ${String(i).padStart(2, '0')}`,
        provider: providers[0].id,
        consortia: [consortia[0].id],
        stage: 'PROD',
      }),
    );
  }
  return { tag, providers, consortia, zeta, alpha, fillers, total: 24 };
}
