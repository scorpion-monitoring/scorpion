// The demo seed of registry.organisations (`scorpion seed --demo`, ADR-0046): fictional organisations on reserved
// domains, and the membership of the demo user in the first provider, so that a documented journey can create a
// service. Written through the module's own services as the demo administrator.
import { DemoSeedRefused, type DemoSeedContext, type JobResult } from '@scorpion/kernel';
import type { CreateOrganisationInput } from './input.ts';
import type { MembershipsService } from './memberships.ts';
import type { OrganisationsService } from './organisations.ts';

/** Fictional on purpose: no real institution, person, address or ROR id. Reserved domains only (RFC 2606). */
export const DEMO_ORGANISATIONS: readonly CreateOrganisationInput[] = [
  {
    type: 'provider',
    abbreviation: 'EBC',
    name: 'Example Bioinformatics Centre',
    description:
      'A fictional centre that runs sequence analysis and data management services for the demonstration instance.',
    website: 'https://example.org/ebc',
    contactEmail: 'contact@ebc.example.org',
    contactType: 'support',
  },
  {
    type: 'provider',
    abbreviation: 'SDI',
    name: 'Sample Data Institute',
    description:
      'A fictional institute that hosts repositories and metadata catalogues for the demonstration instance.',
    website: 'https://example.org/sdi',
    contactEmail: 'contact@sdi.example.org',
    contactType: 'support',
  },
  {
    type: 'provider',
    abbreviation: 'DCF',
    name: 'Demo Compute Facility',
    description:
      'A fictional facility that offers cloud and cluster computing for the demonstration instance.',
    website: 'https://example.org/dcf',
  },
  {
    type: 'consortium',
    abbreviation: 'ERN',
    name: 'Example Research Network',
    description: 'A fictional network of the three providers above.',
    website: 'https://example.org/ern',
  },
];

export interface OrganisationsDemoDeps {
  organisations: Pick<OrganisationsService, 'create' | 'findByAbbreviationAsSystem'>;
  memberships: Pick<MembershipsService, 'request' | 'decide'>;
}

export function createDemoSeed(deps: () => OrganisationsDemoDeps) {
  return async function demoSeed(_ctx: unknown, demo: DemoSeedContext): Promise<JobResult> {
    const admin = demo.actors.get('admin');
    const user = demo.actors.get('user');
    if (!admin || !user) {
      throw new DemoSeedRefused('registry.organisations needs the demo accounts of core.identity.');
    }
    const { organisations, memberships } = deps();
    let created = 0;
    let existing = 0;
    let firstProvider: string | undefined;
    for (const input of DEMO_ORGANISATIONS) {
      const found = await organisations.findByAbbreviationAsSystem(input.type, input.abbreviation);
      let id = found?.id;
      if (found) existing += 1;
      else {
        id = (await organisations.create(admin, input)).id;
        created += 1;
      }
      if (input.type === 'provider') firstProvider ??= id;
    }
    // The demo user is an approved member of the first provider (a request, decided by the administrator).
    let membership = 0;
    if (firstProvider) {
      const { membership: row } = await memberships.request(user, firstProvider);
      if (row.state === 'requested') {
        await memberships.decide(admin, row.id, 'approved');
        membership = 1;
      }
    }
    return { created, existing, memberships: membership };
  };
}
