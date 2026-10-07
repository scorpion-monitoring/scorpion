// Reads a Playwright trace (a zip) to see where a secret was on the wire: in an address, in a header, in
// the body of a request, in the body of a response. Needs `snapshots: true` when the trace is started
// (without it the network log is empty). The typed text of the test itself is in the action log of the
// trace, which this does not read: it is the test's own input, not something the application did.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type Part = 'url' | 'requestHeaders' | 'requestBody' | 'responseHeaders' | 'responseBody';

export interface Exchange {
  method: string;
  /** The path of the request without the origin, with its query. */
  path: string;
  url: string;
  requestHeaders: string;
  requestBody: string;
  responseHeaders: string;
  responseBody: string;
}

interface Header {
  name: string;
  value: string;
}
interface Snapshot {
  request: {
    method: string;
    url: string;
    headers: Header[];
    postData?: { text?: string; _file?: string };
  };
  response: {
    headers: Header[];
    cookies?: { name: string; value: string }[];
    content?: { text?: string; _file?: string };
  };
}

export function readTrace(
  zip: string,
  scratch = resolve(import.meta.dirname, '../../test-results'),
): Exchange[] {
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'trace-'));
  const result = spawnSync('unzip', ['-q', '-o', zip, '-d', dir], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`unzip failed: ${result.stderr}`);
  const body = (file: string | undefined, text: string | undefined): string => {
    if (text) return text;
    if (!file) return '';
    try {
      return readFileSync(join(dir, file), 'utf8');
    } catch {
      return '';
    }
  };
  const headers = (list: Header[]) => list.map((h) => `${h.name}: ${h.value}`).join('\n');
  return readFileSync(join(dir, 'trace.network'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { snapshot: Snapshot }).snapshot)
    .map((snapshot): Exchange => {
      const url = new URL(snapshot.request.url);
      return {
        method: snapshot.request.method,
        path: `${url.pathname}${url.search}`,
        url: snapshot.request.url,
        requestHeaders: headers(snapshot.request.headers),
        requestBody: body(snapshot.request.postData?._file, snapshot.request.postData?.text),
        responseHeaders: [
          headers(snapshot.response.headers),
          ...(snapshot.response.cookies ?? []).map((c) => `cookie ${c.name}=${c.value}`),
        ].join('\n'),
        responseBody: body(snapshot.response.content?._file, snapshot.response.content?.text),
      };
    });
}

/** Where `secret` is: `METHOD path part` for each request that carries it. */
export function whereIs(exchanges: Exchange[], secret: string, basePath: string): string[] {
  const prefix = basePath === '/' ? '' : basePath;
  const found = new Set<string>();
  for (const exchange of exchanges) {
    const path = exchange.path.startsWith(prefix)
      ? exchange.path.slice(prefix.length)
      : exchange.path;
    const route = path.replace(/^\/api\/internal/, '').replace(/\?.*$/, '');
    for (const part of [
      'url',
      'requestHeaders',
      'requestBody',
      'responseHeaders',
      'responseBody',
    ] as const) {
      const text = part === 'url' ? exchange.url : exchange[part];
      if (text.includes(secret) || decoded(text).includes(secret)) {
        found.add(`${exchange.method} ${route} ${part}`);
      }
    }
  }
  return [...found].sort();
}

/** The text with its percent escapes resolved, so a secret in an encoded address is found too. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
