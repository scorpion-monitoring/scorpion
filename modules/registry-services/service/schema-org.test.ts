// The Schema.org builder of a service (plan §3): every row of the mapping, the omission of empty properties, the
// base path, the allow-list for configured fields and contributors, hostile text through `serializeJsonLd`, and the
// output against the schema.org vocabulary. Pure: no database.
import type { SchemaOrgProfile } from '@scorpion/registry-organisations/public';
import { serializeJsonLd } from '@scorpion/registry-organisations/public';
import { describe, expect, it } from 'vitest';
import {
  CONTRIBUTABLE_PROPERTIES,
  licenseUrl,
  propertyValue,
  toSchemaOrg,
  type SchemaOrgOptions,
  type SchemaOrgSource,
} from './schema-org.ts';

const ORIGIN = 'https://scorpion.example.org';
const ID = '018f3b7e-1111-7000-8000-000000000001';

const source = (overrides: Partial<SchemaOrgSource> = {}): SchemaOrgSource => ({
  id: ID,
  slug: 'galaxy',
  name: 'Galaxy',
  description: 'A workbench',
  url: 'https://galaxy.example.org',
  sameAs: ['https://example.org/galaxy'],
  iconHash: 'a'.repeat(64),
  licenseId: 'Apache-2.0',
  values: {},
  ...overrides,
});

const organisation = (id: string, name: string, type = 'Organization'): SchemaOrgProfile =>
  ({
    '@context': 'https://schema.org',
    '@type': type,
    '@id': `${ORIGIN}/organisations/${id}`,
    name,
    url: `https://${id}.example.org`,
    // What the organisation's own profile carries and a service profile must not copy.
    alternateName: 'ABBR',
    description: 'long text',
    sameAs: ['https://ror.org/xyz'],
    contactPoint: { '@type': 'ContactPoint', email: 'secret@example.org', contactType: 'support' },
  }) as SchemaOrgProfile;

const options = (overrides: Partial<SchemaOrgOptions> = {}): SchemaOrgOptions => ({
  origin: ORIGIN,
  basePath: '/',
  organisations: [
    { role: 'provider', profile: organisation('p1', 'IPK', 'ResearchOrganization') },
    { role: 'consortium', profile: organisation('c1', 'de.NBI') },
    { role: 'consortium', profile: organisation('c2', 'NFDI') },
  ],
  ...overrides,
});

describe('toSchemaOrg: the mapping of plan §3', () => {
  it('maps every stored field to its property', () => {
    expect(toSchemaOrg(source(), options())).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Service',
      '@id': `${ORIGIN}/services/${ID}`,
      name: 'Galaxy',
      alternateName: 'galaxy',
      description: 'A workbench',
      url: 'https://galaxy.example.org',
      sameAs: ['https://example.org/galaxy'],
      logo: { '@type': 'ImageObject', url: `${ORIGIN}/api/internal/files/${'a'.repeat(64)}` },
      license: 'https://spdx.org/licenses/Apache-2.0.html',
      provider: {
        '@type': 'ResearchOrganization',
        '@id': `${ORIGIN}/organisations/p1`,
        name: 'IPK',
        url: 'https://p1.example.org',
      },
      brand: [
        {
          '@type': 'Organization',
          '@id': `${ORIGIN}/organisations/c1`,
          name: 'de.NBI',
          url: 'https://c1.example.org',
        },
        {
          '@type': 'Organization',
          '@id': `${ORIGIN}/organisations/c2`,
          name: 'NFDI',
          url: 'https://c2.example.org',
        },
      ],
    });
  });

  it.each([
    ['the root', '/', ''],
    ['an empty base path', '', ''],
    ['a nested base path', '/a/b', '/a/b'],
    ['a nested base path with a trailing slash', '/a/b/', '/a/b'],
    ['a base path without a leading slash', 'a/b', '/a/b'],
  ])('puts the base path into @id and the logo URL: %s', (_name, basePath, mount) => {
    const profile = toSchemaOrg(source(), options({ basePath }));
    expect(profile['@id']).toBe(`${ORIGIN}${mount}/services/${ID}`);
    expect(profile.logo?.url).toBe(`${ORIGIN}${mount}/api/internal/files/${'a'.repeat(64)}`);
  });

  it('keeps @id stable across a rename of the slug, which is only alternateName', () => {
    const before = toSchemaOrg(source({ slug: 'old' }), options());
    const after = toSchemaOrg(source({ slug: 'new' }), options());
    expect(after['@id']).toBe(before['@id']);
    expect([before.alternateName, after.alternateName]).toEqual(['old', 'new']);
  });

  it('never maps the stage or the contact point, not even when the source and the organisations carry them', () => {
    const profile = toSchemaOrg(
      {
        ...source(),
        stage: 'PROD',
        contactEmail: 'team@example.org',
        contactType: 'support',
      } as never,
      options(),
    );
    const text = JSON.stringify(profile);
    expect(text).not.toMatch(/PROD|team@example|secret@example|contactPoint|stage/);
    // An organisation node holds four properties: the organisation's own profile carries the rest.
    expect(Object.keys(profile.provider!)).toEqual(['@type', '@id', 'name', 'url']);
  });

  it.each([
    ['no description', { description: null }, 'description'],
    ['a blank description', { description: '  ' }, 'description'],
    ['no url', { url: null }, 'url'],
    ['no sameAs', { sameAs: [] }, 'sameAs'],
    ['blank sameAs entries only', { sameAs: ['', '  '] }, 'sameAs'],
    ['no icon', { iconHash: null }, 'logo'],
    ['no known licence', { licenseId: null }, 'license'],
  ] as const)(
    'omits the property when there is %s, never null or an empty string',
    (_n, patch, key) => {
      const profile = toSchemaOrg(source(patch), options());
      expect(key in profile).toBe(false);
      expect(JSON.stringify(profile)).not.toMatch(/:null|:""/);
    },
  );

  it('omits brand without consortia and provider without a provider organisation', () => {
    const profile = toSchemaOrg(source(), options({ organisations: [] }));
    expect('brand' in profile).toBe(false);
    expect('provider' in profile).toBe(false);
  });

  it('lists a repeated sameAs URL once', () => {
    expect(
      toSchemaOrg(source({ sameAs: ['https://a.example', 'https://a.example'] }), options()).sameAs,
    ).toEqual(['https://a.example']);
  });

  it('writes the licence page for the canonical id, encoded', () => {
    expect(licenseUrl('GPL-3.0-or-later')).toBe('https://spdx.org/licenses/GPL-3.0-or-later.html');
    expect(licenseUrl('a/b c')).toBe('https://spdx.org/licenses/a%2Fb%20c.html');
  });
});

