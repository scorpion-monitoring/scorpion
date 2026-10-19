import { describe, expect, it } from 'vitest';
import { iriBaseProblem, iriFor, resolveIriBase, type IriKind } from './iri.ts';

describe('iriFor', () => {
  it.each<[IriKind, string, string, string]>([
    [
      'indicator',
      'downloads',
      'https://kpi.example.org',
      'https://kpi.example.org/kpi/indicator/downloads',
    ],
    ['set', 'web-apps', 'https://kpi.example.org', 'https://kpi.example.org/kpi/set/web-apps'],
    ['unit', 'second', 'http://localhost:3000', 'http://localhost:3000/kpi/unit/second'],
    ['means', 'log_analysis', 'https://x.org', 'https://x.org/kpi/means/log_analysis'],
    ['tool', 'Matomo', 'https://x.org', 'https://x.org/kpi/tool/Matomo'],
    ['catalogue', 'rimo', 'https://x.org', 'https://x.org/kpi/catalogue/rimo'],
    ['indicator', 'a.b-c_d', 'https://x.org', 'https://x.org/kpi/indicator/a.b-c_d'],
    // a base with a trailing slash, with several, and with a base path
    ['indicator', 'a', 'https://x.org/', 'https://x.org/kpi/indicator/a'],
    ['indicator', 'a', 'https://x.org///', 'https://x.org/kpi/indicator/a'],
    ['indicator', 'a', 'https://x.org/scorpion', 'https://x.org/scorpion/kpi/indicator/a'],
    ['indicator', 'a', 'https://x.org/sub/path/', 'https://x.org/sub/path/kpi/indicator/a'],
    // a slug of the longest allowed length
    ['set', 'a'.repeat(64), 'https://x.org', `https://x.org/kpi/set/${'a'.repeat(64)}`],
  ])('%s %s on %s', (kind, slug, base, expected) => {
    expect(iriFor(kind, slug, base)).toBe(expected);
  });

  it.each([
    ['empty', ''],
    ['a space', 'a b'],
    ['a slash', 'a/b'],
    ['a dot first', '.hidden'],
    ['a dash first', '-a'],
    ['an angle bracket', 'a>b'],
    ['a quote', 'a"b'],
    ['a percent', 'a%20b'],
    ['a hash', 'a#b'],
    ['a newline', 'a\nb'],
    ['a non-ASCII letter', 'Käse'],
    ['too long', 'a'.repeat(65)],
  ])('refuses a slug with %s', (_name, slug) => {
    expect(() => iriFor('indicator', slug, 'https://x.org')).toThrow(RangeError);
  });

  it('refuses an unknown kind and a bad base', () => {
    expect(() => iriFor('service' as IriKind, 'a', 'https://x.org')).toThrow(/unknown IRI kind/);
    expect(() => iriFor('set', 'a', '')).toThrow(/empty/);
    expect(() => iriFor('set', 'a', 'ftp://x.org')).toThrow(/http/);
    expect(() => iriFor('set', 'a', 'https://x.org/a b')).toThrow(RangeError);
  });
});

describe('iriBaseProblem', () => {
  it.each([
    '',
    'https://kpi.example.org',
    'http://localhost:3000',
    'https://x.org/',
    'https://x.org/base/path',
    'HTTPS://X.ORG',
    'http://127.0.0.1:8080/scorpion',
  ])('accepts %j', (value) => {
    expect(iriBaseProblem(value)).toBeUndefined();
  });

  it.each([
    ['example.org', /absolute URL/],
    ['/just/a/path', /absolute URL/],
    ['ftp://x.org', /http/],
    ['javascript:alert(1)', /http/],
    ['https://', /absolute URL|host/],
    ['https://user:pw@x.org', /user name/],
    ['https://user@x.org', /user name/],
    ['https://x.org?a=1', /query/],
    ['https://x.org#frag', /query/],
    ['https://x.org/a b', /printable ASCII/],
    ['https://x.org/<a>', /printable ASCII/],
    ['https://x.org/"', /printable ASCII/],
    ['https://x.org/\\a', /printable ASCII/],
    ['https://x.org/ä', /printable ASCII/],
    ['https://x.org/%41', /percent/],
    [`https://x.org/${'a'.repeat(200)}`, /at most 200/],
    [' https://x.org', /printable ASCII/],
  ])('refuses %j', (value, message) => {
    expect(iriBaseProblem(value)).toMatch(message);
  });
});

describe('resolveIriBase', () => {
  const request = { origin: 'https://host.example:8443', basePath: '/scorpion' };

  it.each<[string, string | null | undefined, string]>([
    ['the setting wins', 'https://iri.example.org', 'https://iri.example.org'],
    ['a trailing slash is dropped', 'https://iri.example.org/', 'https://iri.example.org'],
    [
      'whitespace around the setting is dropped',
      '  https://iri.example.org  ',
      'https://iri.example.org',
    ],
    ['an empty setting falls back to the request', '', 'https://host.example:8443/scorpion'],
    ['no setting falls back to the request', undefined, 'https://host.example:8443/scorpion'],
    ['null falls back to the request', null, 'https://host.example:8443/scorpion'],
  ])('%s', (_name, setting, expected) => {
    expect(resolveIriBase(setting, request)).toBe(expected);
  });

  it('uses the origin alone when there is no base path', () => {
    expect(resolveIriBase('', { origin: 'https://h.example', basePath: '' })).toBe(
      'https://h.example',
    );
  });

  it('throws when nothing is known, and for a setting that is not valid', () => {
    expect(() => resolveIriBase('')).toThrow(/no IRI base/);
    expect(() => resolveIriBase('nonsense', request)).toThrow(RangeError);
  });
});
