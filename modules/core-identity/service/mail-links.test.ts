import { describe, expect, it } from 'vitest';
import { createMailLinks } from './mail-links.ts';

// Defect 11 (FEATURES §5): the legacy app assumed a one-segment base path. A link in a mail is
// `<ORIGIN><BASE_PATH><page>` for any number of segments, and the token stays in the fragment.
describe.each([
  ['/', ''],
  ['/a', '/a'],
  ['/a/b', '/a/b'],
  ['/a/b/c', '/a/b/c'],
])('the links of a mail under BASE_PATH %s', (BASE_PATH, prefix) => {
  const links = createMailLinks({ ORIGIN: 'https://scorpion.example.org', BASE_PATH });
  const origin = `https://scorpion.example.org${prefix}`;

  it('point at the pages of the web app', () => {
    expect(links.signIn()).toBe(`${origin}/login`);
    expect(links.forgotPassword()).toBe(`${origin}/forgot-password`);
    expect(links.review()).toBe(`${origin}/admin/users/pending`);
  });

  it('carry a token in the fragment, never in the query', () => {
    expect(links.reset('a b+c')).toBe(`${origin}/reset-password#token=a%20b%2Bc`);
    expect(links.verify('t')).toBe(`${origin}/verify-email#token=t`);
    expect(links.oidcLink('t')).toBe(`${origin}/link-sign-in#token=t`);
    expect(new URL(links.reset('secret')).search).toBe('');
  });
});
