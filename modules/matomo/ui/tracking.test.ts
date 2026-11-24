// What reaches Matomo (ADR-0054): the pattern of a page, never its address. The token of a reset or sign-in link is in
// the fragment, ids are in the path; neither may appear in anything the tracker sends.
import { describe, expect, it } from 'vitest';
import {
  asksNotToBeTracked,
  isNewPageView,
  pageViewCommands,
  setupCommands,
  trackedPath,
  trackedUrl,
} from './tracking.ts';

const page = (pattern: string | null, pathname: string, status = 200) => ({
  pattern,
  pathname,
  status,
});
const hrefUnder = (base: string) => (path: string) =>
  base === '/' ? path : `${base}${path === '/' ? '' : path}`;

describe('trackedPath() and trackedUrl()', () => {
  it.each([
    [page('/', '/'), '/', 'https://scorpion.example.org/'],
    [
      page('/services/:slug', '/services/genome-browser'),
      '/services/:slug',
      'https://scorpion.example.org/services/:slug',
    ],
    [
      page('/admin/users/:id', '/admin/users/0b6c'),
      '/admin/users/:id',
      'https://scorpion.example.org/admin/users/:id',
    ],
    [
      page('/reset-password', '/reset-password'),
      '/reset-password',
      'https://scorpion.example.org/reset-password',
    ],
    [page(null, '/nope', 404), '/(error)', 'https://scorpion.example.org/(error)'],
    [
      page('/services/:slug', '/services/x', 500),
      '/(error)',
      'https://scorpion.example.org/(error)',
    ],
    [page(null, '/odd'), '/(unknown)', 'https://scorpion.example.org/(unknown)'],
  ])('%j → %s', (shown, path, url) => {
    expect(trackedPath(shown)).toBe(path);
    expect(trackedUrl('https://scorpion.example.org', hrefUnder('/'), shown)).toBe(url);
  });

  it('keeps a base path of several segments (defect 11)', () => {
    expect(
      trackedUrl(
        'https://example.org',
        hrefUnder('/a/b/c'),
        page('/services/:slug', '/services/x'),
      ),
    ).toBe('https://example.org/a/b/c/services/:slug');
  });
});

describe('pageViewCommands()', () => {
  it('sends the pattern address as the URL and the title, and nothing of the address bar', () => {
    // The browser is at /reset-password#token=SECRET-TOKEN; the shell gives the tracker the pattern only.
    const url = trackedUrl(
      'https://s.example.org',
      hrefUnder('/'),
      page('/reset-password', '/reset-password'),
    );
    const commands = pageViewCommands({
      url,
      title: '/reset-password',
      previousUrl: undefined,
      userId: undefined,
      hadUserId: false,
    });
    expect(commands).toEqual([
      ['setCustomUrl', 'https://s.example.org/reset-password'],
      ['setDocumentTitle', '/reset-password'],
      ['trackPageView'],
    ]);
    expect(JSON.stringify(commands)).not.toMatch(/token|#|\?/);
  });

  it('names the page before as the referrer, sets a pseudonymous id, and resets it after a sign-out', () => {
    expect(
      pageViewCommands({
        url: 'https://s.example.org/services',
        title: '/services',
        previousUrl: 'https://s.example.org/',
        userId: 'abc',
        hadUserId: false,
      }),
    ).toEqual([
      ['setReferrerUrl', 'https://s.example.org/'],
      ['setCustomUrl', 'https://s.example.org/services'],
      ['setDocumentTitle', '/services'],
      ['setUserId', 'abc'],
      ['trackPageView'],
    ]);
    expect(
      pageViewCommands({
        url: 'https://s.example.org/login',
        title: '/login',
        previousUrl: undefined,
        userId: undefined,
        hadUserId: true,
      }),
    ).toContainEqual(['resetUserId']);
  });
});

describe('setupCommands()', () => {
  const config = {
    enabled: true as const,
    url: 'https://stats.example.org/matomo/',
    siteId: 4,
    cookieless: true,
    respectDoNotTrack: true,
  };

  it('turns cookies off first, then points at the endpoint and the site, and never turns on link tracking', () => {
    expect(setupCommands(config)).toEqual([
      ['disableCookies'],
      ['setTrackerUrl', 'https://stats.example.org/matomo/matomo.php'],
      ['setSiteId', '4'],
    ]);
    expect(JSON.stringify(setupCommands({ ...config, cookieless: false }))).not.toMatch(
      /disableCookies|enableLinkTracking/,
    );
  });
});

describe('asksNotToBeTracked()', () => {
  it.each([
    [{}, false],
    [{ doNotTrack: '0' }, false],
    [{ doNotTrack: 'unspecified' }, false],
    [{ doNotTrack: null, globalPrivacyControl: false }, false],
    [{ doNotTrack: '1' }, true],
    [{ doNotTrack: 'yes' }, true],
    [{ windowDoNotTrack: '1' }, true],
    [{ globalPrivacyControl: true }, true],
  ])('%j → %s', (browser, expected) => {
    expect(asksNotToBeTracked(browser)).toBe(expected);
  });
});

describe('isNewPageView()', () => {
  it.each([
    [undefined, '/services', true],
    ['/services', '/services', false],
    ['/services', '/services/x', true],
    ['/services/x', '/services/y', true],
  ])('from %s to %s: %s', (before, pathname, expected) => {
    expect(isNewPageView(before, page('/services', pathname))).toBe(expected);
  });
});
