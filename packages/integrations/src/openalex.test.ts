// The OpenAlex adapter without the network: the answers recorded on 2026-11-25 for one batch of three DOIs (a Crossref
// article, a Zenodo software DOI, and a DOI OpenAlex does not know), asked keyless with `select=doi,cited_by_count`, once
// with `corpus=all` (what the adapter asks) and once without (the Zenodo DOI is missing there). Trimmed to the fields read.
import { describe, expect, it, vi } from 'vitest';
import corpusAll from './fixtures/openalex-works-corpus-all.json' with { type: 'json' };
import corpusCore from './fixtures/openalex-works-corpus-core.json' with { type: 'json' };
import {
  createOpenAlex,
  createStubOpenAlex,
  OPENALEX_BATCH_SIZE,
  openAlexWorksUrl,
  parseWorks,
} from './openalex.ts';

const ARTICLE = '10.1038/s41586-020-2649-2';
const ZENODO = '10.5281/zenodo.4724125';
const UNKNOWN = '10.5555/scorpion-demo.0001';

type Step = { status: number; headers?: Record<string, string>; body?: string };
const reply = ({ status, headers = {}, body = '' }: Step) =>
  new Response(body, { status, headers });
const json = (value: unknown, headers: Record<string, string> = {}): Step => ({
  status: 200,
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(value),
});

/** A fetch that answers the steps in order (or one answer built from the URL) and records each URL and its headers. */
function scripted(...steps: (Step | ((url: URL) => Step))[]) {
  const seen: { url: URL; headers: Record<string, string> }[] = [];
  const fake = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    seen.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
    const step = steps.length > 1 ? steps.shift() : steps[0];
    if (!step) throw new Error('no more answers');
    return Promise.resolve(reply(typeof step === 'function' ? step(url) : step));
  });
  return { fetch: fake as unknown as typeof fetch, seen };
}

const adapter = (fake: typeof fetch, extra: Parameters<typeof createOpenAlex>[0] = {}) =>
  createOpenAlex({ fetch: fake, sleep: () => Promise.resolve(), ...extra });

/** The DOIs of a request's OR filter. */
const askedIn = (url: URL) => url.searchParams.get('filter')!.slice('doi:'.length).split('|');

describe('the recorded answers', () => {
  it('give the counts by normalised DOI and the DOI OpenAlex does not know as not found', async () => {
    const net = scripted(json(corpusAll));
    const result = await adapter(net.fetch).citedByCount([ARTICLE, ZENODO, UNKNOWN]);
    expect(Object.fromEntries(result.counts)).toEqual({ [ARTICLE]: 35378, [ZENODO]: 672 });
    expect(result.notFound).toEqual([UNKNOWN]);
    expect(result.failed).toEqual([]);
  });

  it('show why the adapter asks corpus=all: without it the Zenodo DOI is missing', () => {
    const asked = new Set([ARTICLE, ZENODO, UNKNOWN]);
    expect([...parseWorks(corpusCore, asked)!.counts.keys()]).toEqual([ARTICLE]);
    expect([...parseWorks(corpusAll, asked)!.counts.keys()].sort()).toEqual(
      [ARTICLE, ZENODO].sort(),
    );
  });

  it('match DOIs back from https://doi.org/... in another case, whatever case was asked', async () => {
    const net = scripted(
      json({
        meta: { count: 2 },
        results: [
          { doi: `https://doi.org/${ARTICLE.toUpperCase()}`, cited_by_count: 5 },
          { doi: `HTTPS://DOI.ORG/${ZENODO}`, cited_by_count: 7 },
        ],
      }),
    );
    const result = await adapter(net.fetch).citedByCount([
      `doi:${ARTICLE}`,
      `https://doi.org/${ZENODO.toUpperCase()}`,
    ]);
    expect(Object.fromEntries(result.counts)).toEqual({ [ARTICLE]: 5, [ZENODO]: 7 });
    expect(askedIn(net.seen[0]!.url)).toEqual([ARTICLE, ZENODO]);
  });
});

