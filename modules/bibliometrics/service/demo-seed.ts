// The demo seed of bibliometrics (`scorpion seed --demo`, ADR-0046): three fictional publications on two demo services,
// under the Crossref test prefix `10.5555`. They are added through the service as the demo administrator, with a resolver
// that answers from the table below, so the seed passes the same checks as a request and makes no network call. A second
// run changes nothing (the unique `(service, doi)` answers 409, which counts as unchanged). Sprint 2 adds the snapshots.
import { Conflict } from '@scorpion/contracts';
import { createStubDoiResolver, type DoiMetadata } from '@scorpion/integrations';
import { DemoSeedRefused, type DemoSeedContext, type JobResult } from '@scorpion/kernel';
import { DEMO_SERVICE_SLUGS, type ServicesPublic } from '@scorpion/registry-services/public';
import type { PublicationsService } from './publications.ts';

/** The fictional publications: which demo service (by index into `DEMO_SERVICE_SLUGS`) lists which DOI. */
export const DEMO_PUBLICATIONS: readonly {
  service: number;
  doi: string;
  metadata: DoiMetadata;
}[] = [
  {
    service: 0,
    doi: '10.5555/scorpion-demo.0001',
    metadata: {
      title: 'A fictional service for the annotation of demo genomes',
      authors: ['Ada Example', 'Bo Placeholder', 'Chris Sample', 'Dana Fixture'],
      issued: { date: '2024-03-12', precision: 'day' },
      container: 'Journal of Demonstration Data',
      type: 'journal-article',
    },
  },
  {
    service: 0,
    doi: '10.5555/scorpion-demo.0002',
    metadata: {
      title: 'Demo genome annotator, release 2.0',
      authors: ['The Demo Annotator Team'],
      issued: { date: '2025-06', precision: 'month' },
      container: 'Example Software Repository',
      type: 'software',
    },
  },
  {
    service: 1,
    doi: '10.5555/scorpion-demo.0003',
    metadata: {
      title: 'Ten years of a fictional workflow platform',
      authors: ['Eli Mock', 'Fay Dummy'],
      issued: { date: '2023', precision: 'year' },
      container: 'Proceedings of the Example Conference',
      type: 'paper-conference',
    },
  },
];

export interface BibliometricsDemoDeps {
  /** A publications service whose resolver is the table above (`demoResolver`); never the real one. */
  publications: Pick<PublicationsService, 'add'>;
  services: Pick<ServicesPublic, 'findBySlugAsSystem'>;
}

/** The resolver the seed's service uses: the table, and nothing else. */
export const demoResolver = () =>
  createStubDoiResolver(Object.fromEntries(DEMO_PUBLICATIONS.map((p) => [p.doi, p.metadata])));

export function createDemoSeed(deps: () => BibliometricsDemoDeps) {
  return async function demoSeed(_ctx: unknown, demo: DemoSeedContext): Promise<JobResult> {
    const admin = demo.actors.get('admin');
    if (!admin)
      throw new DemoSeedRefused('bibliometrics needs the demo accounts of core.identity.');
    const { publications, services } = deps();
    let created = 0;
    let unchanged = 0;
    for (const item of DEMO_PUBLICATIONS) {
      const slug = DEMO_SERVICE_SLUGS[item.service];
      const service = slug ? await services.findBySlugAsSystem(slug) : undefined;
      if (!service)
        throw new DemoSeedRefused(
          `bibliometrics needs the demo service ${slug ?? `#${item.service}`}; seed registry.services first.`,
        );
      try {
        await publications.add(admin, service.id, item.doi);
        created++;
      } catch (error) {
        if (!(error instanceof Conflict)) throw error;
        unchanged++;
      }
    }
    return { created, unchanged };
  };
}
