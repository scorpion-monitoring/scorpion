// The Schema.org `Service` profile of a service (ADR-0035, plan §3). Pure: no database, no settings, no
// network. One function builds the object for the signed-in route, the public route and the page block;
// turning it into a string for HTML is `serializeJsonLd` of registry.organisations (one escape function).
//
// Never mapped: the stage and the contact point (`Service` has neither a lifecycle nor a `contactPoint`).
import type { SchemaOrgProfile } from '@scorpion/registry-organisations/public';
import { OWNER_ROLE } from './permissions.ts';
import type { FieldSchemaOrgProperty } from './registries.ts';

/** The role whose organisations are the `brand` of a service (the network it is offered under). */
export const BRAND_ROLE = 'consortium';

/**
 * The properties another module (or a configured field) may add. Anything else a contributor returns is
 * dropped: it can never replace `@id`, `@type`, `name`, `provider`, `license` or any property the builder sets.
 */
export const CONTRIBUTABLE_PROPERTIES = [
  'serviceType',
  'category',
  'audience',
  'areaServed',
  'termsOfService',
  'slogan',
  'serviceOutput',
] as const;
export type ContributableProperty = (typeof CONTRIBUTABLE_PROPERTIES)[number];

export const MAX_PROPERTY_TEXT = 2000;
export const MAX_PROPERTY_ITEMS = 50;

/** What the profile needs of a service, as stored. */
export interface SchemaOrgSource {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  url: string | null;
  sameAs: readonly string[];
  iconHash: string | null;
  /** An SPDX id the bundled list knows, in its canonical case; `null` for none or an unknown one. */
  licenseId: string | null;
  /** The values of the configured fields stored as values, by field key. */
  values: Readonly<Record<string, unknown>>;
}

export interface Contribution {
  /** The contributor's id, for the report of a dropped property. */
  id: string;
  properties: Readonly<Record<string, unknown>>;
}

export interface SchemaOrgOptions {
  /** The instance origin, no trailing slash. */
  origin: string;
  /** The mount path: `''`, `'/'` or `/a/b`. */
  basePath: string;
  /** The organisations of the service with their role, each profile built without a contact point. */
  organisations: readonly { role: string; profile: SchemaOrgProfile }[];
  /** In the order they are applied: for one property the first value wins. */
  contributors?: readonly Contribution[];
  /** Configured fields that map to a property; their value comes from `source.values`. */
  fields?: readonly { key: string; property: FieldSchemaOrgProperty }[];
  /** Called for every property a contributor offered that was not accepted. */
  onRejected?: (contributor: string, property: string) => void;
}

export interface OrganisationNode {
  '@type': string;
  '@id': string;
  name: string;
  url: string;
}

export type PropertyValue = string | string[];

export interface ServiceProfile {
  '@context': 'https://schema.org';
  '@type': 'Service';
  '@id': string;
  name: string;
  alternateName: string;
  description?: string;
  url?: string;
  sameAs?: string[];
  logo?: { '@type': 'ImageObject'; url: string };
  license?: string;
  provider?: OrganisationNode;
  brand?: OrganisationNode[];
  serviceType?: PropertyValue;
  category?: PropertyValue;
  audience?: PropertyValue;
  areaServed?: PropertyValue;
  termsOfService?: PropertyValue;
  slogan?: PropertyValue;
  serviceOutput?: PropertyValue;
}

/** `''` for the root, else `/a/b` without a trailing slash. */
function mount(basePath: string): string {
  const trimmed = basePath.replace(/\/+$/, '');
  return trimmed === '' || trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

const nonEmpty = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim() !== '';

const root = (options: Pick<SchemaOrgOptions, 'origin' | 'basePath'>) =>
  `${options.origin.replace(/\/+$/, '')}${mount(options.basePath)}`;

/** The absolute URL of the service; also its `@id`. It holds the id, so it survives a rename of the slug. */
export function serviceUrl(id: string, options: Pick<SchemaOrgOptions, 'origin' | 'basePath'>) {
  return `${root(options)}/services/${id}`;
}

/** Where an icon is served; the file route is public and the hash is of the stored bytes. */
export function iconUrl(hash: string, options: Pick<SchemaOrgOptions, 'origin' | 'basePath'>) {
  return `${root(options)}/api/internal/files/${hash}`;
}

export const licenseUrl = (id: string) =>
  `https://spdx.org/licenses/${encodeURIComponent(id)}.html`;

/** A string, or a short list of strings; anything else (an object, a number, an empty text) is no value. */
export function propertyValue(value: unknown): PropertyValue | undefined {
  const text = (item: unknown): string | undefined =>
    typeof item === 'string' && item.trim() !== '' && item.length <= MAX_PROPERTY_TEXT
      ? item
      : undefined;
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) {
    const items = value.map(text);
    if (items.length === 0 || items.length > MAX_PROPERTY_ITEMS || items.includes(undefined)) {
      return undefined;
    }
    return [...new Set(items as string[])];
  }
  return undefined;
}

const organisationNode = (profile: SchemaOrgProfile): OrganisationNode => ({
  '@type': profile['@type'],
  '@id': profile['@id'],
  name: profile.name,
  url: profile.url,
});

const ALLOWED = new Set<string>(CONTRIBUTABLE_PROPERTIES);

/** Builds the profile. A property without a value is left out, never `null` or an empty string. */
export function toSchemaOrg(source: SchemaOrgSource, options: SchemaOrgOptions): ServiceProfile {
  const sameAs = [...new Set(source.sameAs.filter(nonEmpty))];
  const byRole = (role: string) =>
    options.organisations.filter((o) => o.role === role).map((o) => organisationNode(o.profile));
  const [provider] = byRole(OWNER_ROLE);
  const brand = byRole(BRAND_ROLE);

  const profile: ServiceProfile = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': serviceUrl(source.id, options),
    name: source.name,
    alternateName: source.slug,
    ...(nonEmpty(source.description) && { description: source.description }),
    ...(nonEmpty(source.url) && { url: source.url }),
    ...(sameAs.length > 0 && { sameAs }),
    ...(nonEmpty(source.iconHash) && {
      logo: { '@type': 'ImageObject', url: iconUrl(source.iconHash, options) },
    }),
    ...(nonEmpty(source.licenseId) && { license: licenseUrl(source.licenseId) }),
    ...(provider && { provider }),
    ...(brand.length > 0 && { brand }),
  };

  const extra: Partial<Record<ContributableProperty, PropertyValue>> = {};
  // A configured field names its property itself; it comes before the contributors.
  for (const field of options.fields ?? []) {
    const value = propertyValue(source.values[field.key]);
    if (value !== undefined && !(field.property in extra)) extra[field.property] = value;
  }
  for (const contributor of options.contributors ?? []) {
    for (const [property, raw] of Object.entries(contributor.properties)) {
      const value = propertyValue(raw);
      if (!ALLOWED.has(property) || value === undefined) {
        options.onRejected?.(contributor.id, property);
        continue;
      }
      if (!(property in extra)) extra[property as ContributableProperty] = value;
    }
  }
  return Object.assign(profile, extra);
}
