import { describe, expect, it } from 'vitest';
import {
  bundledSpdxList,
  compareReleases,
  createSpdx,
  createStubSpdx,
  normaliseSpdxList,
  searchLicenses,
  SPDX_TTL_MS,
  type SpdxCache,
  type SpdxList,
  type SpdxLicense,
} from './spdx.ts';
import { SPDX_PINNED_RELEASE } from './spdx-pin.ts';

const raw = (licenses: unknown[], version = '9.9.9') => ({ licenseListVersion: version, licenses });
const entry = (id: string, name: string, osi = false, deprecated = false) => ({
  licenseId: id,
  name,
  isOsiApproved: osi,
  isDeprecatedLicenseId: deprecated,
  reference: 'ignored',
});

describe('normaliseSpdxList', () => {
  it.each([
    ['not an object', null],
    ['a string', 'licenses'],
    ['no version', { licenses: [] }],
    ['licenses not an array', { licenseListVersion: '1', licenses: {} }],
    ['an empty list', raw([])],
    ['only entries without an id or a name', raw([{ name: 'x' }, { licenseId: 'X' }, null, 3])],
  ])('refuses %s', (_label, input) => {
    expect(normaliseSpdxList(input)).toBeUndefined();
  });

  it('keeps id, name and the two flags, sorts by id and drops what the adapter does not use', () => {
    const list = normaliseSpdxList(
      raw([
        entry('MIT', 'MIT License', true),
        entry('AGPL-1.0', 'Affero', false, true),
        entry('0BSD', 'Zero'),
      ]),
      42,
    );
    expect(list).toEqual({
      version: '9.9.9',
      fetchedAt: 42,
      licenses: [
        { id: '0BSD', name: 'Zero', osiApproved: false, deprecated: false },
        { id: 'AGPL-1.0', name: 'Affero', osiApproved: false, deprecated: true },
        { id: 'MIT', name: 'MIT License', osiApproved: true, deprecated: false },
      ],
    });
  });

  it('treats a flag that is not exactly true as false and keeps one entry per id without case', () => {
    const list = normaliseSpdxList(
      raw([{ licenseId: 'MIT', name: 'a', isOsiApproved: 'yes' }, entry('mit', 'b')]),
    );
    expect(list?.licenses).toHaveLength(1);
    expect(list?.licenses[0]?.osiApproved).toBe(false);
  });
});

describe('searchLicenses', () => {
  const list: SpdxLicense[] = [
    {
      id: 'GPL-2.0',
      name: 'GNU General Public License v2.0 only',
      osiApproved: true,
      deprecated: true,
    },
    {
      id: 'GPL-2.0-only',
      name: 'GNU General Public License v2.0 only',
      osiApproved: true,
      deprecated: false,
    },
    {
      id: 'LGPL-2.0-only',
      name: 'GNU Library General Public License v2 only',
      osiApproved: true,
      deprecated: false,
    },
    { id: 'MIT', name: 'MIT License', osiApproved: true, deprecated: false },
    { id: 'Zlib', name: 'zlib License', osiApproved: true, deprecated: false },
  ];
  it.each([
    ['mit', ['MIT']],
    ['GPL-2.0', ['GPL-2.0', 'GPL-2.0-only', 'LGPL-2.0-only']],
    ['library general', ['LGPL-2.0-only']],
    ['zlib', ['Zlib']],
    ['nothing like this', []],
  ])('finds %s', (query, ids) => {
    expect(searchLicenses(list, query).map((l) => l.id)).toEqual(ids);
  });
  it('lists current licences first for an empty query, and caps the limit', () => {
    expect(searchLicenses(list, '  ').map((l) => l.id)).toEqual([
      'GPL-2.0-only',
      'LGPL-2.0-only',
      'MIT',
      'Zlib',
    ]);
    expect(searchLicenses(list, 'gpl', 2)).toHaveLength(2);
    expect(searchLicenses(list, 'gpl', 0)).toHaveLength(1);
    expect(searchLicenses(list, '', 100_000)).toHaveLength(4);
  });
});

describe('compareReleases', () => {
  it.each([
    ['3.9.0', '3.29.0', -1],
    ['3.29.0', '3.29.0', 0],
    ['4.0', '3.29.0', 1],
  ])('%s vs %s', (a, b, sign) => {
    expect(Math.sign(compareReleases(a, b))).toBe(sign);
  });
});

