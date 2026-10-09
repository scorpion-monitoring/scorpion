import { describe, expect, it } from 'vitest';
import { crumbViews, tabTarget } from './tabs.ts';

describe('tabTarget', () => {
  it.each([
    ['ArrowRight', 0, 3, 1],
    ['ArrowRight', 2, 3, 0],
    ['ArrowLeft', 1, 3, 0],
    ['ArrowLeft', 0, 3, 2],
    ['Home', 2, 3, 0],
    ['End', 0, 3, 2],
    ['ArrowRight', 0, 1, 0],
    ['ArrowDown', 0, 3, undefined],
    ['Tab', 1, 3, undefined],
    ['a', 1, 3, undefined],
    ['End', 0, 0, undefined],
  ])('%s on tab %i of %i goes to %s', (key, current, count, expected) => {
    expect(tabTarget(key, current, count)).toBe(expected);
  });
});

describe('crumbViews', () => {
  it('makes the last item the current page and a link of every other item that has an address', () => {
    expect(
      crumbViews([
        { label: 'Home', href: '/' },
        { label: 'Admin' },
        { label: 'Users', href: '/users' },
      ]),
    ).toEqual([
      { label: 'Home', href: '/', current: false },
      { label: 'Admin', href: undefined, current: false },
      { label: 'Users', href: undefined, current: true },
    ]);
  });

  it('has nothing for no items and one current page for a single item', () => {
    expect(crumbViews([])).toEqual([]);
    expect(crumbViews([{ label: 'Only', href: '/x' }])).toEqual([
      { label: 'Only', href: undefined, current: true },
    ]);
  });
});
