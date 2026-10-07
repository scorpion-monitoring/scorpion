import { describe, expect, it } from 'vitest';
import {
  ariaSort,
  clampPage,
  nextSort,
  pageCount,
  pageWindow,
  rowRange,
  sortRows,
  type Sort,
} from './table.ts';

describe('nextSort', () => {
  it.each([
    [undefined, 'name', { key: 'name', direction: 'asc' }],
    [{ key: 'name', direction: 'asc' }, 'name', { key: 'name', direction: 'desc' }],
    [{ key: 'name', direction: 'desc' }, 'name', { key: 'name', direction: 'asc' }],
    [{ key: 'name', direction: 'desc' }, 'age', { key: 'age', direction: 'asc' }],
  ] as [Sort | undefined, string, Sort][])(
    '%j then a click on %s gives %j',
    (current, key, expected) => {
      expect(nextSort(current, key)).toEqual(expected);
    },
  );
});

describe('ariaSort', () => {
  it.each([
    [undefined, 'a', 'none'],
    [{ key: 'a', direction: 'asc' }, 'a', 'ascending'],
    [{ key: 'a', direction: 'desc' }, 'a', 'descending'],
    [{ key: 'a', direction: 'asc' }, 'b', 'none'],
  ] as [Sort | undefined, string, string][])('%j for column %s is %s', (sort, key, expected) => {
    expect(ariaSort(sort, key)).toBe(expected);
  });
});

describe('sortRows', () => {
  type Row = { id: string; name: string | null; n: number };
  const rows: Row[] = [
    { id: 'c', name: 'beta', n: 2 },
    { id: 'a', name: 'Alpha', n: 2 },
    { id: 'd', name: null, n: 1 },
    { id: 'b', name: 'beta', n: 3 },
    { id: 'e', name: 'item 10', n: 0 },
    { id: 'f', name: 'item 9', n: 0 },
  ];
  const value = (row: Row, key: string) => row[key as 'name' | 'n'];
  const ids = (sorted: Row[]) => sorted.map((row) => row.id).join('');

  it('sorts by the column and breaks a tie by the row key, in either direction', () => {
    expect(ids(sortRows(rows, { key: 'n', direction: 'asc' }, value, (r) => r.id))).toBe('efdacb');
    expect(ids(sortRows(rows, { key: 'n', direction: 'desc' }, value, (r) => r.id))).toBe('bcadfe');
  });

  it('compares text without regard to case and numbers inside text by value', () => {
    const sorted = sortRows(rows, { key: 'name', direction: 'asc' }, value, (r) => r.id);
    expect(sorted.map((row) => row.name)).toEqual([
      'Alpha',
      'beta',
      'beta',
      'item 9',
      'item 10',
      null,
    ]);
  });

  it('puts an empty value last, whichever way it sorts', () => {
    const asc = sortRows(rows, { key: 'name', direction: 'asc' }, value, (r) => r.id);
    const desc = sortRows(rows, { key: 'name', direction: 'desc' }, value, (r) => r.id);
    expect(asc.at(-1)?.name).toBeNull();
    expect(desc.at(-1)?.name).toBeNull();
  });

  it('leaves the input alone and returns a copy when there is no sort', () => {
    const copy = [...rows];
    expect(sortRows(rows, undefined, value, (r) => r.id)).toEqual(rows);
    expect(sortRows(rows, undefined, value, (r) => r.id)).not.toBe(rows);
    sortRows(rows, { key: 'n', direction: 'desc' }, value, (r) => r.id);
    expect(rows).toEqual(copy);
  });

  it('gives the same order twice, whatever order the rows arrive in', () => {
    const sort: Sort = { key: 'n', direction: 'asc' };
    const first = ids(sortRows(rows, sort, value, (r) => r.id));
    const second = ids(sortRows([...rows].reverse(), sort, value, (r) => r.id));
    expect(second).toBe(first);
  });
});

describe('pageCount, clampPage and rowRange', () => {
  it.each([
    [0, 20, 1],
    [1, 20, 1],
    [20, 20, 1],
    [21, 20, 2],
    [134, 20, 7],
    [5, 0, 5],
    [-3, 20, 1],
  ])('%i rows of %i make %i pages', (total, size, pages) => {
    expect(pageCount(total, size)).toBe(pages);
  });

  it.each([
    [0, 134, 20, 0],
    [6, 134, 20, 6],
    [7, 134, 20, 6],
    [-1, 134, 20, 0],
    [Number.NaN, 134, 20, 0],
    [3, 0, 20, 0],
  ])('page %i of %i rows of %i is page %i', (page, total, size, expected) => {
    expect(clampPage(page, total, size)).toBe(expected);
  });

  it.each([
    [0, 20, 134, { from: 1, to: 20 }],
    [6, 20, 134, { from: 121, to: 134 }],
    [0, 20, 0, { from: 0, to: 0 }],
    [9, 20, 5, { from: 5, to: 5 }],
  ])('page %i at size %i of %i rows shows %j', (page, size, total, expected) => {
    expect(rowRange(page, size, total)).toEqual(expected);
  });
});

describe('pageWindow', () => {
  it.each([
    [0, 1, [0]],
    [2, 5, [0, 1, 2, 3, 4]],
    [0, 7, [0, 1, 2, 3, 4, 5, 6]],
    [0, 10, [0, 1, 2, 3, 4, 'gap', 9]],
    [3, 10, [0, 1, 2, 3, 4, 'gap', 9]],
    [4, 10, [0, 'gap', 3, 4, 5, 'gap', 9]],
    [5, 10, [0, 'gap', 4, 5, 6, 'gap', 9]],
    [6, 10, [0, 'gap', 5, 6, 7, 8, 9]],
    [9, 10, [0, 'gap', 5, 6, 7, 8, 9]],
  ])('page %i of %i shows %j', (page, pages, expected) => {
    expect(pageWindow(page, pages)).toEqual(expected);
  });

  it('always shows the current page, the first and the last, and never more than max entries', () => {
    for (const pages of [8, 9, 20, 100]) {
      for (let page = 0; page < pages; page += 1) {
        const window = pageWindow(page, pages, 7);
        expect(window).toContain(page);
        expect(window[0]).toBe(0);
        expect(window.at(-1)).toBe(pages - 1);
        expect(window.length).toBeLessThanOrEqual(7);
        expect(window.filter((entry) => entry !== 'gap')).toEqual(
          [...new Set(window.filter((entry) => entry !== 'gap'))].sort((a, b) => a - b),
        );
      }
    }
  });
});
