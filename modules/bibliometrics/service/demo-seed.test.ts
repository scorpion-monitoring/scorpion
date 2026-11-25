// The demo seed (ADR-0046): three fictional publications on two demo services, with their metadata and two citation
// snapshots each, through the services as the demo administrator, and not one request: neither the module's resolver, nor
// its OpenAlex adapter, nor `fetch` is called.
import type { DemoSeedContext } from '@scorpion/kernel';
import { DEMO_SERVICE_SLUGS } from '@scorpion/registry-services/public';
import { makeOrganisation, makeService } from '@scorpion/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { countRows, useBibliometrics } from '../test/harness.ts';
import { DEMO_PUBLICATIONS } from './demo-seed.ts';

const h = useBibliometrics();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the demo seed', () => {
  it('uses fictional DOIs under the Crossref test prefix on two demo services', () => {
    expect(DEMO_PUBLICATIONS).toHaveLength(3);
    expect(new Set(DEMO_PUBLICATIONS.map((item) => item.service)).size).toBe(2);
    for (const item of DEMO_PUBLICATIONS)
      expect(item.doi.startsWith('10.5555/scorpion-demo.')).toBe(true);
  });

  it('stores the publications with their metadata, makes no request, and changes nothing on a second run', async () => {
    const calls: string[] = [];
    const openAlexAsked: string[] = [];
    const s = await h.start({
      openAlex: () => ({
        citedByCount(dois) {
          openAlexAsked.push(...dois);
          return Promise.resolve({ counts: new Map(), notFound: [], failed: [] });
        },
      }),
      resolver: {
        resolve(doi) {
          calls.push(doi);
          return Promise.resolve({ status: 'failed', reason: 'network' });
        },
      },
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    for (const slug of DEMO_SERVICE_SLUGS.slice(0, 2))
      await makeService(s.pool, { slug, provider: provider.id });
    const demo: DemoSeedContext = {
      actors: new Map([['admin', await s.actor('admin')]]),
      password: undefined,
      allowProduction: false,
      out: () => undefined,
    };

    expect(await s.manifest.demoSeed!(undefined as never, demo)).toEqual({
      created: 3,
      unchanged: 0,
      snapshots: 6,
    });
    expect(await s.manifest.demoSeed!(undefined as never, demo)).toEqual({
      created: 0,
      unchanged: 3,
      snapshots: 0,
    });

    expect(calls).toEqual([]);
    expect(openAlexAsked).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await countRows(s.pool, 'biblio_publication')).toBe(3);
    expect(await countRows(s.pool, 'biblio_doi_metadata', `status = 'ok'`)).toBe(3);
    const { rows } = await s.pool.query<{ doi: string; title: string }>(
      'select doi, title from biblio_doi_metadata order by doi',
    );
    expect(rows).toEqual(
      DEMO_PUBLICATIONS.map((item) => ({ doi: item.doi, title: item.metadata.title })),
    );

    // Two snapshots a week apart per publication: the history has two points, the list the latest.
    expect(await countRows(s.pool, 'biblio_citation_snapshot')).toBe(6);
    const first = DEMO_PUBLICATIONS[0]!;
    const service = (
      await s.pool.query<{ service_id: string; id: string }>(
        'select service_id, id from biblio_publication where doi = $1',
        [first.doi],
      )
    ).rows[0]!;
    const admin = demo.actors.get('admin')!;
    const history = await s.biblio.citations.history(admin, service.service_id, service.id);
    expect(history.points.map((point) => point.citedByCount)).toEqual([...first.citations]);
    const page = await s.biblio.publications.list(admin, service.service_id, {
      page: 0,
      pageSize: 5,
    });
    expect(page.items.find((item) => item.doi === first.doi)?.citedByCount).toBe(
      first.citations[1],
    );
  });

  it('refuses without the demo services', async () => {
    const s = await h.start();
    const demo: DemoSeedContext = {
      actors: new Map([['admin', await s.actor('admin')]]),
      password: undefined,
      allowProduction: false,
      out: () => undefined,
    };
    await expect(s.manifest.demoSeed!(undefined as never, demo)).rejects.toThrow(
      /seed registry.services first/,
    );
  });
});
