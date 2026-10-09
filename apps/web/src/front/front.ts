// The front of the web process (ADR-0027). The SvelteKit server is the public origin; this wraps it:
//
//  - a request under `<BASE_PATH>/api/…`, `<BASE_PATH>/healthz` or `<BASE_PATH>/readyz` is streamed to the
//    API process (cookies, `Retry-After` and event streams pass through, nothing is buffered);
//  - every other request has `BASE_PATH` taken off its URL and goes to SvelteKit, which therefore runs
//    with `paths.base = ''` and relative asset paths, whatever the prefix is;
//  - a request that is not under `BASE_PATH` is a 404.
//
// `BASE_PATH` is a run-time value, so one build serves any prefix of any depth. Plain Node, no dependency.
import http from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { stripBase } from '@scorpion/contracts/url';

export type NextHandler = (request: IncomingMessage, response: ServerResponse) => void;

export interface FrontOptions {
  /** `BASE_PATH`, as the server reads it: `/` or `/a/b`. */
  basePath: string;
  /** Where the API process listens, for example `http://127.0.0.1:3001`. */
  apiOrigin: string;
  /** The SvelteKit handler (adapter-node's `handler`), or the dev server's middleware. */
  next: NextHandler;
  /**
   * How long an API request may be silent before the front gives up on it (`API_TIMEOUT_MS`): no answer
   * yet, or a pause in the body. A server-sent event stream is exempt, as the API sends it a heartbeat
   * of its own. Default 30 s; 0 turns it off.
   */
  apiTimeoutMs?: number;
}

/** The default of `apiTimeoutMs`. */
export const DEFAULT_API_TIMEOUT_MS = 30_000;

/** `API_TIMEOUT_MS` as the environment holds it: a whole number of milliseconds, 0 for none; anything else is refused at start. */
export function parseApiTimeout(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_API_TIMEOUT_MS;
  if (!/^\d{1,9}$/.test(value)) {
    throw new Error('API_TIMEOUT_MS must be a whole number of milliseconds (0 turns it off).');
  }
  return Number(value);
}

/** Hop-by-hop headers (RFC 9110 §7.6.1): meaningful for one connection only, never forwarded. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** What goes to the API process, not to SvelteKit. Relative to `BASE_PATH`. */
export function isApiPath(path: string): boolean {
  return path.startsWith('/api/') || path === '/healthz' || path === '/readyz';
}

function forwardedFor(request: IncomingMessage): string {
  const peer = request.socket.remoteAddress;
  const chain = request.headers['x-forwarded-for'];
  const earlier = Array.isArray(chain) ? chain.join(', ') : chain;
  return [earlier, peer].filter((part): part is string => !!part).join(', ');
}

function forwardedHeaders(request: IncomingMessage): IncomingHttpHeaders {
  const headers: IncomingHttpHeaders = {};
  const named = new Set(
    String(request.headers.connection ?? '')
      .split(',')
      .map((name) => name.trim().toLowerCase()),
  );
  for (const [name, value] of Object.entries(request.headers)) {
    if (HOP_BY_HOP.has(name) || named.has(name) || value === undefined) continue;
    headers[name] = value;
  }
  // The API sees this process as its peer; the chain tells it who the caller was.
  headers['x-forwarded-for'] = forwardedFor(request);
  return headers;
}

function plain(response: ServerResponse, status: number, text: string): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(text);
}

export function createFront(options: FrontOptions): http.RequestListener {
  const api = new URL(options.apiOrigin);
  const agent = new http.Agent({ keepAlive: true });
  const timeoutMs = options.apiTimeoutMs ?? DEFAULT_API_TIMEOUT_MS;

  function proxy(request: IncomingMessage, response: ServerResponse): void {
    const upstream = http.request(
      {
        agent,
        host: api.hostname,
        port: api.port,
        method: request.method,
        // The API serves its routes under the same BASE_PATH, so the URL goes on unchanged.
        path: request.url,
        headers: forwardedHeaders(request),
      },
      (answer) => {
        const headers: IncomingHttpHeaders = {};
        for (const [name, value] of Object.entries(answer.headers)) {
          if (!HOP_BY_HOP.has(name) && value !== undefined) headers[name] = value;
        }
        response.writeHead(answer.statusCode ?? 502, answer.statusMessage, headers as never);
        if (String(answer.headers['content-type'] ?? '').startsWith('text/event-stream')) {
          upstream.setTimeout(0);
        }
        answer.pipe(response);
        answer.on('error', () => response.destroy());
      },
    );
    let timedOut = false;
    // Silence on the connection (the socket's own idle timer), not a total time: a long download that keeps
    // flowing is fine. An event stream is exempt once its headers say so (below).
    if (timeoutMs > 0) {
      upstream.setTimeout(timeoutMs, () => {
        timedOut = true;
        upstream.destroy();
      });
    }
    upstream.on('error', () =>
      timedOut
        ? plain(response, 504, 'The API did not answer in time.')
        : plain(response, 502, 'The API did not answer.'),
    );
    // The caller went away: stop the upstream request too (an event stream must not outlive it), and
    // do not leave the API waiting for the rest of a body that is never coming.
    response.on('close', () => {
      if (!response.writableEnded) upstream.destroy();
    });
    request.on('error', () => upstream.destroy());
    request.on('close', () => {
      if (!request.complete) upstream.destroy();
    });
    response.on('error', () => upstream.destroy());
    request.pipe(upstream);
  }

  return (request, response) => {
    const raw = request.url ?? '/';
    const cut = raw.search(/[?#]/);
    const pathname = cut === -1 ? raw : raw.slice(0, cut);
    const query = cut === -1 ? '' : raw.slice(cut);
    const local = pathname.startsWith('/') ? stripBase(options.basePath, pathname) : undefined;
    if (local === undefined) return plain(response, 404, 'Not found.');
    if (isApiPath(local)) return proxy(request, response);
    request.url = `${local}${query}`;
    request.headers['x-forwarded-for'] = forwardedFor(request);
    options.next(request, response);
  };
}
