import { url } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { themeHref } from '../theme-link.ts';
import { THEME_MAX_AGE_SECONDS, themeSheet } from './theme.ts';

// `GET /theme.css` (M12a sprint 4, ADR-0051): the stylesheet of the theme colours, cached only at the current versioned address.
const NONE = { colors: { light: {}, dark: {} }, themeVersion: null };
const SET = {
  colors: { light: { primary: '#0f5c5c', 'primary-content': '#ffffff' }, dark: {} },
  themeVersion: '0123456789abcdef',
};

describe('themeSheet', () => {
  it('is cached for a short while at the current version', () => {
    const sheet = themeSheet(SET, '0123456789abcdef');
    expect(sheet.cacheControl).toBe(`public, max-age=${THEME_MAX_AGE_SECONDS}`);
    expect(sheet.css).toContain("[data-theme='scorpionlight'] { --color-primary: #0f5c5c;");
  });

  it.each([
    ['no version', null],
    ['an old version', 'ffffffffffffffff'],
    ['something else', '"><script>'],
  ])('serves the current sheet but caches nothing for %s', (_, version) => {
    const sheet = themeSheet(SET, version);
    expect(sheet.cacheControl).toBe('no-cache');
    expect(sheet.css).toContain('#0f5c5c');
  });

  it('is a comment and no rule when no colour is set, and never cached', () => {
    const sheet = themeSheet(NONE, null);
    expect(sheet.css).toMatch(/^\/\*[^*]*\*\/\n$/);
    expect(sheet.cacheControl).toBe('no-cache');
  });

  it('writes only what passed validation, whatever the branding read carries', () => {
    const hostile = {
      colors: { light: { primary: 'red;}body{display:none', 'x;}a{': '#ffffff' }, dark: {} },
      themeVersion: 'v',
    };
    const text = themeSheet(hostile, 'v').css;
    expect(text).not.toContain('display');
    expect(text).not.toContain('{ --');
  });
});

describe('themeHref', () => {
  it.each([
    ['/', '/theme.css?v=0123456789abcdef'],
    ['/a/b', '/a/b/theme.css?v=0123456789abcdef'],
  ])('under %s is %s', (base, expected) => {
    expect(themeHref(SET, (path) => url(base, path))).toBe(expected);
  });

  it('is none when no colour is set, so the page links nothing', () => {
    expect(themeHref(NONE, (path) => path)).toBeUndefined();
  });
});
