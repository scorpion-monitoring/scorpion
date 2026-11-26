// The demo seed of bibliometrics (`scorpion seed --demo`, ADR-0046): three fictional publications on two demo services,
// under the Crossref test prefix `10.5555`. They are added through the service as the demo administrator, with a resolver
// that answers from the table below, so the seed passes the same checks as a request and makes no network call. A second
// run changes nothing (the unique `(service, doi)` answers 409, which counts as unchanged).
//
// Each publication also gets two citation snapshots, a week apart, so the page has a history to draw: two refreshes of the
// demo services through the citation service, with a source that answers from the table below and a clock set to each
// date. They are skipped when the demo DOIs have counts already.
import { Conflict } from '@scorpion/contracts';
import { createStubDoiResolver, type DoiMetadata } from '@scorpion/integrations';
import { DemoSeedRefused, type DemoSeedContext, type JobResult } from '@scorpion/kernel';
import { DEMO_SERVICE_SLUGS, type ServicesPublic } from '@scorpion/registry-services/public';
import type { CitationService } from './citations.ts';
import type { PublicationsService } from './publications.ts';
import type { CitationSourceEntry } from './sources.ts';

/** The fictional publications: which demo service (by index into `DEMO_SERVICE_SLUGS`) lists which DOI. */
export const DEMO_PUBLICATIONS: readonly {
  service: number;
  doi: string;
  metadata: DoiMetadata;
  /** The fictional citation counts of the two snapshots: a week ago, and now. */
  citations: readonly [number, number];
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
    citations: [41, 44],
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
    citations: [7, 9],
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
    citations: [120, 123],
  },
];

export interface BibliometricsDemoDeps {
  /** A publications service whose resolver is the table above (`demoResolver`); never the real one. */
  publications: Pick<PublicationsService, 'add'>;
  services: Pick<ServicesPublic, 'findBySlugAsSystem'>;
  /** A citation service whose only source is `source` and whose "now" is `now` (`demoCitationSource`); never the real one. */
  citations: (
    source: CitationSourceEntry,
    now: Date,
  ) => Pick<CitationService, 'refresh' | 'latest'>;
}

/** The demo's citation source: answers from `counts`, asks nothing. Its id is the built-in one, so the page shows it. */
export function demoCitationSource(counts: ReadonlyMap<string, number>): CitationSourceEntry {
  return {
    id: 'openalex',
    label: 'OpenAlex (demo data)',
    enabled: () => true,
    fetchCounts(dois) {
      return Promise.resolve({
        counts: new Map(dois.flatMap((doi) => (counts.has(doi) ? [[doi, counts.get(doi)!]] : []))),
        notFound: dois.filter((doi) => !counts.has(doi)),
        failed: [],
      });
    },
  };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The resolver the seed's service uses: the table, and nothing else. */
export const demoResolver = () =>
  createStubDoiResolver(Object.fromEntries(DEMO_PUBLICATIONS.map((p) => [p.doi, p.metadata])));

export function createDemoSeed(deps: () => BibliometricsDemoDeps) {
  return async function demoSeed(_ctx: unknown, demo: DemoSeedContext): Promise<JobResult> {
    const admin = demo.actors.get('admin');
    if (!admin)
      throw new DemoSeedRefused('bibliometrics needs the demo accounts of core.identity.');
    const { publications, services, citations } = deps();
    let created = 0;
    let unchanged = 0;
    const serviceIds = new Set<string>();
    // Every demo service first, so nothing is written when one is missing.
    const found = [];
    for (const item of DEMO_PUBLICATIONS) {
      const slug = DEMO_SERVICE_SLUGS[item.service];
      const service = slug ? await services.findBySlugAsSystem(slug) : undefined;
      if (!service)
        throw new DemoSeedRefused(
          `bibliometrics needs the demo service ${slug ?? `#${item.service}`}; seed registry.services first.`,
        );
      found.push({ item, service });
    }
    for (const { item, service } of found) {
      serviceIds.add(service.id);
      try {
        await publications.add(admin, service.id, item.doi);
        created++;
      } catch (error) {
        if (!(error instanceof Conflict)) throw error;
        unchanged++;
      }
    }

    const dois = DEMO_PUBLICATIONS.map((item) => item.doi);
    let snapshots = 0;
    const now = new Date();
    const probe = citations(demoCitationSource(new Map()), now);
    if ((await probe.latest(dois)).counts.size === 0) {
      for (const [index, at] of [new Date(now.getTime() - WEEK_MS), now].entries()) {
        const table = new Map(DEMO_PUBLICATIONS.map((item) => [item.doi, item.citations[index]!]));
        const report = await citations(demoCitationSource(table), at).refresh('schedule', {
          serviceIds: [...serviceIds],
        });
        snapshots += report.found;
      }
    }
    return { created, unchanged, snapshots };
  };
}
