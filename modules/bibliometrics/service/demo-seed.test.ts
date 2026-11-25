// The demo seed (ADR-0046): three fictional publications on two demo services, with their metadata, through the service as
// the demo administrator, and not one request: neither the module's resolver nor `fetch` is called.
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
    const s = await h.start({
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
    });
    expect(await s.manifest.demoSeed!(undefined as never, demo)).toEqual({
      created: 0,
      unchanged: 3,
    });

    expect(calls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await countRows(s.pool, 'biblio_publication')).toBe(3);
    expect(await countRows(s.pool, 'biblio_doi_metadata', `status = 'ok'`)).toBe(3);
    const { rows } = await s.pool.query<{ doi: string; title: string }>(
      'select doi, title from biblio_doi_metadata order by doi',
    );
    expect(rows).toEqual(
      DEMO_PUBLICATIONS.map((item) => ({ doi: item.doi, title: item.metadata.title })),
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
