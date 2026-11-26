// The DOI adapter without the network: `normaliseDoi` table-driven, the CSL-JSON parser on answers recorded from Crossref and
// DataCite on 2026-11-25 (trimmed to the fields it reads), and the resolver over a fake `fetch` for the redirect rule, the
// body cap, the shape check and the status codes.
import { describe, expect, it, vi } from 'vitest';
import crossref from './fixtures/doi-crossref-journal-article.json' with { type: 'json' };
import datacite from './fixtures/doi-datacite-zenodo-software.json' with { type: 'json' };
import {
  createDoiResolver,
  createStubDoiResolver,
  DOI_ACCEPT,
  DOI_MAX_AUTHORS,
  DOI_MAX_TITLE,
  doiUrl,
  normaliseDoi,
  parseCslJson,
  parseIssued,
} from './doi.ts';

describe('normaliseDoi', () => {
  const long = (n: number) => `10.1234/${'a'.repeat(n - '10.1234/'.length)}`;
  it.each([
    ['a plain DOI', '10.1038/s41586-020-2649-2', '10.1038/s41586-020-2649-2'],
    ['upper case', '10.5281/ZENODO.4724125', '10.5281/zenodo.4724125'],
    ['whitespace around it', '  10.1038/abc \n', '10.1038/abc'],
    ['https://doi.org/', 'https://doi.org/10.1038/abc', '10.1038/abc'],
    ['http://doi.org/', 'http://doi.org/10.1038/abc', '10.1038/abc'],
    ['https://dx.doi.org/', 'https://dx.doi.org/10.1038/abc', '10.1038/abc'],
    ['http://dx.doi.org/', 'http://dx.doi.org/10.1038/abc', '10.1038/abc'],
    ['doi.org/', 'doi.org/10.1038/abc', '10.1038/abc'],
    ['dx.doi.org/', 'dx.doi.org/10.1038/abc', '10.1038/abc'],
    ['doi:', 'doi:10.1038/abc', '10.1038/abc'],
    ['DOI: in upper case with a space', 'DOI: 10.1038/ABC', '10.1038/abc'],
    ['a prefix in mixed case', 'HTTPS://DOI.ORG/10.1038/abc', '10.1038/abc'],
    ['a URL with a fragment', 'https://doi.org/10.1038/abc#section-2', '10.1038/abc'],
    ['a percent-encoded URL', 'https://doi.org/10.1038%2Fabc', '10.1038/abc'],
    ['a registrant with a sub-code', '10.1000.10/xyz', '10.1000.10/xyz'],
    ['a suffix with slashes and parentheses', '10.1002/(sici)1097/x', '10.1002/(sici)1097/x'],
    ['256 characters', long(256), long(256)],
  ])('accepts %s', (_label, input, expected) => {
    expect(normaliseDoi(input)).toEqual({ ok: true, doi: expected });
  });

  it.each([
    ['257 characters', long(257)],
    ['far too long', 'x'.repeat(5000)],
    ['an empty string', ''],
    ['only a prefix', 'https://doi.org/'],
    ['not a DOI', 'hello world'],
    ['an ISBN', '978-3-16-148410-0'],
    ['a URL of another host', 'https://example.org/10.1038/abc'],
    ['no suffix', '10.1038/'],
    ['a short registrant', '10.12/abc'],
    ['whitespace inside', '10.1038/ab c'],
    ['a control character', '10.1038/ab\u0007c'],
    ['a URL with a query', 'https://doi.org/10.1038/abc?x=1'],
    ['a bad percent escape', 'https://doi.org/10.1038/%zz'],
    ['a number', 42],
    ['null', null],
  ])('refuses %s', (_label, input) => {
    expect(normaliseDoi(input).ok).toBe(false);
  });

  it('builds the doi.org address segment by segment, so the host stays doi.org', () => {
    expect(doiUrl('10.1038/abc')).toBe('https://doi.org/10.1038/abc');
    expect(new URL(doiUrl('10.1038/@evil.example#x')).host).toBe('doi.org');
    expect(doiUrl('10.1038/a?b')).toBe('https://doi.org/10.1038/a%3Fb');
  });
});

