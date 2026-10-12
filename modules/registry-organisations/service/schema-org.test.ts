import { describe, expect, it } from 'vitest';
import { SCHEMA_TYPES } from './registries.ts';
import {
  serializeJsonLd,
  toSchemaOrg,
  type SchemaOrgOptions,
  type SchemaOrgSource,
} from './schema-org.ts';

const ID = '0197a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const full: SchemaOrgSource = {
  id: ID,
  schemaType: 'ResearchOrganization',
  abbreviation: 'IPK',
  name: 'Leibniz Institute',
  description: 'Plant genetics.',
  website: 'https://ipk.example.org',
  rorId: '02skbsp27',
  sameAs: ['https://www.wikidata.org/wiki/Q1', 'https://ror.org/02skbsp27'],
  logoHash: 'ab'.repeat(32),
  contactEmail: 'info@ipk.example.org',
  contactType: 'support',
};
const bare: SchemaOrgSource = {
  id: ID,
  schemaType: 'Organization',
  abbreviation: '',
  name: 'Bare',
  description: null,
  website: null,
  rorId: null,
  sameAs: [],
  logoHash: null,
  contactEmail: null,
  contactType: null,
};
const root: SchemaOrgOptions = {
  origin: 'https://x.example.org',
  basePath: '/',
  includeContact: true,
};

/** The property names plan §3 allows, and the ones nested objects may carry. */
const TOP = [
  '@context',
  '@type',
  '@id',
  'name',
  'alternateName',
  'description',
  'url',
  'identifier',
  'sameAs',
  'logo',
  'contactPoint',
];

describe('toSchemaOrg', () => {
  it('maps every stored field to the property of the plan', () => {
    expect(toSchemaOrg(full, root)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'ResearchOrganization',
      '@id': `https://x.example.org/organisations/${ID}`,
      name: 'Leibniz Institute',
      alternateName: 'IPK',
      description: 'Plant genetics.',
      url: 'https://ipk.example.org',
      identifier: {
        '@type': 'PropertyValue',
        propertyID: 'ROR',
        value: 'https://ror.org/02skbsp27',
      },
      // The ROR URL once, first, although the stored list repeats it.
      sameAs: ['https://ror.org/02skbsp27', 'https://www.wikidata.org/wiki/Q1'],
      logo: {
        '@type': 'ImageObject',
        url: `https://x.example.org/api/internal/files/${'ab'.repeat(32)}`,
      },
      contactPoint: {
        '@type': 'ContactPoint',
        email: 'info@ipk.example.org',
        contactType: 'support',
      },
    });
  });

  it('uses only property names of the plan, nested and top level', () => {
    const profile = toSchemaOrg(full, root);
    expect(Object.keys(profile).every((key) => TOP.includes(key))).toBe(true);
    expect(Object.keys(profile.identifier!)).toEqual(['@type', 'propertyID', 'value']);
    expect(Object.keys(profile.logo!)).toEqual(['@type', 'url']);
    expect(Object.keys(profile.contactPoint!)).toEqual(['@type', 'email', 'contactType']);
  });

  it('omits a property without a value, never null or empty', () => {
    const profile = toSchemaOrg(bare, root);
    expect(profile).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `https://x.example.org/organisations/${ID}`,
      name: 'Bare',
      url: `https://x.example.org/organisations/${ID}`, // the record's own URL is the fallback
    });
    const text = JSON.stringify(profile);
    expect(text).not.toContain('null');
    expect(text).not.toContain('""');
  });

  it('treats blank strings as no value', () => {
    const profile = toSchemaOrg({ ...bare, description: '  ', website: '', sameAs: [' '] }, root);
    expect(profile).not.toHaveProperty('description');
    expect(profile).not.toHaveProperty('sameAs');
    expect(profile.url).toContain('/organisations/');
  });

  it('adds the ROR URL to sameAs also when the list is empty', () => {
    expect(toSchemaOrg({ ...bare, rorId: '02skbsp27' }, root).sameAs).toEqual([
      'https://ror.org/02skbsp27',
    ]);
  });

  it.each([
    ['/', ''],
    ['', ''],
    ['/a/b', '/a/b'],
    ['/a/b/', '/a/b'],
  ])('builds the URLs with the base path %j', (basePath, mounted) => {
    const profile = toSchemaOrg(full, { ...root, basePath, origin: 'https://x.example.org/' });
    expect(profile['@id']).toBe(`https://x.example.org${mounted}/organisations/${ID}`);
    expect(profile.logo!.url).toBe(
      `https://x.example.org${mounted}/api/internal/files/${'ab'.repeat(32)}`,
    );
  });

  it('takes the origin from the argument, nothing is hard-coded', () => {
    const profile = toSchemaOrg(full, { ...root, origin: 'http://localhost:3000' });
    expect(profile['@id'].startsWith('http://localhost:3000/')).toBe(true);
    expect(JSON.stringify(profile)).not.toContain('x.example.org');
  });

  it('leaves the contact point out unless the caller says so, and when only half of it is there', () => {
    expect(toSchemaOrg(full, { ...root, includeContact: false })).not.toHaveProperty(
      'contactPoint',
    );
    expect(JSON.stringify(toSchemaOrg(full, { ...root, includeContact: false }))).not.toContain(
      'info@ipk.example.org',
    );
    expect(toSchemaOrg({ ...full, contactType: null }, root)).not.toHaveProperty('contactPoint');
  });

  it.each(SCHEMA_TYPES)('uses the schemaType %s as @type', (schemaType) => {
    expect(toSchemaOrg({ ...bare, schemaType }, root)['@type']).toBe(schemaType);
  });
});

const HOSTILE = [
  '</script><script>alert(1)</script>',
  '<!-- comment',
  'end -->',
  'a & b &amp; c',
  'say "hi" and \'bye\' and back\\slash',
  'lone high \ud800 and lone low \udc00 end',
  'line\u2028sep\u2029para',
  'tab\t newline\n nul\u0000',
  'ünïcödé 日本 😀',
];

describe('serializeJsonLd', () => {
  it.each(HOSTILE)('writes %j so that it parses back and holds no <', (text) => {
    const profile = toSchemaOrg(
      { ...full, name: text, description: text, abbreviation: text },
      root,
    );
    const out = serializeJsonLd(profile);
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain('&');
    expect(out).not.toContain('\u2028');
    expect(out).not.toContain('\u2029');
    expect(JSON.parse(out)).toEqual(JSON.parse(JSON.stringify(profile)));
  });

  it('cannot contain a script end tag, a comment opener or a script start tag', () => {
    const out = serializeJsonLd(
      toSchemaOrg({ ...full, name: HOSTILE.join(' ') }, root),
    ).toLowerCase();
    for (const bad of ['</script', '<script', '<!--', '-->']) expect(out).not.toContain(bad);
  });

  it('writes the escapes as the plan says', () => {
    expect(serializeJsonLd({ a: '<>&\u2028\u2029' })).toBe(
      '{"a":"\\u003c\\u003e\\u0026\\u2028\\u2029"}',
    );
  });

  it('keeps a lone surrogate as an escape (well-formed JSON)', () => {
    expect(serializeJsonLd({ a: '\ud800' })).toBe('{"a":"\\ud800"}');
  });

  it('leaves plain data alone', () => {
    expect(serializeJsonLd({ a: 1, b: [true, null] })).toBe('{"a":1,"b":[true,null]}');
  });
});
