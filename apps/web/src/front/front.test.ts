import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createFront, isApiPath, parseApiTimeout } from './front.ts';

interface Seen {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const servers: http.Server[] = [];
const listen = async (handler: http.RequestListener) => {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
};
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

/** A fake API that records what it receives, and a front in front of it that also records what it hands on. */
async function setup(
  basePath: string,
  api?: http.RequestListener,
  front: { apiTimeoutMs?: number } = {},
) {
  const apiSeen: Seen[] = [];
  const nextSeen: { url?: string; headers: http.IncomingHttpHeaders }[] = [];
  const apiPort = await listen((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      apiSeen.push({ method: request.method, url: request.url, headers: request.headers, body });
      if (api) return api(request, response);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    });
  });
  const port = await listen(
    createFront({
      basePath,
      apiOrigin: `http://127.0.0.1:${apiPort}`,
      ...front,
      next: (request, response) => {
        nextSeen.push({ url: request.url, headers: request.headers });
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('page');
      },
    }),
  );
  return { port, apiSeen, nextSeen, apiPort };
}

function get(
  port: number,
  path: string,
  options: { method?: string; headers?: http.OutgoingHttpHeaders; body?: string } = {},
) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>(
    (resolve, reject) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port,
          path,
          method: options.method ?? 'GET',
          headers: options.headers,
        },
        (response) => {
          let body = '';
          response.on('data', (chunk: Buffer) => (body += chunk.toString()));
          response.on('end', () =>
            resolve({ status: response.statusCode ?? 0, headers: response.headers, body }),
          );
        },
      );
      request.on('error', reject);
      request.end(options.body);
    },
  );
}

describe('isApiPath', () => {
  it.each([
    ['/api/internal/auth/me', true],
    ['/api/v1/services', true],
    ['/healthz', true],
    ['/readyz', true],
    ['/api', false],
    ['/apix/y', false],
    ['/healthz/x', false],
    ['/metrics', false],
    ['/', false],
    ['/legal/terms', false],
    ['/_app/immutable/x.js', false],
  ])('%s → %s', (path, expected) => {
    expect(isApiPath(path)).toBe(expected);
  });
});

describe.each(['/', '/a', '/a/b/c'])('the front under BASE_PATH %s', (basePath) => {
  const prefix = basePath === '/' ? '' : basePath;

  it('streams an API request on unchanged, with its method, query and body', async () => {
    const { port, apiSeen, nextSeen } = await setup(basePath);
    const reply = await get(port, `${prefix}/api/internal/things/1?x=%2F&y=2`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'tok',
        cookie: '__Host-session=s',
      },
      body: '{"a":1}',
    });
    expect(reply.status).toBe(200);
    expect(reply.body).toBe('{"ok":true}');
    expect(apiSeen).toHaveLength(1);
    expect(apiSeen[0]).toMatchObject({
      method: 'POST',
      url: `${prefix}/api/internal/things/1?x=%2F&y=2`,
      body: '{"a":1}',
    });
    expect(apiSeen[0]!.headers['x-csrf-token']).toBe('tok');
    expect(apiSeen[0]!.headers.cookie).toBe('__Host-session=s');
    expect(nextSeen).toEqual([]);
  });

  it('passes the health probes to the API, and does not pass /metrics', async () => {
    const { port, apiSeen, nextSeen } = await setup(basePath);
    await get(port, `${prefix}/healthz`);
    await get(port, `${prefix}/readyz`);
    const metrics = await get(port, `${prefix}/metrics`);
    expect(apiSeen.map((seen) => seen.url)).toEqual([`${prefix}/healthz`, `${prefix}/readyz`]);
    expect(metrics.body).toBe('page');
    expect(nextSeen.map((seen) => seen.url)).toEqual(['/metrics']);
  });

  it('takes the base path off a page request and keeps the query', async () => {
    const { port, apiSeen, nextSeen } = await setup(basePath);
    await get(port, `${prefix}/legal/terms?x=1&y=%2F`);
    await get(port, `${prefix}/`);
    await get(port, `${prefix}/_app/immutable/entry/start.js`);
    expect(nextSeen.map((seen) => seen.url)).toEqual([
      '/legal/terms?x=1&y=%2F',
      '/',
      '/_app/immutable/entry/start.js',
    ]);
    expect(apiSeen).toEqual([]);
  });

  it('answers 404 to a path that is not under the base path, and asks nobody', async () => {
    const { port, apiSeen, nextSeen } = await setup(basePath);
    const outside =
      basePath === '/'
        ? []
        : ['/', '/legal/terms', '/api/internal/auth/me', `${prefix}x/y`, `${prefix}x`];
    for (const path of outside) {
      const reply = await get(port, path);
      expect(reply.status, path).toBe(404);
    }
    expect(apiSeen).toEqual([]);
    expect(nextSeen).toEqual([]);
  });
});

