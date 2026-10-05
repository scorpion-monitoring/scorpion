import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createWebhookTransport,
  resolveTarget,
  signBody,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  DELIVERY_HEADER,
  WEBHOOK_RESPONSE_CAP,
} from './webhook.ts';
import type { OutgoingMessage } from './types.ts';

const message: OutgoingMessage = {
  id: '0195b3f0-0000-7000-8000-000000000001',
  template: 'test.message',
  channel: 'webhook',
  to: null,
  from: 'no-reply@localhost',
  subject: 'A subject',
  text: 'A body',
  html: null,
  locale: 'en',
  createdAt: new Date('2026-10-05T10:00:00Z'),
};

/** A resolver that knows a few names, and counts how often it was asked. */
function resolver(table: Record<string, string[][]>) {
  const calls: string[] = [];
  return {
    calls,
    resolve: (host: string) => {
      calls.push(host);
      const answers = table[host];
      if (!answers) return Promise.reject(new Error('ENOTFOUND'));
      return Promise.resolve(
        answers[Math.min(calls.filter((c) => c === host).length, answers.length) - 1]!,
      );
    },
  };
}

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return (error as { code?: string }).code ?? `other:${String(error)}`;
  }
};

describe('resolveTarget: which targets are refused', () => {
  const dns = resolver({
    'public.example': [['93.184.216.34']],
    'dual.example': [['93.184.216.34', '10.0.0.5']],
    'internal.example': [['10.0.0.5']],
    'localhost.example': [['127.0.0.1']],
    'metadata.example': [['169.254.169.254']],
    'v6.example': [['::1']],
    'mapped.example': [['::ffff:127.0.0.1']],
    'rebind.example': [['93.184.216.34'], ['10.0.0.5']],
    'rebind-back.example': [['10.0.0.5'], ['93.184.216.34']],
    'empty.example': [[]],
  });

  const refused: [string, string][] = [
    ['literal loopback', 'https://127.0.0.1/hook'],
    ['literal metadata', 'https://169.254.169.254/latest/meta-data'],
    ['literal IPv6 loopback', 'https://[::1]/hook'],
    ['literal 10.x', 'https://10.1.2.3/hook'],
    ['literal 192.168.x', 'https://192.168.0.10:8443/hook'],
    ['literal link-local IPv6', 'https://[fe80::1]/hook'],
    ['literal unique-local IPv6', 'https://[fd12::1]/hook'],
    ['mapped IPv4 loopback', 'https://[::ffff:127.0.0.1]/hook'],
    ['mapped IPv4 metadata', 'https://[::ffff:a9fe:a9fe]/hook'],
    ['decimal form of 127.0.0.1', 'https://2130706433/hook'],
    ['hex form of 127.0.0.1', 'https://0x7f.0.0.1/hook'],
    ['short form of 127.0.0.1', 'https://127.1/hook'],
    ['a name that resolves to 10.x', 'https://internal.example/hook'],
    ['a name that resolves to loopback', 'https://localhost.example/hook'],
    ['a name that resolves to metadata', 'https://metadata.example/hook'],
    ['a name that resolves to ::1', 'https://v6.example/hook'],
    ['a name that resolves to a mapped address', 'https://mapped.example/hook'],
    ['a name that resolves to a public and a private address', 'https://dual.example/hook'],
    [
      'a name that resolves first to a private address (rebinding the other way)',
      'https://rebind-back.example/hook',
    ],
    ['an http:// target (no downgrade)', 'http://public.example/hook'],
    ['a literal public http:// target', 'http://93.184.216.34/hook'],
    ['a URL with a password', 'https://user:secret@public.example/hook'],
    ['a scheme that is not http', 'ftp://public.example/hook'],
    ['file:', 'file:///etc/passwd'],
  ];
  it.each(refused)('refuses %s', async (_label, url) => {
    expect(
      await code(resolveTarget(url, { allowPrivateTargets: false, resolve: dns.resolve })),
    ).toBe('target-refused');
  });

  it('answers dns-failed for a name that does not resolve or has no address', async () => {
    const options = { allowPrivateTargets: false, resolve: dns.resolve };
    expect(await code(resolveTarget('https://unknown.example/', options))).toBe('dns-failed');
    expect(await code(resolveTarget('https://empty.example/', options))).toBe('dns-failed');
  });

  it('answers not-configured for a URL that is not one', async () => {
    expect(
      await code(resolveTarget('not a url', { allowPrivateTargets: false, resolve: dns.resolve })),
    ).toBe('not-configured');
  });

  it('accepts a public name and a public literal, and returns the checked address', async () => {
    const options = { allowPrivateTargets: false, resolve: dns.resolve };
    expect((await resolveTarget('https://public.example/hook', options)).address).toBe(
      '93.184.216.34',
    );
    expect((await resolveTarget('https://93.184.216.34/hook', options)).address).toBe(
      '93.184.216.34',
    );
    expect((await resolveTarget('https://[2606:4700:4700::1111]/hook', options)).address).toBe(
      '2606:4700:4700::1111',
    );
  });

  it('resolves a name once: rebinding to a private address after the check changes nothing', async () => {
    const rebinding = resolver({ 'rebind.example': [['93.184.216.34'], ['10.0.0.5']] });
    const target = await resolveTarget('https://rebind.example/hook', {
      allowPrivateTargets: false,
      resolve: rebinding.resolve,
    });
    expect(target.address).toBe('93.184.216.34');
    expect(rebinding.calls).toEqual(['rebind.example']);
  });

  it('allowPrivateTargets lifts the range check and the http rule, nothing else', async () => {
    const options = { allowPrivateTargets: true, resolve: dns.resolve };
    expect((await resolveTarget('http://10.1.2.3:8080/hook', options)).address).toBe('10.1.2.3');
    expect((await resolveTarget('https://internal.example/hook', options)).address).toBe(
      '10.0.0.5',
    );
    expect((await resolveTarget('http://localhost.example:9000/hook', options)).address).toBe(
      '127.0.0.1',
    );
    // still refused: credentials in the URL, other schemes, names that do not resolve
    expect(await code(resolveTarget('https://u:p@10.1.2.3/', options))).toBe('target-refused');
    expect(await code(resolveTarget('ftp://10.1.2.3/', options))).toBe('target-refused');
    expect(await code(resolveTarget('https://unknown.example/', options))).toBe('dns-failed');
  });
});

