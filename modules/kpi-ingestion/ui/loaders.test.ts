// What the data-submission loader reads, and how often (M12a sprint 5). The reference data (adapters, the two vocabularies, the value
// types) is the same for a whole visit, so a month change, which loads the page again, reads it from the visit cache and not from the
// API again: nine reads on the first load, five on every change of month. The API is a stub that records its calls.
import type { UiLoadContext } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { loadSubmit } from './loaders.ts';

const SERVICE = '0198f3a5-1d44-7e08-a6b1-93c2d0f47e55';
const REFERENCE = [
  '/kpi/ingestion/adapters',
  '/vocabularies/{vocabulary}/terms',
  '/kpi/value-types',
] as const;

function stub(failFirstReference = false) {
  const calls: string[] = [];
  let failing = failFirstReference;
  const ok = (data: unknown) =>
    Promise.resolve({ data, response: new Response(null, { status: 200 }) });
  const api = {
    GET: (path: string, init?: { params?: { path?: { vocabulary?: string } } }) => {
      calls.push(
        path === '/vocabularies/{vocabulary}/terms'
          ? `${path}:${init?.params?.path?.vocabulary}`
          : path,
      );
      if (failing && path === '/kpi/ingestion/adapters') {
        failing = false;
        return Promise.resolve({
          error: { title: 'x', status: 500 },
          response: new Response(null, { status: 500 }),
        });
      }
      switch (path) {
        case '/kpi/ingestion/services':
          return ok({ result: [{ id: SERVICE, slug: 's', name: 'S' }] });
        case '/services/{id}':
          return ok({ id: SERVICE, slug: 's', name: 'S' });
        case '/kpi/measurements/coverage':
          return ok({ result: [{ period: '2026-09-30', mandatory: 1, present: 1 }] });
        case '/kpi/measurements':
        case '/kpi/ingestion/runs':
        case '/kpi/ingestion/adapters':
        case '/kpi/value-types':
        case '/vocabularies/{vocabulary}/terms':
          return ok({ result: [] });
        default:
          throw new Error(`unexpected read ${path}`);
      }
    },
  };
  return { api, calls };
}

/** A visit cache like the shell's, as small as can be: one answer per key. */
function visit() {
  const kept = new Map<string, Promise<unknown>>();
  return <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const hit = kept.get(key);
    if (hit) return hit as Promise<T>;
    const value = load();
    kept.set(key, value);
    return value;
  };
}

const context = (
  api: unknown,
  remember: UiLoadContext['remember'],
  query = `service=${SERVICE}&period=2026-09`,
) =>
  ({
    api,
    remember,
    url: new URL(`https://example.test/submit?${query}`),
    params: {},
    locale: 'en',
    redirect: () => {
      throw new Error('no redirect expected');
    },
    publicApi: {},
  }) as unknown as UiLoadContext;

const referenceReads = (calls: string[]) =>
  calls.filter((call) => REFERENCE.some((path) => call.startsWith(path)));

describe('the data-submission loader', () => {
  it('reads the reference data once per visit: a month change reads five things, not nine', async () => {
    const { api, calls } = stub();
    const remember = visit();
    await loadSubmit(context(api, remember));
    expect(calls).toHaveLength(9);
    expect(referenceReads(calls)).toHaveLength(4);

    calls.length = 0;
    await loadSubmit(context(api, remember, `service=${SERVICE}&period=2026-08`));
    expect(calls).toHaveLength(5);
    expect(referenceReads(calls)).toEqual([]);
    expect(calls).toEqual(
      expect.arrayContaining([
        '/kpi/ingestion/services',
        '/services/{id}',
        '/kpi/measurements/coverage',
        '/kpi/ingestion/runs',
        '/kpi/measurements',
      ]),
    );
  });

  it('gives the page the same reference data on every load', async () => {
    const { api } = stub();
    const remember = visit();
    const first = await loadSubmit(context(api, remember));
    const second = await loadSubmit(context(api, remember, `service=${SERVICE}&period=2026-08`));
    const reference = (data: typeof first) =>
      data.selected && {
        adapters: data.selected.adapters,
        necessity: data.selected.necessity,
        units: data.selected.units,
        types: data.selected.types,
      };
    expect(reference(second)).toEqual(reference(first));
    expect(reference(first)).not.toBeUndefined();
  });

  it('reads the reference data again for another visitor, and throws when it cannot read it', async () => {
    const { api, calls } = stub(true);
    await expect(loadSubmit(context(api, visit()))).rejects.toThrow();
    calls.length = 0;
    await loadSubmit(context(api, visit()));
    expect(referenceReads(calls)).toHaveLength(4);
  });
});