describe('the proxy', () => {
  it('passes the status, every Set-Cookie and Retry-After back unchanged', async () => {
    const { port } = await setup('/a/b', (_request, response) => {
      response.writeHead(429, {
        'set-cookie': [
          '__Host-session=abc; Secure; HttpOnly; SameSite=Lax; Path=/',
          'other=1; Path=/',
        ],
        'retry-after': '7',
        'content-type': 'application/problem+json',
      });
      response.end('{"status":429}');
    });
    const reply = await get(port, '/a/b/api/internal/auth/login', { method: 'POST', body: '{}' });
    expect(reply.status).toBe(429);
    expect(reply.headers['set-cookie']).toEqual([
      '__Host-session=abc; Secure; HttpOnly; SameSite=Lax; Path=/',
      'other=1; Path=/',
    ]);
    expect(reply.headers['retry-after']).toBe('7');
    expect(reply.headers['content-type']).toBe('application/problem+json');
  });

  it('tells the API who the caller is: the chain of addresses, with the peer last', async () => {
    const { port, apiSeen } = await setup('/');
    await get(port, '/api/internal/x', { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } });
    await get(port, '/api/internal/x');
    expect(apiSeen[0]!.headers['x-forwarded-for']).toBe('203.0.113.9, 10.0.0.1, 127.0.0.1');
    expect(apiSeen[1]!.headers['x-forwarded-for']).toBe('127.0.0.1');
  });

  it('tells the page server the same chain, so server-side API calls carry it on', async () => {
    const { port, nextSeen } = await setup('/');
    await get(port, '/legal/terms', { headers: { 'x-forwarded-for': '203.0.113.9' } });
    expect(nextSeen[0]!.headers['x-forwarded-for']).toBe('203.0.113.9, 127.0.0.1');
  });

  it('does not forward hop-by-hop headers', async () => {
    const { port, apiSeen } = await setup('/');
    await get(port, '/api/internal/x', {
      headers: {
        connection: 'x-secret, keep-alive',
        'x-secret': 'hidden',
        te: 'trailers',
        'x-keep': '1',
      },
    });
    expect(apiSeen[0]!.headers['x-secret']).toBeUndefined();
    expect(apiSeen[0]!.headers.te).toBeUndefined();
    expect(apiSeen[0]!.headers['x-keep']).toBe('1');
  });

  it('answers 502 when the API does not answer, without a detail', async () => {
    // A port that was free a moment ago and has nobody behind it.
    const dead = await listen(() => undefined);
    await new Promise<void>((resolve) => servers.pop()!.close(() => resolve()));
    const port = await listen(
      createFront({ basePath: '/', apiOrigin: `http://127.0.0.1:${dead}`, next: () => undefined }),
    );
    const reply = await get(port, '/api/internal/x');
    expect(reply.status).toBe(502);
    expect(reply.body).toBe('The API did not answer.');
  });

  it('does not buffer: the first chunk of a stream arrives while the API is still writing', async () => {
    let finish: () => void = () => undefined;
    const { port } = await setup('/', (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      response.write('data: 1\n\n');
      finish = () => response.end('data: 2\n\n');
    });
    const first = await new Promise<string>((resolve, reject) => {
      const request = http.get(
        { host: '127.0.0.1', port, path: '/api/internal/inbox/stream' },
        (response) => {
          response.once('data', (chunk: Buffer) => {
            resolve(chunk.toString());
            finish();
            response.resume();
          });
        },
      );
      request.on('error', reject);
    });
    expect(first).toBe('data: 1\n\n');
  });

  it('stops the upstream request when the caller aborts the body of a request halfway', async () => {
    let closed: () => void = () => undefined;
    const upstreamGone = new Promise<void>((resolve) => (closed = resolve));
    const apiPort = await listen((request) => {
      // The API has the head of the request and waits for a body that never completes.
      request.resume();
      request.on('close', closed);
    });
    const port = await listen(
      createFront({
        basePath: '/',
        apiOrigin: `http://127.0.0.1:${apiPort}`,
        next: () => undefined,
      }),
    );
    await new Promise<void>((resolve) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/internal/upload',
          method: 'POST',
          headers: { 'content-length': '1000' },
        },
        () => undefined,
      );
      request.on('error', () => resolve());
      request.write('half of the body');
      setTimeout(() => request.destroy(), 100);
    });
    await upstreamGone;
  });

  it('stops the upstream request when the caller goes away', async () => {
    let closed: () => void = () => undefined;
    const upstreamClosed = new Promise<void>((resolve) => (closed = resolve));
    const { port } = await setup('/', (request, response) => {
      request.on('close', () => undefined);
      response.on('close', closed);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: 1\n\n');
    });
    await new Promise<void>((resolve, reject) => {
      const request = http.get(
        { host: '127.0.0.1', port, path: '/api/internal/inbox/stream' },
        (response) => {
          response.once('data', () => {
            request.destroy();
            resolve();
          });
        },
      );
      request.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
      });
    });
    await upstreamClosed;
  });
});