describe('parseCslJson', () => {
  it('reads a Crossref journal article', () => {
    expect(parseCslJson(crossref)).toEqual({
      title: 'Array programming with NumPy',
      authors: ['Charles R. Harris', 'K. Jarrod Millman', 'Stéfan J. van der Walt'],
      issued: { date: '2020-09-16', precision: 'day' },
      container: 'Nature',
      type: 'journal-article',
    });
  });

  it('reads a DataCite (Zenodo) software record: a family-only author, the repository as the container', () => {
    expect(parseCslJson(datacite)).toEqual({
      title: 'TensorFlow',
      authors: ['TensorFlow Developers'],
      issued: { date: '2026-11-17', precision: 'day' },
      container: 'Zenodo',
      type: 'software',
    });
  });

  it.each([
    ['not an object', 'x'],
    ['an array', [crossref]],
    ['null', null],
    ['no title', { type: 'dataset' }],
    ['a blank title', { title: '  ' }],
  ])('refuses %s', (_label, input) => {
    expect(parseCslJson(input)).toBeUndefined();
  });

  it('bounds every field', () => {
    const parsed = parseCslJson({
      title: ['<i>Big</i>   &amp; ' + 'x'.repeat(5000)],
      author: Array.from({ length: 300 }, (_, i) => ({
        literal: `Consortium ${i} ${'y'.repeat(500)}`,
      })),
      'container-title': ['z'.repeat(2000)],
      type: 'NOT A TYPE; drop table',
    })!;
    expect(parsed.title.startsWith('Big & xxx')).toBe(true);
    expect([...parsed.title]).toHaveLength(DOI_MAX_TITLE);
    expect(parsed.authors).toHaveLength(DOI_MAX_AUTHORS);
    expect(parsed.authors.every((name) => name.length <= 200)).toBe(true);
    expect(parsed.container).toHaveLength(500);
    expect(parsed.type).toBeNull();
  });

  it('skips authors without a name and takes `literal` over given and family', () => {
    expect(
      parseCslJson({
        title: 'T',
        author: [{}, null, { given: 'Ada' }, { literal: 'The Team', family: 'ignored' }],
      })!.authors,
    ).toEqual(['Ada', 'The Team']);
  });
});

describe('parseIssued', () => {
  it.each([
    [{ 'date-parts': [[2020]] }, { date: '2020', precision: 'year' }],
    [{ 'date-parts': [[2020, 2]] }, { date: '2020-02', precision: 'month' }],
    [{ 'date-parts': [[2020, 2, 29]] }, { date: '2020-02-29', precision: 'day' }],
    [{ 'date-parts': [[2021, 2, 29]] }, { date: '2021-02', precision: 'month' }],
    [{ 'date-parts': [['2019', '7']] }, { date: '2019-07', precision: 'month' }],
    [{ 'date-parts': [[2020, 13, 1]] }, { date: '2020', precision: 'year' }],
    [{ 'date-parts': [[99]] }, null],
    [{ 'date-parts': [[]] }, null],
    [{ raw: '2020' }, null],
    [undefined, null],
  ])('reads %j as %j', (input, expected) => {
    expect(parseIssued(input)).toEqual(expected);
  });
});

// ----- The resolver over a fake fetch -------------------------------------------------------------

type Step = { status: number; headers?: Record<string, string>; body?: string };
const reply = ({ status, headers = {}, body = '' }: Step) =>
  new Response(status === 204 || (status >= 300 && status < 400) ? null : body, {
    status,
    headers,
  });
const json = (value: unknown): Step => ({
  status: 200,
  headers: { 'content-type': `${DOI_ACCEPT}; charset=utf-8` },
  body: JSON.stringify(value),
});
const redirect = (location: string): Step => ({ status: 302, headers: { location } });

/** A fetch that answers the steps in order and records each URL and its options. */
function scripted(...steps: Step[]) {
  const seen: { url: string; init: RequestInit | undefined }[] = [];
  const fake = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: input instanceof Request ? input.url : input.toString(), init });
    const step = steps.shift();
    if (!step) throw new Error('no more answers');
    return Promise.resolve(reply(step));
  });
  return { fetch: fake as unknown as typeof fetch, seen };
}

