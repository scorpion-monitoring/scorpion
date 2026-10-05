// The webhook: a signed JSON mirror of admin-addressed notifications (M4 decision 6). It is the
// one place the server calls a URL an administrator typed, so it is built to resist SSRF
// (ADR 0020, M4 decision 8):
//
// - the host is resolved once and every address must be public (`allowPrivateTargets` lifts only
//   this check); a name that resolves to a public and a private address is refused;
// - the connection goes to the address that was checked, through a custom `lookup`, so a second
//   lookup (DNS rebinding) never happens; SNI and `Host` keep the name;
// - a redirect is a failure, never followed, so https cannot be downgraded to http;
// - the response is read up to a cap and dropped, the whole call is limited to 5 seconds.
//
// The URL and the signing secret are never logged. Failures carry a code only.
import { createHmac } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { WEBHOOK_SECRET } from '../../settings-schema.ts';
import { classifyAddress } from '../address-range.ts';
import { TransportError, type OutgoingMessage, type TransportEntry } from './types.ts';

export const WEBHOOK_TIMEOUT_MS = 5_000;
/** Bytes of a response that are read before the connection is dropped. */
export const WEBHOOK_RESPONSE_CAP = 64 * 1024;
export const SIGNATURE_HEADER = 'x-scorpion-signature';
export const TIMESTAMP_HEADER = 'x-scorpion-timestamp';
export const DELIVERY_HEADER = 'x-scorpion-delivery';

export interface WebhookDeps {
  /** Every address of a name. Default: the system resolver. Tests inject one to play rebinding. */
  resolve?: (host: string) => Promise<string[]>;
  now?: () => number;
  timeoutMs?: number;
}

export const systemResolve = async (host: string): Promise<string[]> =>
  (await dnsLookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

/** `sha256=<hex>` over `<timestamp>.<body>`, so a captured body cannot be replayed under a new time. */
export function signBody(secret: string, timestamp: number, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export function webhookBody(message: OutgoingMessage): string {
  return JSON.stringify({
    id: message.id,
    template: message.template,
    locale: message.locale,
    subject: message.subject,
    text: message.text,
    createdAt: message.createdAt.toISOString(),
  });
}

export interface ResolvedTarget {
  url: URL;
  /** The one address the connection is made to. */
  address: string;
}

/**
 * Checks the URL and the addresses of its host, once. Throws `TransportError('target-refused')`
 * for a scheme or an address that is not allowed, `dns-failed` for a name that does not resolve.
 */
export async function resolveTarget(
  rawUrl: string,
  options: { allowPrivateTargets: boolean; resolve: (host: string) => Promise<string[]> },
): Promise<ResolvedTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TransportError('not-configured');
  }
  if (url.username || url.password) throw new TransportError('target-refused');
  const secure = url.protocol === 'https:';
  if (!secure && !(url.protocol === 'http:' && options.allowPrivateTargets)) {
    throw new TransportError('target-refused');
  }
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  let addresses: string[];
  if (isIP(host) !== 0) {
    addresses = [host];
  } else {
    try {
      addresses = await options.resolve(host);
    } catch {
      throw new TransportError('dns-failed');
    }
  }
  if (addresses.length === 0) throw new TransportError('dns-failed');
  if (
    !options.allowPrivateTargets &&
    addresses.some((address) => classifyAddress(address) !== null)
  ) {
    throw new TransportError('target-refused');
  }
  return { url, address: addresses[0]! };
}

function post(
  target: ResolvedTarget,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<number> {
  const { url, address } = target;
  const secure = url.protocol === 'https:';
  const family = isIP(address);
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  return new Promise<number>((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | undefined, status?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(status!);
    };
    const request = (secure ? https : http).request(
      {
        method: 'POST',
        host,
        port: url.port === '' ? undefined : Number(url.port),
        path: `${url.pathname}${url.search}`,
        headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) },
        // The address that was checked is the address that is used: no second lookup.
        lookup: (_name, options, callback) => {
          const answer = { address, family };
          if ((options as { all?: boolean }).all) {
            (callback as (e: null, a: unknown) => void)(null, [answer]);
          } else {
            callback(null, address, family);
          }
        },
        ...(secure && isIP(host) === 0 ? { servername: host } : {}),
        agent: false, // one connection per call, never reused for another target
      },
      (response) => {
        const status = response.statusCode ?? 0;
        let received = 0;
        response.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > WEBHOOK_RESPONSE_CAP) {
            response.destroy();
            finish(undefined, status);
          }
        });
        response.on('end', () => finish(undefined, status));
        response.on('error', () => finish(undefined, status));
        response.on('close', () => finish(undefined, status));
      },
    );
    const timer = setTimeout(() => {
      request.destroy();
      finish(new TransportError('timeout'));
    }, timeoutMs);
    const onAbort = () => {
      request.destroy();
      finish(new TransportError('aborted'));
    };
    signal?.addEventListener('abort', onAbort);
    request.on('error', (error: NodeJS.ErrnoException) =>
      finish(error.code ? error : new TransportError('send-failed')),
    );
    request.end(body);
  });
}

export function createWebhookTransport(
  config: { url: string; allowPrivateTargets: boolean; secret: string },
  deps: WebhookDeps = {},
) {
  const now = deps.now ?? Date.now;
  const resolve = deps.resolve ?? systemResolve;
  return {
    id: 'webhook',
    async send(message: OutgoingMessage, options: { signal?: AbortSignal } = {}): Promise<void> {
      const target = await resolveTarget(config.url, {
        allowPrivateTargets: config.allowPrivateTargets,
        resolve,
      });
      const body = webhookBody(message);
      const timestamp = Math.floor(now() / 1000);
      const status = await post(
        target,
        {
          'content-type': 'application/json',
          'user-agent': 'scorpion-webhook',
          [TIMESTAMP_HEADER]: String(timestamp),
          [DELIVERY_HEADER]: message.id,
          [SIGNATURE_HEADER]: signBody(config.secret, timestamp, body),
        },
        body,
        deps.timeoutMs ?? WEBHOOK_TIMEOUT_MS,
        options.signal,
      );
      if (status >= 200 && status < 300) return;
      if (status >= 300 && status < 400) throw new TransportError('redirect');
      throw new TransportError(`http-${status}`);
    },
  };
}

export function webhookTransportEntry(deps: WebhookDeps = {}): TransportEntry {
  return {
    id: 'webhook',
    channel: 'webhook',
    async create({ settings, secret }) {
      const { enabled, url, allowPrivateTargets } = settings.webhook;
      if (!enabled || url === '') throw new TransportError('not-configured');
      const signingSecret = await secret(WEBHOOK_SECRET);
      if (signingSecret === undefined) throw new TransportError('not-configured');
      return createWebhookTransport({ url, allowPrivateTargets, secret: signingSecret }, deps);
    },
  };
}

/** The entry a profile uses: the system resolver and the real clock. */
export const webhookTransport = webhookTransportEntry();
