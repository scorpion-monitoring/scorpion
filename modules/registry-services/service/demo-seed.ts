// The demo seed of registry.services (`scorpion seed --demo`, ADR-0046): fictional services of the demo organisations,
// two of them made public, written through `create` and `setPublication` as the demo administrator.
import { NotFound } from '@scorpion/contracts';
import { DemoSeedRefused, type DemoSeedContext, type JobResult } from '@scorpion/kernel';
import type { OrganisationsPublic } from '@scorpion/registry-organisations/public';
import type { ServicesService } from './services.ts';

interface DemoService {
  slug: string;
  name: string;
  /** Abbreviation of a demo provider. */
  provider: string;
  consortium?: boolean;
  description: string;
  url: string;
  license: string;
  stage: string;
  public: boolean;
}

/** Fictional services. Names and addresses are made up; the domains are reserved (RFC 2606). */
export const DEMO_SERVICES: readonly DemoService[] = [
  {
    slug: 'demo-seqflow',
    name: 'SeqFlow',
    provider: 'EBC',
    consortium: true,
    description: 'A fictional workflow service that runs sequence analysis pipelines on demand.',
    url: 'https://example.org/ebc/seqflow',
    license: 'MIT',
    stage: 'PROD',
    public: true,
  },
  {
    slug: 'demo-datavault',
    name: 'DataVault',
    provider: 'SDI',
    consortium: true,
    description:
      'A fictional repository that stores and publishes research datasets with persistent identifiers.',
    url: 'https://example.org/sdi/datavault',
    license: 'Apache-2.0',
    stage: 'PROD',
    public: true,
  },
  {
    slug: 'demo-metacat',
    name: 'MetaCat',
    provider: 'SDI',
    description: 'A fictional metadata catalogue that is still being built.',
    url: 'https://example.org/sdi/metacat',
    license: 'CC-BY-4.0',
    stage: 'DEV',
    public: false,
  },
  {
    slug: 'demo-cloudlab',
    name: 'CloudLab',
    provider: 'DCF',
    description: 'A fictional cloud platform that lends virtual machines to research groups.',
    url: 'https://example.org/dcf/cloudlab',
    license: 'GPL-3.0-only',
    stage: 'DEMO',
    public: false,
  },
];

/** The slugs of the demo services, in the order they are made. */
export const DEMO_SERVICE_SLUGS: readonly string[] = DEMO_SERVICES.map((item) => item.slug);

export interface ServicesDemoDeps {
  services: Pick<ServicesService, 'create' | 'getBySlug' | 'setPublication'>;
  organisations: Pick<OrganisationsPublic, 'findByAbbreviationAsSystem'>;
}

export function createDemoSeed(deps: () => ServicesDemoDeps) {
  return async function demoSeed(_ctx: unknown, demo: DemoSeedContext): Promise<JobResult> {
    const admin = demo.actors.get('admin');
    if (!admin)
      throw new DemoSeedRefused('registry.services needs the demo accounts of core.identity.');
    const { services, organisations } = deps();
    const consortium = await organisations.findByAbbreviationAsSystem('consortium', 'ERN');
    let created = 0;
    let existing = 0;
    for (const item of DEMO_SERVICES) {
      let view = await services.getBySlug(admin, item.slug).catch((error: unknown) => {
        if (error instanceof NotFound) return undefined;
        throw error;
      });
      if (view) existing += 1;
      else {
        const provider = await organisations.findByAbbreviationAsSystem('provider', item.provider);
        if (!provider) {
          throw new DemoSeedRefused(
            `registry.services needs the demo organisation ${item.provider}; seed registry.organisations first.`,
          );
        }
        view = await services.create(admin, {
          slug: item.slug,
          name: item.name,
          provider: provider.id,
          ...(item.consortium && consortium ? { consortia: [consortium.id] } : {}),
          description: item.description,
          url: item.url,
          license: item.license,
          stage: item.stage,
        });
        created += 1;
      }
      if (item.public && !view.public)
        await services.setPublication(admin, view.id, { public: true });
    }
    return { created, existing };
  };
}
