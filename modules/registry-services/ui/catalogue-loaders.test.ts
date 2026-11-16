// What the two catalogue loaders ask of the API (sprint 3 of M12a): with a search text, the facets once more
// without it (the values the search offers and the hint of decision Q2), with the same filters; without a text,
// no second read. The API is a stub that records its calls.
import type { UiLoadContext } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { loadCatalogue, loadPublicCatalogue } from './loaders.ts';

type Call = { path: string; query: Record<string, unknown> };

function stub() {
  const calls: Call[] = [];
  const ok = (data: unknown) =>
    Promise.resolve({ data, response: new Response(null, { status: 200 }) });
  const facet = (label: string) => ({ id: 'stage', label, values: [], options: [] });
  const api = {
    GET: (path: string, init?: { params?: { query?: Record<string, unknown> } }) => {
      const query = init?.params?.query ?? {};
      calls.push({ path, query });
      switch (path) {
        case '/services':
          return ok({ result: [], metadata: { totalCount: 0 } });
        case '/services/facets':
          return ok({ result: [facet(query.q ? 'with text' : 'without text')] });
        case '/account/permissions':
          return ok({ result: [], metadata: { totalCount: 0 } });
        case '/catalog/services':
          return ok({
            result: [],
            metadata: { totalCount: 0 },
            facets: [facet(query.q ? 'with text' : 'without text')],
          });
        default:
          throw new Error(`unexpected call ${path}`);
      }
    },
  };
  return { api: api as unknown as UiLoadContext['api'], calls };
}

const context = (api: UiLoadContext['api'], address: string) =>
  ({ api, locale: 'en', params: {}, url: new URL(address) }) as UiLoadContext;

describe('the catalogue loader', () => {
  it('asks for the facets once more without the text, with the same filters, while there is a text', async () => {
    const { api, calls } = stub();
    const data = await loadCatalogue(context(api, 'http://x/services?q=ipk&f.stage=PROD'));
    const facets = calls.filter((call) => call.path === '/services/facets');
    expect(facets.map((call) => call.query.q)).toEqual(['ipk', undefined]);
    expect(facets.map((call) => call.query.stage)).toEqual([['PROD'], ['PROD']]);
    expect(data.facets[0]?.label).toBe('with text');
    expect(data.suggestions[0]?.label).toBe('without text');
  });

  it('asks once without a text, and offers the same facets', async () => {
    const { api, calls } = stub();
    const data = await loadCatalogue(context(api, 'http://x/services'));
    expect(calls.filter((call) => call.path === '/services/facets')).toHaveLength(1);
    expect(data.suggestions).toBe(data.facets);
  });
});

describe('the public catalogue loader', () => {
  it('asks for one smallest page without the text, with the same filters, while there is a text', async () => {
    const { api, calls } = stub();
    const data = await loadPublicCatalogue(
      context(api, 'http://x/catalog/services?q=ipk&f.stage=PROD&page=2'),
    );
    const lists = calls.filter((call) => call.path === '/catalog/services');
    expect(lists.map(({ query }) => [query.q, query.page, query.pageSize, query.stage])).toEqual([
      ['ipk', '2', '20', ['PROD']],
      [undefined, '0', '1', ['PROD']],
    ]);
    expect(data.suggestions[0]?.label).toBe('without text');
  });

  it('asks once without a text', async () => {
    const { api, calls } = stub();
    await loadPublicCatalogue(context(api, 'http://x/catalog/services'));
    expect(calls.filter((call) => call.path === '/catalog/services')).toHaveLength(1);
  });
});