describe('configured fields and contributors', () => {
  const fields = [{ key: 'terms', property: 'termsOfService' as const }];

  it('maps a configured field that names one of the four properties, from a string or a list', () => {
    const profile = toSchemaOrg(
      source({ values: { terms: 'https://example.org/terms', audience: ['x'] } }),
      options({ fields: [...fields, { key: 'audience', property: 'audience' }] }),
    );
    expect(profile.termsOfService).toBe('https://example.org/terms');
    expect(profile.audience).toEqual(['x']);
  });

  it('adds the properties a contributor offers on the allow-list, and nothing else', () => {
    const rejected: string[] = [];
    const profile = toSchemaOrg(
      source(),
      options({
        contributors: [
          {
            id: 'kpi.framework',
            properties: {
              serviceType: 'Compute',
              category: ['A', 'B'],
              offers: 'not built',
              provider: 'attacker',
              unknownThing: 'x',
            },
          },
        ],
        onRejected: (contributor, property) => rejected.push(`${contributor}:${property}`),
      }),
    );
    expect(profile.serviceType).toBe('Compute');
    expect(profile.category).toEqual(['A', 'B']);
    expect('offers' in profile).toBe(false);
    expect(rejected.sort()).toEqual([
      'kpi.framework:offers',
      'kpi.framework:provider',
      'kpi.framework:unknownThing',
    ]);
  });

  it.each([
    '@id',
    '@type',
    '@context',
    'name',
    'provider',
    'license',
    'brand',
    'url',
    'logo',
    'sameAs',
    'alternateName',
    'description',
    '__proto__',
    'constructor',
  ])('never lets a contributor overwrite %s', (property) => {
    const clean = toSchemaOrg(source(), options());
    const profile = toSchemaOrg(
      source(),
      options({
        contributors: [{ id: 'evil', properties: JSON.parse(`{"${property}": "overwritten"}`) }],
      }),
    );
    expect(profile).toEqual(clean);
    expect(Object.getPrototypeOf(profile)).toBe(Object.prototype);
  });

  it.each([
    ['an object', { a: 1 }],
    ['a number', 7],
    ['null', null],
    ['an empty string', ''],
    ['a blank string', '   '],
    ['an empty list', []],
    ['a list with a non-string', ['a', 1]],
    ['a list with an empty string', ['a', '']],
    ['a text over the limit', 'x'.repeat(2001)],
    ['a list over the limit', Array.from({ length: 51 }, (_, i) => `v${i}`)],
  ])('drops a contributed value that is %s', (_name, value) => {
    expect(propertyValue(value)).toBeUndefined();
    const profile = toSchemaOrg(
      source(),
      options({ contributors: [{ id: 'c', properties: { slogan: value } }] }),
    );
    expect('slogan' in profile).toBe(false);
  });

  it('applies the first value for a property: a configured field, then the contributors by order', () => {
    const profile = toSchemaOrg(
      source({ values: { terms: 'from the field' } }),
      options({
        fields,
        contributors: [
          { id: 'a', properties: { termsOfService: 'from a', slogan: 'a says' } },
          { id: 'b', properties: { slogan: 'b says' } },
        ],
      }),
    );
    expect(profile).toMatchObject({ termsOfService: 'from the field', slogan: 'a says' });
  });

  it('lists a repeated list value once', () => {
    expect(propertyValue(['a', 'a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('hostile text', () => {
  const HOSTILE = [
    '</script><script>alert(1)</script>',
    '<!-- comment -->',
    '--> <script>',
    'a & b &amp; &lt;',
    'quote " and \' and \\',
    'line\u2028separator\u2029paragraph',
    '</SCRIPT >',
  ];

  it.each(HOSTILE)(
    'serialises %j in the name, the description and a contributor with no unsafe character',
    (text) => {
      const profile = toSchemaOrg(
        source({ name: text, description: text }),
        options({
          organisations: [{ role: 'provider', profile: organisation('p1', text) }],
          contributors: [{ id: 'c', properties: { slogan: text, audience: [text] } }],
        }),
      );
      const json = serializeJsonLd(profile);
      expect(json).not.toMatch(/[<>&\u2028\u2029]/);
      expect(JSON.parse(json)).toEqual(profile);
    },
  );
});

/**
 * The vocabulary of schema.org for a `Service`, checked on 2026-10-12 against https://schema.org/Service and
 * https://schema.org/Thing: a test that fails when the builder writes a property that is not there. `license` is
 * the one documented exception (plan §3 asks for it; schema.org has it on CreativeWork and Product, not on Service,
 * so a validator reports it as a warning: backlog "Services follow-ups (M7 sprint 3)").
 */
const SERVICE_PROPERTIES = [
  'aggregateRating',
  'areaServed',
  'audience',
  'availableChannel',
  'award',
  'brand',
  'broker',
  'category',
  'hasCertification',
  'hasOfferCatalog',
  'hoursAvailable',
  'isRelatedTo',
  'isSimilarTo',
  'logo',
  'offers',
  'provider',
  'providerMobility',
  'review',
  'serviceOutput',
  'serviceType',
  'slogan',
  'termsOfService',
];
const THING_PROPERTIES = [
  'additionalType',
  'alternateName',
  'description',
  'disambiguatingDescription',
  'identifier',
  'image',
  'mainEntityOfPage',
  'name',
  'owner',
  'potentialAction',
  'sameAs',
  'subjectOf',
  'url',
];
const DOCUMENTED_EXCEPTIONS = ['license'];
const ORGANISATION_PROPERTIES = ['name', 'url'];

describe('the output against the schema.org vocabulary', () => {
  const everything = toSchemaOrg(
    source(),
    options({
      contributors: [
        {
          id: 'all',
          properties: Object.fromEntries(CONTRIBUTABLE_PROPERTIES.map((name) => [name, 'v'])),
        },
      ],
    }),
  );

  it('uses only properties of Service and Thing (and the one documented exception)', () => {
    const allowed = new Set([
      '@context',
      '@type',
      '@id',
      ...SERVICE_PROPERTIES,
      ...THING_PROPERTIES,
      ...DOCUMENTED_EXCEPTIONS,
    ]);
    expect(Object.keys(everything).filter((key) => !allowed.has(key))).toEqual([]);
  });

  it('can add only properties that exist on Service, so a contributor cannot invent one', () => {
    for (const property of CONTRIBUTABLE_PROPERTIES) {
      expect(SERVICE_PROPERTIES, property).toContain(property);
    }
  });

  it('writes nested nodes with properties of Thing, an ImageObject for the logo, and ids that are URLs', () => {
    for (const node of [everything.provider!, ...everything.brand!]) {
      expect(
        Object.keys(node).filter((k) => !['@type', '@id', ...ORGANISATION_PROPERTIES].includes(k)),
      ).toEqual([]);
      expect(() => new URL(node['@id'])).not.toThrow();
    }
    expect(everything.logo?.['@type']).toBe('ImageObject');
    expect(() => new URL(everything['@id'])).not.toThrow();
    expect(everything['@context']).toBe('https://schema.org');
    expect(everything['@type']).toBe('Service');
  });
});