describe('signBody', () => {
  it('is HMAC-SHA256 over "<timestamp>.<body>" as sha256=<hex>', () => {
    const expected = createHmac('sha256', 'key').update('1700000000.{"a":1}').digest('hex');
    expect(signBody('key', 1700000000, '{"a":1}')).toBe(`sha256=${expected}`);
  });
  it('differs for another secret, time or body', () => {
    const base = signBody('key', 1, 'x');
    expect(signBody('other', 1, 'x')).not.toBe(base);
    expect(signBody('key', 2, 'x')).not.toBe(base);
    expect(signBody('key', 1, 'y')).not.toBe(base);
  });
});

describe('the webhook transport against a local receiver', () => {
  interface Seen {
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }
  let server: http.Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.closeAllConnections();
      server.close(() => resolve());
    });
    server = undefined;
  });

  async function receiver(
    respond: (request: http.IncomingMessage, response: http.ServerResponse) => void,
  ): Promise<{ port: number; seen: Seen[] }> {
    const seen: Seen[] = [];
    server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        seen.push({
          method: request.method ?? '',
          url: request.url ?? '',
          headers: request.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        respond(request, response);
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return { port: (server.address() as AddressInfo).port, seen };
  }

  const transport = (
    url: string,
    deps: Parameters<typeof createWebhookTransport>[1] = {},
    allowPrivateTargets = true,
  ) => createWebhookTransport({ url, allowPrivateTargets, secret: 'signing-secret' }, deps);

  it('posts signed JSON and treats a 2xx as delivered', async () => {
    const { port, seen } = await receiver((_req, res) => res.writeHead(204).end());
    await transport(`http://127.0.0.1:${port}/hooks/in?x=1`, { now: () => 1_700_000_000_000 }).send(
      message,
    );
    expect(seen).toHaveLength(1);
    const request = seen[0]!;
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/hooks/in?x=1');
    expect(request.headers['content-type']).toBe('application/json');
    const body = JSON.parse(request.body) as Record<string, string>;
    expect(body).toEqual({
      id: message.id,
      template: 'test.message',
      locale: 'en',
      subject: 'A subject',
      text: 'A body',
      createdAt: '2026-10-05T10:00:00.000Z',
    });
    expect(request.headers[TIMESTAMP_HEADER]).toBe('1700000000');
    expect(request.headers[DELIVERY_HEADER]).toBe(message.id);
    expect(request.headers[SIGNATURE_HEADER]).toBe(
      signBody('signing-secret', 1_700_000_000, request.body),
    );
  });

  it('never sends the recipient, the sender or the html part', async () => {
    const { port, seen } = await receiver((_req, res) => res.writeHead(200).end());
    await transport(`http://127.0.0.1:${port}/`).send({
      ...message,
      to: 'private@example.org',
      html: '<p>html</p>',
    });
    expect(seen[0]!.body).not.toContain('private@example.org');
    expect(seen[0]!.body).not.toContain('html');
    expect(seen[0]!.body).not.toContain('no-reply@localhost');
  });

  it('does not follow a redirect, also not an https to http downgrade', async () => {
    const { port, seen } = await receiver((_req, res) =>
      res.writeHead(302, { location: `http://127.0.0.1:${port}/elsewhere` }).end(),
    );
    expect(await code(transport(`http://127.0.0.1:${port}/hook`).send(message))).toBe('redirect');
    expect(seen.map((request) => request.url)).toEqual(['/hook']);
  });

  it.each([400, 404, 500, 503])('reports http-%s as a code', async (status) => {
    const { port } = await receiver((_req, res) =>
      res.writeHead(status).end('details that are never kept'),
    );
    expect(await code(transport(`http://127.0.0.1:${port}/`).send(message))).toBe(`http-${status}`);
  });

  it('gives up after the timeout when the receiver never answers', async () => {
    const { port } = await receiver(() => undefined);
    const started = Date.now();
    expect(
      await code(transport(`http://127.0.0.1:${port}/`, { timeoutMs: 150 }).send(message)),
    ).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('reports a refused connection by its system code', async () => {
    const { port } = await receiver((_req, res) => res.end());
    server!.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    expect(await code(transport(`http://127.0.0.1:${port}/`).send(message))).toBe('ECONNREFUSED');
  });

  it('stops reading a response that is larger than the cap, and still reports its status', async () => {
    const { port } = await receiver((_req, res) => {
      res.writeHead(200);
      const chunk = Buffer.alloc(16 * 1024, 0x61);
      const write = () => {
        for (let sent = 0; sent < WEBHOOK_RESPONSE_CAP * 8; sent += chunk.length) {
          if (!res.write(chunk)) return void res.once('drain', write);
        }
        res.end();
      };
      write();
    });
    await expect(transport(`http://127.0.0.1:${port}/`).send(message)).resolves.toBeUndefined();
  });

  it('refuses a private target when it is not allowed, and sends nothing', async () => {
    const { port, seen } = await receiver((_req, res) => res.writeHead(200).end());
    expect(await code(transport(`http://127.0.0.1:${port}/`, {}, false).send(message))).toBe(
      'target-refused',
    );
    expect(await code(transport(`https://127.0.0.1:${port}/`, {}, false).send(message))).toBe(
      'target-refused',
    );
    expect(seen).toEqual([]);
  });

  it('connects to the address it checked, even if the name resolves elsewhere a second time (rebinding)', async () => {
    const { port, seen } = await receiver((_req, res) => res.writeHead(200).end());
    const dns = resolver({ 'relay.example': [['127.0.0.1'], ['10.255.255.1']] });
    // First answer: loopback, allowed here; a second lookup would be 10.255.255.1, which does not answer.
    await transport(`http://relay.example:${port}/hook`, { resolve: dns.resolve }).send(message);
    expect(dns.calls).toEqual(['relay.example']);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.headers.host).toBe(`relay.example:${port}`);
  });
});