describe('the request', () => {
  it('asks /works with the OR filter, select, per_page=100 and corpus=all, and nothing else', async () => {
    const net = scripted(json(corpusAll));
    await adapter(net.fetch).citedByCount([ARTICLE, ZENODO, UNKNOWN]);
    const { url } = net.seen[0]!;
    expect(`${url.origin}${url.pathname}`).toBe('https://api.openalex.org/works');
    expect([...url.searchParams.keys()].sort()).toEqual(['corpus', 'filter', 'per_page', 'select']);
    expect(url.searchParams.get('select')).toBe('doi,cited_by_count');
    expect(url.searchParams.get('per_page')).toBe('100');
    expect(url.searchParams.get('corpus')).toBe('all');
    expect(askedIn(url)).toEqual([ARTICLE, ZENODO, UNKNOWN]);
  });

  it('sends the key in the Authorization header and in no URL', async () => {
    const key = `oa-key-${Math.random().toString(36).slice(2)}`;
    const net = scripted(json(corpusAll));
    await adapter(net.fetch, { apiKey: key }).citedByCount([ARTICLE]);
    expect(net.seen[0]!.headers.authorization).toBe(`Bearer ${key}`);
    expect(net.seen[0]!.url.href).not.toContain(key);
    expect(net.seen[0]!.url.searchParams.has('api_key')).toBe(false);
  });

  it('sends no Authorization header without a key', async () => {
    const net = scripted(json(corpusAll));
    await adapter(net.fetch).citedByCount([ARTICLE]);
    expect(net.seen[0]!.headers).not.toHaveProperty('authorization');
  });

  it('splits 250 DOIs into three calls of 100, 100 and 50, and asks each DOI once', async () => {
    const dois = Array.from({ length: 250 }, (_, i) => `10.5555/split-${i}`);
    const net = scripted((url) =>
      json({
        meta: { count: askedIn(url).length },
        results: askedIn(url).map((doi) => ({ doi: `https://doi.org/${doi}`, cited_by_count: 1 })),
      }),
    );
    const result = await adapter(net.fetch).citedByCount([...dois, ...dois.slice(0, 10)]);
    expect(net.seen.map((s) => askedIn(s.url).length)).toEqual([100, 100, 50]);
    expect(new Set(net.seen.flatMap((s) => askedIn(s.url))).size).toBe(250);
    expect(result.counts.size).toBe(250);
    expect(OPENALEX_BATCH_SIZE).toBe(100);
  });

  it('encodes a DOI with OR-filter characters of its own so it stays one value, and refuses one with | or ,', async () => {
    const sici = '10.1002/(sici)1097-0258(19980430)17:8<857::aid-sim777>3.0.co;2-e';
    expect(askedIn(openAlexWorksUrl([sici, ARTICLE]))).toEqual([sici, ARTICLE]);
    const net = scripted(json({ meta: { count: 0 }, results: [] }));
    const result = await adapter(net.fetch).citedByCount(['10.5555/a|b', '10.5555/a,b', ARTICLE]);
    expect(result.failed).toEqual([
      { dois: ['10.5555/a|b', '10.5555/a,b'], reason: 'unsupported-doi' },
    ]);
    expect(askedIn(net.seen[0]!.url)).toEqual([ARTICLE]);
  });

  it('asks nothing for input that is no DOI, and reports it as failed', async () => {
    const net = scripted(json(corpusAll));
    const result = await adapter(net.fetch).citedByCount(['not a doi']);
    expect(net.fetch).not.toHaveBeenCalled();
    expect(result.failed).toEqual([{ dois: ['not a doi'], reason: 'invalid-doi' }]);
  });
});

