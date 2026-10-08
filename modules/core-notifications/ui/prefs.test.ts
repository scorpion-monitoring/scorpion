import { describe, expect, it } from 'vitest';
import {
  describe as text,
  linkOf,
  rowsOf,
  sameRows,
  storedOf,
  valueOf,
  type Category,
} from './prefs.ts';

const cat = (
  category: string,
  mandatory = false,
  description: Category['description'] = null,
): Category => ({
  category,
  description,
  mandatory,
  templates: [`${category}.one`],
});

describe('storedOf', () => {
  it.each([
    [{ account: { email: false } }, { account: { email: false } }],
    [{ account: { email: 'no', inApp: false } }, { account: { inApp: false } }],
    [{ account: 7, other: null, list: [] }, {}],
    [null, {}],
    ['text', {}],
    [[], {}],
    [undefined, {}],
  ])('reads %j as %j', (input, expected) => expect(storedOf(input)).toEqual(expected));
});

describe('rowsOf', () => {
  it('shows every switch on by default, and the stored ones off', () => {
    expect(rowsOf([cat('account'), cat('admin')], { account: { email: false } })).toEqual([
      { category: 'account', mandatory: false, email: false, inApp: true },
      { category: 'admin', mandatory: false, email: true, inApp: true },
    ]);
  });

  it('shows a mandatory category as on whatever is stored', () => {
    expect(rowsOf([cat('security', true)], { security: { email: false, inApp: false } })).toEqual([
      { category: 'security', mandatory: true, email: true, inApp: true },
    ]);
  });
});

describe('valueOf', () => {
  const rows = rowsOf([cat('account'), cat('admin'), cat('security', true)], {});

  it('stores nothing when every switch is on', () => {
    expect(valueOf(rows, {})).toEqual({});
  });

  it('stores only the switches that are off, and nothing for a mandatory category', () => {
    const edited = rows.map((row) => ({
      ...row,
      email: false,
      inApp: row.category === 'admin' ? false : true,
    }));
    expect(valueOf(edited, {})).toEqual({
      account: { email: false },
      admin: { email: false, inApp: false },
    });
  });

  it('carries over a category that this profile does not show, and replaces the ones it does', () => {
    expect(valueOf(rows, { legacy: { email: false }, account: { email: false } })).toEqual({
      legacy: { email: false },
    });
  });

  it('round-trips with rowsOf', () => {
    const stored = { account: { inApp: false } };
    expect(valueOf(rowsOf([cat('account'), cat('admin')], stored), stored)).toEqual(stored);
  });
});

describe('sameRows', () => {
  it('compares the switches', () => {
    const a = rowsOf([cat('a')], {});
    expect(sameRows(a, rowsOf([cat('a')], {}))).toBe(true);
    expect(sameRows(a, rowsOf([cat('a')], { a: { email: false } }))).toBe(false);
  });
});

describe('describe', () => {
  it('picks the language of the page, and says nothing without a description', () => {
    const c = cat('a', false, { en: 'English', de: 'Deutsch' });
    expect(text(c, 'de')).toBe('Deutsch');
    expect(text(c, 'en')).toBe('English');
    expect(text(c, 'fr')).toBe('English');
    expect(text(cat('b'), 'en')).toBeUndefined();
  });
});

describe('linkOf', () => {
  const origin = 'https://scorpion.example.org';
  it.each([
    [
      'https://scorpion.example.org/a/b/admin/users/pending?x=1#y',
      { href: '/a/b/admin/users/pending?x=1#y', external: false },
    ],
    ['/admin/users/pending', { href: '/admin/users/pending', external: false }],
    [
      'https://elsewhere.example.net/page',
      { href: 'https://elsewhere.example.net/page', external: true },
    ],
    ['http://scorpion.example.org/x', { href: 'http://scorpion.example.org/x', external: true }],
  ])('turns %s into a link', (input, expected) => expect(linkOf(input, origin)).toEqual(expected));

  it.each([
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'vbscript:x',
    'ftp://x.example/f',
    '',
    null,
    'http://[',
  ])('makes no link of %s', (input) => expect(linkOf(input, origin)).toBeUndefined());
});
