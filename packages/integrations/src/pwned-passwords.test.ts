import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createPwnedPasswords,
  createStubPwnedPasswords,
  pwnedPasswordFailures,
} from './pwned-passwords.ts';

const rangeKey = (value: string) => createHash('sha1').update(value).digest('hex').toUpperCase();
const SAMPLE = 'correct horse battery staple 2000';
const HASH = rangeKey(SAMPLE);

/** A server that answers a range with the given suffixes, padding included, and records the requests. */
function rangeServer(suffixes: string[], status = 200) {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const fake = ((input: string, init?: RequestInit) => {
    requests.push({ url: input, headers: init?.headers as Record<string, string> });
    const padding = `${'0'.repeat(35)}:0\n${'1'.repeat(35)}:0`;
    const body = [...suffixes.map((suffix) => `${suffix}:7`), padding].join('\r\n');
    return Promise.resolve(new Response(status === 200 ? body : 'nope', { status }));
  }) as unknown as typeof fetch;
  return { fake, requests };
}

describe('pwned-passwords adapter', () => {
  it('says breached for a password whose suffix is in the range', async () => {
    const server = rangeServer([HASH.slice(5)]);
    const pwned = createPwnedPasswords({ fetch: server.fake });
    expect(await pwned.check(SAMPLE)).toBe('breached');
  });

  it('says clean when the range does not hold the suffix, and ignores padding lines', async () => {
    const server = rangeServer(['A'.repeat(35)]);
    const pwned = createPwnedPasswords({ fetch: server.fake });
    expect(await pwned.check(SAMPLE)).toBe('clean');
  });

  it('does not count a padding entry as a hit even when it matches the suffix', async () => {
    const server = {
      fake: (() =>
        Promise.resolve(new Response(`${HASH.slice(5)}:0\r\n`))) as unknown as typeof fetch,
    };
    expect(await createPwnedPasswords({ fetch: server.fake }).check(SAMPLE)).toBe('clean');
  });

  it('sends only the first 5 hex characters of the hash, with Add-Padding, and nothing of the password', async () => {
    const server = rangeServer([]);
    await createPwnedPasswords({ fetch: server.fake }).check(SAMPLE);
    expect(server.requests).toHaveLength(1);
    const [request] = server.requests;
    expect(request!.url).toBe(`https://api.pwnedpasswords.com/range/${HASH.slice(0, 5)}`);
    expect(request!.headers['Add-Padding']).toBe('true');
    expect(JSON.stringify(request)).not.toContain(SAMPLE);
    expect(JSON.stringify(request)).not.toContain(HASH.slice(5));
  });

  it('caches a range, and asks again after the cache time', async () => {
    const server = rangeServer([]);
    let clock = 0;
    const pwned = createPwnedPasswords({
      fetch: server.fake,
      now: () => clock,
      cacheTtlMs: 1000,
    });
    await pwned.check(SAMPLE);
    await pwned.check(SAMPLE);
    expect(server.requests).toHaveLength(1);
    clock = 1001;
    await pwned.check(SAMPLE);
    expect(server.requests).toHaveLength(2);
  });

  it('keeps no more ranges than the bound', async () => {
    const server = rangeServer([]);
    const pwned = createPwnedPasswords({ fetch: server.fake, cacheMax: 2 });
    for (const password of ['one-password', 'two-password', 'three-password']) {
      await pwned.check(password);
    }
    await pwned.check('one-password'); // evicted by the third, asked again
    expect(server.requests).toHaveLength(4);
  });

  it('says unavailable and counts it when the service does not answer in time', async () => {
    const before = pwnedPasswordFailures();
    const slow = ((_url: string, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
    const pwned = createPwnedPasswords({ fetch: slow, timeoutMs: 20 });
    expect(await pwned.check(SAMPLE)).toBe('unavailable');
    expect(pwnedPasswordFailures()).toBe(before + 1);
  });

  it.each([429, 500, 503])('says unavailable for status %i', async (status) => {
    const server = rangeServer([], status);
    expect(await createPwnedPasswords({ fetch: server.fake }).check(SAMPLE)).toBe('unavailable');
  });

  it('says unavailable when the network fails, and does not cache the failure', async () => {
    let calls = 0;
    const flaky = (() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new TypeError('fetch failed'));
      return Promise.resolve(new Response(''));
    }) as unknown as typeof fetch;
    const pwned = createPwnedPasswords({ fetch: flaky });
    expect(await pwned.check(SAMPLE)).toBe('unavailable');
    expect(await pwned.check(SAMPLE)).toBe('clean');
  });
});

describe('stub', () => {
  it('knows the passwords it is given and records what it was asked', async () => {
    const stub = createStubPwnedPasswords({ breached: ['hunter2hunter2'] });
    expect(await stub.check('hunter2hunter2')).toBe('breached');
    expect(await stub.check('something else entirely')).toBe('clean');
    expect(stub.asked).toEqual(['hunter2hunter2', 'something else entirely']);
  });

  it('can say unavailable for everything', async () => {
    expect(await createStubPwnedPasswords({ unavailable: true }).check('anything at all')).toBe(
      'unavailable',
    );
  });
});