describe('failures and retries', () => {
  it('waits as long as Retry-After says after a 429, then takes the 200', async () => {
    const waits: number[] = [];
    const net = scripted(
      { status: 429, headers: { 'retry-after': '2' }, body: '{"reason":"requests_per_second"}' },
      json(corpusAll),
    );
    const result = await adapter(net.fetch, {
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    }).citedByCount([ARTICLE]);
    expect(waits).toEqual([2000]);
    expect(net.seen).toHaveLength(2);
    expect(result.counts.get(ARTICLE)).toBe(35378);
  });

  it('backs off exponentially on 5xx without Retry-After, and gives up after three attempts as unavailable', async () => {
    const waits: number[] = [];
    const net = scripted({ status: 503 });
    const result = await adapter(net.fetch, {
      backoffMs: 100,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    }).citedByCount([ARTICLE]);
    expect(net.seen).toHaveLength(3);
    expect(waits).toEqual([100, 200]);
    expect(result).toEqual({
      counts: new Map(),
      notFound: [],
      failed: [{ dois: [ARTICLE], reason: 'unavailable' }],
    });
  });

  it('does not wait for a Retry-After past 30 seconds (the daily budget is spent): rate-limited', async () => {
    const net = scripted({ status: 429, headers: { 'retry-after': '31000' } });
    const result = await adapter(net.fetch).citedByCount([ARTICLE]);
    expect(net.seen).toHaveLength(1);
    expect(result.failed).toEqual([{ dois: [ARTICLE], reason: 'rate-limited' }]);
  });

  it.each([
    [
      'an HTML answer',
      { status: 200, headers: { 'content-type': 'text/html' }, body: '<html>oops</html>' },
      'not-json',
    ],
    [
      'JSON that does not parse',
      { status: 200, headers: { 'content-type': 'application/json' }, body: '{' },
      'not-json',
    ],
    ['JSON of another shape', json({ hello: 'world' }), 'unexpected-shape'],
    [
      'a negative count',
      json({ results: [{ doi: `https://doi.org/${ARTICLE}`, cited_by_count: -1 }] }),
      'unexpected-shape',
    ],
    ['a refused key', { status: 401 }, 'key-refused'],
    ['a key not yet activated', { status: 403 }, 'key-refused'],
    ['a 400', { status: 400 }, 'http-error'],
    [
      'a body over the cap',
      {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': '2000000' },
        body: '{}',
      },
      'too-large',
    ],
  ] as const)(
    'counts %s as a failure, with no count and no "not found"',
    async (_label, step, reason) => {
      const net = scripted(step);
      const result = await adapter(net.fetch).citedByCount([ARTICLE, UNKNOWN]);
      expect(result).toEqual({
        counts: new Map(),
        notFound: [],
        failed: [{ dois: [ARTICLE, UNKNOWN], reason }],
      });
      expect(net.seen).toHaveLength(1);
    },
  );

  it('counts a body that grows past the cap while reading as too large', async () => {
    const big = JSON.stringify({ results: [], pad: 'x'.repeat(2000) });
    const net = scripted(json(JSON.parse(big)));
    const result = await adapter(net.fetch, { maxBodyBytes: 1000 }).citedByCount([ARTICLE]);
    expect(result.failed).toEqual([{ dois: [ARTICLE], reason: 'too-large' }]);
  });

  it('counts a network error as network and a request past the deadline as timeout', async () => {
    const broken = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
    expect((await adapter(broken as never).citedByCount([ARTICLE])).failed).toEqual([
      { dois: [ARTICLE], reason: 'network' },
    ]);
    const slow = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    expect(
      (await adapter(slow as never, { timeoutMs: 20 }).citedByCount([ARTICLE])).failed,
    ).toEqual([{ dois: [ARTICLE], reason: 'timeout' }]);
  });

  it('keeps going after a failed batch: the next batch still answers', async () => {
    const dois = Array.from({ length: 150 }, (_, i) => `10.5555/next-${i}`);
    const net = scripted({ status: 400 }, (url) =>
      json({
        results: askedIn(url).map((doi) => ({ doi: `https://doi.org/${doi}`, cited_by_count: 3 })),
      }),
    );
    const result = await adapter(net.fetch).citedByCount(dois);
    expect(result.failed).toEqual([{ dois: dois.slice(0, 100), reason: 'http-error' }]);
    expect(result.counts.size).toBe(50);
  });

  it('treats DOIs missing from a page that holds fewer results than the count as unknown, not as not found', async () => {
    const net = scripted(
      json({
        meta: { count: 150 },
        results: [{ doi: `https://doi.org/${ARTICLE}`, cited_by_count: 1 }],
      }),
    );
    const result = await adapter(net.fetch).citedByCount([ARTICLE, UNKNOWN]);
    expect(result.notFound).toEqual([]);
    expect(result.failed).toEqual([{ dois: [UNKNOWN], reason: 'incomplete' }]);
  });

  it('never puts a URL or the key into a failure', async () => {
    const key = `secret-${Math.random().toString(36).slice(2)}`;
    const net = scripted({ status: 500 });
    const result = await adapter(net.fetch, { apiKey: key }).citedByCount([ARTICLE]);
    const text = JSON.stringify(result);
    expect(text).not.toContain(key);
    expect(text).not.toContain('openalex.org');
  });
});

describe('createStubOpenAlex', () => {
  it('answers from its table, says not found for anything else, in batches of 100, and never fetches', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const stub = createStubOpenAlex({ [ARTICLE.toUpperCase()]: 9 });
    const dois = [ARTICLE, ...Array.from({ length: 120 }, (_, i) => `10.5555/stub-${i}`)];
    const result = await stub.citedByCount(dois);
    expect(result.counts.get(ARTICLE)).toBe(9);
    expect(result.notFound).toHaveLength(120);
    expect(stub.calls.map((batch) => batch.length)).toEqual([100, 21]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