describe('the bundled fallback', () => {
  it('is at least as new as the pinned release (bump the pin with scripts/generate-spdx.ts)', () => {
    expect(compareReleases(bundledSpdxList().version, SPDX_PINNED_RELEASE)).toBeGreaterThanOrEqual(
      0,
    );
  });
  it('holds the common licences, current and deprecated, with their flags', () => {
    const list = bundledSpdxList().licenses;
    const byId = new Map(list.map((l) => [l.id, l]));
    expect(byId.get('MIT')).toMatchObject({ osiApproved: true, deprecated: false });
    expect(byId.get('Apache-2.0')).toMatchObject({ osiApproved: true, deprecated: false });
    expect(byId.get('GPL-2.0')).toMatchObject({ deprecated: true });
    expect(list.length).toBeGreaterThan(500);
  });
});

describe('createSpdx', () => {
  const good = raw(
    [entry('MIT', 'MIT License', true), entry('GPL-2.0', 'GPL 2', true, true)],
    '9.9.9',
  );
  const ok = (body: unknown = good) => new Response(JSON.stringify(body), { status: 200 });
  const clock = (start = 1_000_000) => {
    let t = start;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };
  const memoryCache = (initial?: SpdxList) => {
    const state: { value: SpdxList | undefined; writes: number } = { value: initial, writes: 0 };
    const cache: SpdxCache = {
      read: () => Promise.resolve(state.value),
      write: (list) => {
        state.value = list;
        state.writes++;
        return Promise.resolve();
      },
    };
    return { cache, state };
  };
  const noSleep = () => Promise.resolve();

  it('fetches once, caches the list and answers search, find and has (deprecated ids count)', async () => {
    const c = clock();
    const { cache, state } = memoryCache();
    let fetches = 0;
    const spdx = createSpdx({
      now: c.now,
      cache,
      fetch: () => {
        fetches++;
        return Promise.resolve(ok());
      },
    });
    expect((await spdx.search('mit')).map((l) => l.id)).toEqual(['MIT']);
    expect(await spdx.has('mit')).toBe(true);
    expect((await spdx.find('GPL-2.0'))?.deprecated).toBe(true);
    expect(await spdx.has('Nope-1.0')).toBe(false);
    expect(fetches).toBe(1);
    expect(state.writes).toBe(1);
    expect(state.value?.version).toBe('9.9.9');
  });

  it('uses a fresh cached list without a fetch, and fetches again once it is older than 24 hours', async () => {
    const c = clock();
    const cached: SpdxList = {
      version: '8.0.0',
      fetchedAt: c.now() - 1000,
      licenses: [{ id: 'Cached-1.0', name: 'c', osiApproved: false, deprecated: false }],
    };
    const { cache } = memoryCache(cached);
    let fetches = 0;
    const spdx = createSpdx({
      now: c.now,
      cache,
      fetch: () => {
        fetches++;
        return Promise.resolve(ok());
      },
    });
    expect(await spdx.has('Cached-1.0')).toBe(true);
    expect(fetches).toBe(0);
    c.advance(SPDX_TTL_MS + 10);
    expect(await spdx.has('MIT')).toBe(true);
    expect(fetches).toBe(1);
  });

  it('shares one fetch between concurrent callers', async () => {
    let fetches = 0;
    const spdx = createSpdx({
      fetch: async () => {
        fetches++;
        await new Promise((done) => setTimeout(done, 5));
        return ok();
      },
    });
    await Promise.all([spdx.has('MIT'), spdx.has('MIT'), spdx.search('m')]);
    expect(fetches).toBe(1);
  });

  it('retries with growing waits and succeeds on the third attempt', async () => {
    const waits: number[] = [];
    let calls = 0;
    const spdx = createSpdx({
      backoffMs: 100,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      fetch: () => {
        calls++;
        if (calls === 1) return Promise.reject(new Error('network down'));
        if (calls === 2) return Promise.resolve(new Response('busy', { status: 503 }));
        return Promise.resolve(ok());
      },
    });
    expect(await spdx.has('MIT')).toBe(true);
    expect(calls).toBe(3);
    expect(waits).toEqual([100, 200]);
  });

  it('passes a timeout signal to fetch', async () => {
    let signal: AbortSignal | null | undefined;
    const spdx = createSpdx({
      timeoutMs: 1234,
      fetch: (_url, init) => {
        signal = init?.signal;
        return Promise.resolve(ok());
      },
    });
    await spdx.has('MIT');
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('gives up after the attempts and falls back to the bundled list', async () => {
    let calls = 0;
    const spdx = createSpdx({
      sleep: noSleep,
      fetch: () => {
        calls++;
        return Promise.reject(new Error('down'));
      },
    });
    expect(await spdx.has('Apache-2.0')).toBe(true);
    expect(calls).toBe(3);
  });

  it.each([
    ['a body that is not JSON', () => new Response('<html>oops</html>', { status: 200 })],
    ['JSON of another shape', () => new Response('{"hello":1}', { status: 200 })],
    ['a 500', () => new Response('x', { status: 500 })],
  ])('treats %s as a failed fetch and falls back', async (_label, respond) => {
    const spdx = createSpdx({
      sleep: noSleep,
      attempts: 2,
      fetch: () => Promise.resolve(respond()),
    });
    expect(await spdx.has('MIT')).toBe(true);
    expect(await spdx.has('Only-In-The-Fixture')).toBe(false);
  });

  it('prefers a stale cached list that is newer than the bundled one over the bundle', async () => {
    const c = clock();
    const stale: SpdxList = {
      version: '99.0.0',
      fetchedAt: c.now() - 3 * SPDX_TTL_MS,
      licenses: [{ id: 'Future-1.0', name: 'f', osiApproved: false, deprecated: false }],
    };
    const spdx = createSpdx({
      now: c.now,
      cache: memoryCache(stale).cache,
      sleep: noSleep,
      fetch: () => Promise.reject(new Error('down')),
    });
    expect(await spdx.has('Future-1.0')).toBe(true);
  });

  it('ignores a stale cached list that is older than the bundled one', async () => {
    const c = clock();
    const old: SpdxList = {
      version: '1.0.0',
      fetchedAt: c.now() - 3 * SPDX_TTL_MS,
      licenses: [{ id: 'Old-1.0', name: 'o', osiApproved: false, deprecated: false }],
    };
    const spdx = createSpdx({
      now: c.now,
      cache: memoryCache(old).cache,
      sleep: noSleep,
      fetch: () => Promise.reject(new Error('down')),
    });
    expect(await spdx.has('Old-1.0')).toBe(false);
    expect(await spdx.has('MIT')).toBe(true);
  });

  it('keeps working when the cache throws on read and on write', async () => {
    const spdx = createSpdx({
      cache: {
        read: () => Promise.reject(new Error('db down')),
        write: () => Promise.reject(new Error('db down')),
      },
      fetch: () => Promise.resolve(ok()),
    });
    expect(await spdx.has('MIT')).toBe(true);
  });

  it('asks the network again soon after a fallback, so a recovered network is noticed', async () => {
    const c = clock();
    let up = false;
    let fetches = 0;
    const spdx = createSpdx({
      now: c.now,
      sleep: noSleep,
      attempts: 1,
      fetch: () => {
        fetches++;
        return up ? Promise.resolve(ok()) : Promise.reject(new Error('down'));
      },
    });
    expect(await spdx.has('Only-Live-1.0')).toBe(false);
    expect(fetches).toBe(1);
    await spdx.has('MIT');
    expect(fetches).toBe(1); // within the minute: no new fetch
    up = true;
    c.advance(61_000);
    await spdx.has('MIT');
    expect(fetches).toBe(2);
  });
});

describe('createStubSpdx', () => {
  it('never fetches and records its calls', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('the stub must not use the network');
    }) as typeof fetch;
    try {
      const stub = createStubSpdx();
      expect(await stub.has('MIT')).toBe(true);
      expect((await stub.search('apache', { limit: 3 })).length).toBeGreaterThan(0);
      expect(stub.calls).toEqual(['find:MIT', 'search:apache']);
    } finally {
      globalThis.fetch = original;
    }
  });
  it('can be given a small list', async () => {
    const stub = createStubSpdx({
      licenses: [{ id: 'Only-1.0', name: 'o', osiApproved: false, deprecated: false }],
    });
    expect(await stub.has('only-1.0')).toBe(true);
    expect(await stub.has('MIT')).toBe(false);
  });
});