const resolver = (fake: typeof fetch, extra = {}) =>
  createDoiResolver({ fetch: fake, sleep: () => Promise.resolve(), ...extra });

describe('createDoiResolver', () => {
  it('follows the redirect of doi.org to the agency and asks for CSL-JSON without following redirects itself', async () => {
    const net = scripted(
      redirect('https://api.crossref.org/v1/works/10.1038%2Fs41586-020-2649-2/transform'),
      json(crossref),
    );
    const result = await resolver(net.fetch).resolve('10.1038/s41586-020-2649-2');
    expect(result).toEqual({ status: 'ok', metadata: parseCslJson(crossref) });
    expect(net.seen.map((call) => call.url)).toEqual([
      'https://doi.org/10.1038/s41586-020-2649-2',
      'https://api.crossref.org/v1/works/10.1038%2Fs41586-020-2649-2/transform',
    ]);
    expect(net.seen[0]!.init).toMatchObject({
      redirect: 'manual',
      headers: { accept: DOI_ACCEPT },
    });
  });

  it('reads a DataCite answer', async () => {
    const net = scripted(
      redirect('https://data.crosscite.org/10.5281%2Fzenodo.4724125'),
      json(datacite),
    );
    expect(await resolver(net.fetch).resolve('10.5281/zenodo.4724125')).toMatchObject({
      status: 'ok',
      metadata: { title: 'TensorFlow', type: 'software' },
    });
  });

  it('refuses a redirect to http:', async () => {
    const net = scripted(redirect('http://api.crossref.org/v1/works/x'), json(crossref));
    expect(await resolver(net.fetch).resolve('10.1038/abc')).toEqual({
      status: 'failed',
      reason: 'redirect-refused',
    });
    expect(net.seen).toHaveLength(1);
  });

  it.each([
    ['another scheme', 'file:///etc/passwd'],
    ['credentials in the address', 'https://user:pw@example.org/x'],
  ])('refuses a redirect with %s', async (_label, location) => {
    const net = scripted(redirect(location));
    expect(await resolver(net.fetch).resolve('10.1038/abc')).toEqual({
      status: 'failed',
      reason: 'redirect-refused',
    });
  });

  it('follows five redirects and refuses the sixth', async () => {
    const five = Array.from({ length: 5 }, (_, i) => redirect(`https://hop${i}.example.org/`));
    expect(
      await resolver(scripted(...five, json(crossref)).fetch).resolve('10.1038/abc'),
    ).toMatchObject({ status: 'ok' });

    const six = Array.from({ length: 6 }, (_, i) => redirect(`https://hop${i}.example.org/`));
    const net = scripted(...six, json(crossref));
    expect(await resolver(net.fetch).resolve('10.1038/abc')).toEqual({
      status: 'failed',
      reason: 'too-many-redirects',
    });
    expect(net.seen).toHaveLength(6);
  });

  it('refuses a body over the cap, by its declared length and while reading', async () => {
    const big = JSON.stringify({ ...crossref, abstract: 'x'.repeat(2048) });
    const declared = scripted({
      status: 200,
      headers: { 'content-type': DOI_ACCEPT, 'content-length': String(big.length) },
      body: big,
    });
    expect(await resolver(declared.fetch, { maxBodyBytes: 1024 }).resolve('10.1038/abc')).toEqual({
      status: 'failed',
      reason: 'too-large',
    });
    const undeclared = scripted({
      status: 200,
      headers: { 'content-type': DOI_ACCEPT },
      body: big,
    });
    expect(await resolver(undeclared.fetch, { maxBodyBytes: 1024 }).resolve('10.1038/abc')).toEqual(
      { status: 'failed', reason: 'too-large' },
    );
  });

  it('counts an HTML answer as a failure, not as data', async () => {
    const net = scripted({
      status: 200,
      headers: { 'content-type': 'text/html;charset=utf-8' },
      body: '<!DOCTYPE html><title>Error</title>',
    });
    expect(await resolver(net.fetch).resolve('10.1038/abc')).toEqual({
      status: 'failed',
      reason: 'not-csl-json',
    });
  });

  it('counts JSON that is not CSL, and a body that is not JSON, as failures', async () => {
    expect(
      await resolver(scripted(json({ message: 'nope' })).fetch).resolve('10.1038/abc'),
    ).toEqual({ status: 'failed', reason: 'unexpected-shape' });
    expect(
      await resolver(
        scripted({ status: 200, headers: { 'content-type': DOI_ACCEPT }, body: '{nope' }).fetch,
      ).resolve('10.1038/abc'),
    ).toEqual({ status: 'failed', reason: 'not-csl-json' });
  });

  it('makes a 404 of doi.org itself not-found', async () => {
    const net = scripted({
      status: 404,
      headers: { 'content-type': 'text/html;charset=utf-8' },
      body: '<!DOCTYPE html><title>Error: DOI Not Found</title>',
    });
    expect(await resolver(net.fetch).resolve('10.1234/does-not-exist')).toEqual({
      status: 'not-found',
    });
  });

  it('makes a 404 of the agency after a redirect a failure, to be retried later', async () => {
    const net = scripted(redirect('https://data.crosscite.org/x'), { status: 404 });
    expect(await resolver(net.fetch).resolve('10.5281/zenodo.1')).toEqual({
      status: 'failed',
      reason: 'http-error',
    });
  });

  it('retries once after a 429, honouring Retry-After, then gives up as unavailable', async () => {
    const waits: number[] = [];
    const sleep = (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    };
    const recovered = scripted({ status: 429, headers: { 'retry-after': '1' } }, json(crossref));
    expect(
      await createDoiResolver({ fetch: recovered.fetch, sleep }).resolve('10.1038/abc'),
    ).toMatchObject({ status: 'ok' });
    expect(waits).toEqual([1000]);

    const down = scripted({ status: 503 }, { status: 503 }, { status: 503 });
    expect(await resolver(down.fetch).resolve('10.1038/abc')).toEqual({
      status: 'failed',
      reason: 'unavailable',
    });
    expect(down.seen).toHaveLength(2);
  });

  it('does not wait past its deadline for a Retry-After', async () => {
    const net = scripted({ status: 429, headers: { 'retry-after': '3600' } }, json(crossref));
    expect(await resolver(net.fetch).resolve('10.1038/abc')).toEqual({
      status: 'failed',
      reason: 'unavailable',
    });
    expect(net.seen).toHaveLength(1);
  });

  it('times out', async () => {
    const hanging = ((_input: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason as Error));
      })) as typeof fetch;
    expect(await resolver(hanging, { timeoutMs: 20 }).resolve('10.1038/abc')).toEqual({
      status: 'failed',
      reason: 'timeout',
    });
  });

  it('says network for a fetch that throws', async () => {
    const broken = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
    expect(await resolver(broken).resolve('10.1038/abc')).toEqual({
      status: 'failed',
      reason: 'network',
    });
  });

  it('makes no request for an invalid DOI', async () => {
    const net = scripted(json(crossref));
    expect(await resolver(net.fetch).resolve('https://example.org/10.1038/abc')).toEqual({
      status: 'failed',
      reason: 'invalid-doi',
    });
    expect(net.seen).toHaveLength(0);
  });
});

describe('createStubDoiResolver', () => {
  it('answers from its table by normalised DOI, says not-found otherwise, and records each call', async () => {
    const stub = createStubDoiResolver({
      '10.5555/A': { title: 'A', authors: [], issued: null, container: null, type: null },
      '10.5555/b': { status: 'failed', reason: 'timeout' },
    });
    expect(await stub.resolve('https://doi.org/10.5555/a')).toMatchObject({
      status: 'ok',
      metadata: { title: 'A' },
    });
    expect(await stub.resolve('10.5555/b')).toEqual({ status: 'failed', reason: 'timeout' });
    expect(await stub.resolve('10.5555/c')).toEqual({ status: 'not-found' });
    expect(stub.calls).toEqual(['https://doi.org/10.5555/a', '10.5555/b', '10.5555/c']);
  });
});
