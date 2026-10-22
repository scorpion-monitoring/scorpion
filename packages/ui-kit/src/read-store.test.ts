import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createDedupe,
  normalise,
  readKey,
  WIDGET_PAGE_SIZE,
  type ReadQuery,
} from './read-store.ts';

const base: ReadQuery = { service: 'svc-1', range: '1y', category: 'all' };

describe('readKey', () => {
  it.each<[string, ReadQuery, ReadQuery, boolean]>([
    ['the same read', base, { ...base }, true],
    [
      'a default page and an explicit one',
      base,
      { ...base, page: 0, pageSize: WIDGET_PAGE_SIZE },
      true,
    ],
    [
      'KPIs in another order',
      { ...base, indicators: ['b', 'a'] },
      { ...base, indicators: ['a', 'b'] },
      true,
    ],
    [
      'KPIs twice or padded or empty',
      { ...base, indicators: ['a', ' a ', ''] },
      { ...base, indicators: ['a'] },
      true,
    ],
    ['no KPIs and an empty list', base, { ...base, indicators: [] }, true],
    ['another service', base, { ...base, service: 'svc-2' }, false],
    ['another range', base, { ...base, range: '3m' }, false],
    ['another category', base, { ...base, category: 'Usage' }, false],
    ['other KPIs', { ...base, indicators: ['a'] }, { ...base, indicators: ['b'] }, false],
    ['no KPIs and some', base, { ...base, indicators: ['a'] }, false],
    ['another page', base, { ...base, page: 1 }, false],
    ['another page size', base, { ...base, pageSize: 10 }, false],
    ['a page that is not a whole number and page 0', base, { ...base, page: 1.5 }, true],
    ['a negative page and page 0', base, { ...base, page: -1 }, true],
    ['a page size over the maximum and the default', base, { ...base, pageSize: 500 }, true],
  ])('%s: the same key is %s', (_name, a, b, same) => {
    expect(readKey('summary', a) === readKey('summary', b)).toBe(same);
  });

  it('is another key for the other kind of read', () => {
    expect(readKey('series', base)).not.toBe(readKey('summary', base));
  });

  it('cannot be forged by a name that holds the separator', () => {
    const a = readKey('summary', { ...base, indicators: ['a,b'] });
    const b = readKey('summary', { ...base, indicators: ['a', 'b'] });
    expect(a).not.toBe(b);
    const c = readKey('summary', { ...base, service: 'x","1y', range: 'z' });
    const d = readKey('summary', { ...base, service: 'x', range: '1y","z' });
    expect(c).not.toBe(d);
  });

  it('is idempotent and order-free for any KPI list (a property)', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 12 }), { maxLength: 8 }), (names) => {
        const key = readKey('summary', { ...base, indicators: names });
        expect(readKey('summary', { ...base, indicators: [...names].reverse() })).toBe(key);
        expect(
          readKey('summary', {
            ...base,
            indicators: normalise({ ...base, indicators: names }).indicators,
          }),
        ).toBe(key);
      }),
    );
  });
});

describe('createDedupe', () => {
  it('runs a read once for a key however many widgets ask, and gives all of them the same promise', async () => {
    const dedupe = createDedupe<number>();
    let runs = 0;
    const run = () => Promise.resolve(++runs);
    const asked = [1, 2, 3, 4, 5, 6, 7, 8].map(() => dedupe.load('a', run));
    expect(new Set(asked).size).toBe(1);
    expect(await Promise.all(asked)).toEqual(Array(8).fill(1));
    expect(runs).toBe(1);
  });

  it('runs one read per distinct key: eight widgets over two keys make two reads', async () => {
    const dedupe = createDedupe<string>();
    const ran: string[] = [];
    const ask = (key: string) =>
      dedupe.load(key, () => {
        ran.push(key);
        return Promise.resolve(key);
      });
    await Promise.all(['a', 'b', 'a', 'a', 'b', 'a', 'b', 'a'].map(ask));
    expect(ran).toEqual(['a', 'b']);
    expect(dedupe.size).toBe(2);
  });

  it('keeps a finished read for the visit, and a widget that changes its key asks for its own only', async () => {
    const dedupe = createDedupe<string>();
    const ran: string[] = [];
    const ask = (key: string) =>
      dedupe.load(key, () => {
        ran.push(key);
        return Promise.resolve(key);
      });
    await ask('1y');
    await ask('1y');
    await ask('3m');
    await ask('1y');
    expect(ran).toEqual(['1y', '3m']);
  });

  it('forgets a read that failed, so a retry sends a new one, and every waiter of the failed one sees the failure', async () => {
    const dedupe = createDedupe<number>();
    let runs = 0;
    const flaky = () => (++runs === 1 ? Promise.reject(new Error('down')) : Promise.resolve(runs));
    const first = [dedupe.load('k', flaky), dedupe.load('k', flaky)];
    await expect(first[0]).rejects.toThrow('down');
    await expect(first[1]).rejects.toThrow('down');
    expect(dedupe.size).toBe(0);
    expect(await dedupe.load('k', flaky)).toBe(2);
    expect(runs).toBe(2);
  });

  it('does not forget a newer read when an older failed one settles late', async () => {
    const dedupe = createDedupe<number>();
    let rejectOld!: (error: Error) => void;
    const old = dedupe.load('k', () => new Promise<number>((_, reject) => (rejectOld = reject)));
    old.catch(() => undefined);
    dedupe.forget('k');
    const newer = dedupe.load('k', () => Promise.resolve(7));
    rejectOld(new Error('late'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dedupe.load('k', () => Promise.resolve(99))).toBe(newer);
  });

  it('clear forgets everything', async () => {
    const dedupe = createDedupe<number>();
    await dedupe.load('a', () => Promise.resolve(1));
    dedupe.clear();
    expect(dedupe.size).toBe(0);
  });
});
