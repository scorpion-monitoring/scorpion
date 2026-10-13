// The CORS step on its own, on a bare Hono app: the rules that do not need a database. The whole
// pipeline (tokens, audit, the settings that change the list) is in ../public-api-routes.test.ts.
import { Hono } from 'hono';
import { createLogger } from '@scorpion/kernel';
import { describe, expect, it } from 'vitest';
import { cors, originsFromSettings } from './cors.ts';

const ALLOWED = 'https://app.example.org';
const log = createLogger({ level: 'silent' });

function appWith(origins: () => Promise<readonly string[]>, prefix = '/api/v1') {
  const app = new Hono();
  app.use('*', cors({ prefix, origins, methods: ['get', 'post'], log }));
  app.all('*', (c) => c.text('ok', 200, { vary: 'Accept-Encoding' }));
  return app;
}
const list = () => Promise.resolve([ALLOWED]);
const acao = (res: Response) => res.headers.get('access-control-allow-origin');

describe('cors()', () => {
  it('[ASVS-7.2.3] adds the origin itself and appends to an existing Vary header', async () => {
    const res = await appWith(list).request('/api/v1/x', { headers: { origin: ALLOWED } });
    expect(acao(res)).toBe(ALLOWED);
    expect(res.headers.get('vary')).toBe('Accept-Encoding, Origin');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('only touches paths under the prefix, not one that merely starts like it', async () => {
    const app = appWith(list);
    for (const path of ['/api/v10/x', '/api/internal/x', '/api/v1x', '/x/api/v1']) {
      const res = await app.request(path, { headers: { origin: ALLOWED } });
      expect(acao(res), path).toBeNull();
      expect(res.headers.get('vary'), path).toBe('Accept-Encoding');
    }
    expect(acao(await app.request('/api/v1', { headers: { origin: ALLOWED } }))).toBe(ALLOWED);
  });

  it('works under a base path', async () => {
    const app = appWith(list, '/a/b/api/v1');
    expect(acao(await app.request('/a/b/api/v1/x', { headers: { origin: ALLOWED } }))).toBe(
      ALLOWED,
    );
    expect(acao(await app.request('/api/v1/x', { headers: { origin: ALLOWED } }))).toBeNull();
  });

  it('compares the origin exactly: case, scheme, port and a trailing slash all differ', async () => {
    const app = appWith(list);
    for (const origin of [
      'https://APP.example.org',
      'http://app.example.org',
      'https://app.example.org:8443',
      'https://app.example.org/',
      '*',
      'null',
      '',
    ]) {
      expect(acao(await app.request('/api/v1/x', { headers: { origin } })), origin).toBeNull();
    }
  });

  it('[ASVS-7.2.3] allows nobody when the list cannot be read', async () => {
    const app = appWith(() => Promise.reject(new Error('settings are down')));
    const res = await app.request('/api/v1/x', { headers: { origin: ALLOWED } });
    expect(res.status).toBe(200);
    expect(acao(res)).toBeNull();
    const pre = await app.request('/api/v1/x', {
      method: 'OPTIONS',
      headers: { origin: ALLOWED, 'access-control-request-method': 'GET' },
    });
    expect(pre.status).toBe(403);
  });

  it('answers a preflight with the methods the API has, and passes an OPTIONS that is not a preflight on', async () => {
    const app = appWith(list);
    const pre = await app.request('/api/v1/x', {
      method: 'OPTIONS',
      headers: { origin: ALLOWED, 'access-control-request-method': 'POST' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    const plain = await app.request('/api/v1/x', {
      method: 'OPTIONS',
      headers: { origin: ALLOWED },
    });
    expect(plain.status).toBe(200); // reached the app: no preflight header, so not ours
  });
});

describe('originsFromSettings()', () => {
  it('reads the list, and gives an empty one for anything else', () => {
    expect(originsFromSettings({ corsOrigins: [ALLOWED] })).toEqual([ALLOWED]);
    for (const bad of [
      undefined,
      null,
      {},
      { corsOrigins: 'https://a.org' },
      { corsOrigins: [1] },
    ]) {
      expect(originsFromSettings(bad)).toEqual([]);
    }
  });
});