describe('the timeout of the proxy (API_TIMEOUT_MS)', () => {
  it('parses the setting: a default, whole milliseconds, 0 for none, and refuses the rest', () => {
    expect(parseApiTimeout(undefined)).toBe(30_000);
    expect(parseApiTimeout('')).toBe(30_000);
    expect(parseApiTimeout('1500')).toBe(1500);
    expect(parseApiTimeout('0')).toBe(0);
    for (const bad of ['-1', '1.5', 'abc', '1e3', '12345678901', ' 5']) {
      expect(() => parseApiTimeout(bad), bad).toThrow(/API_TIMEOUT_MS/);
    }
  });

  it('answers 504 when the API does not answer in time, and stops waiting for it', async () => {
    let upstreamClosed: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => (upstreamClosed = resolve));
    const { port } = await setup(
      '/',
      (request) => {
        request.socket.on('close', upstreamClosed);
        // never answers
      },
      { apiTimeoutMs: 150 },
    );
    const started = Date.now();
    const reply = await get(port, '/api/internal/slow');
    expect(reply.status).toBe(504);
    expect(reply.body).toBe('The API did not answer in time.');
    expect(Date.now() - started).toBeLessThan(3000);
    await closed;
  });

  it('is a limit on silence, not on the whole time: a body that keeps coming is not cut off', async () => {
    const { port } = await setup(
      '/',
      (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/csv' });
        let n = 0;
        const timer = setInterval(() => {
          response.write(`row ${n++}\n`);
          if (n === 6) {
            clearInterval(timer);
            response.end();
          }
        }, 60);
      },
      { apiTimeoutMs: 200 },
    );
    const reply = await get(port, '/api/internal/export.csv');
    expect(reply.status).toBe(200);
    expect(reply.body.trim().split('\n')).toHaveLength(6);
  });

  it('gives up on a body that goes silent halfway', async () => {
    const { port } = await setup(
      '/',
      (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.write('{"a":');
        // then silence
      },
      { apiTimeoutMs: 150 },
    );
    const outcome = await new Promise<string>((resolve) => {
      const request = http.get({ host: '127.0.0.1', port, path: '/api/internal/half' }, (res) => {
        res.on('data', () => undefined);
        res.on('close', () => resolve(res.complete ? 'complete' : 'cut'));
        res.on('error', () => resolve('cut'));
      });
      request.on('error', () => resolve('cut'));
    });
    expect(outcome).toBe('cut');
  });

  it('leaves an event stream alone however long it is silent, and 0 turns the limit off', async () => {
    let finish: () => void = () => undefined;
    const stream = await setup(
      '/',
      (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(': open\n\n');
        finish = () => response.end('data: late\n\n');
      },
      { apiTimeoutMs: 120 },
    );
    const text = await new Promise<string>((resolve, reject) => {
      const request = http.get(
        { host: '127.0.0.1', port: stream.port, path: '/api/internal/inbox/stream' },
        (res) => {
          let all = '';
          res.on('data', (chunk: Buffer) => (all += chunk.toString()));
          res.on('end', () => resolve(all));
          // Silent for more than twice the limit, then the API speaks again.
          setTimeout(finish, 400);
        },
      );
      request.on('error', reject);
    });
    expect(text).toBe(': open\n\ndata: late\n\n');

    const off = await setup(
      '/',
      (_request, response) => {
        setTimeout(() => response.end('slow but fine'), 300);
      },
      { apiTimeoutMs: 0 },
    );
    expect((await get(off.port, '/api/internal/x')).body).toBe('slow but fine');
  });
});
