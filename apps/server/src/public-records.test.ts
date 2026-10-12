// ASVS 8.2.3 (field-level access, response side) for the anonymous reads of M7 sprint 3 (ADR-0036 part 2). The
// public records are separate response schemas with PINNED field names: a walker over the LIVE route registry
// compares every property of the public service record and the public organisation record, at any depth, with the
// list below. A field added to either fails here until the ADR, the field table of docs/security/authorization.md
// and this list change together; a private field never passes, and no public route declares a contact field.
import { z } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();

/** The properties of the public service record, by path, and nothing else. */
const PUBLIC_SERVICE = [
  'consortia',
  'consortia[].id',
  'consortia[].name',
  'consortia[].public',
  'description',
  'id',
  'license',
  'logoUrl',
  'name',
  'provider',
  'provider.id',
  'provider.name',
  'provider.public',
  'sameAs',
  'slug',
  'stage',
  'url',
];
/** The properties of the public organisation record, by path, and nothing else. */
const PUBLIC_ORGANISATION = [
  'abbreviation',
  'description',
  'id',
  'logoUrl',
  'name',
  'rorId',
  'sameAs',
  'services',
  'services[].id',
  'services[].name',
  'services[].slug',
  'website',
];
/** The property names of the Schema.org profiles; the profile of a service has no contact point and no stage. */
const PUBLIC_PROFILE_ORGANISATION = [
  '@context',
  '@type',
  '@id',
  'name',
  'alternateName',
  'description',
  'url',
  'identifier',
  'identifier.@type',
  'identifier.propertyID',
  'identifier.value',
  'sameAs',
  'logo',
  'logo.@type',
  'logo.url',
];

/** What no public answer may name, at any depth. */
const PRIVATE_NAMES =
  /contact|editableFields|allowedActions|values|createdAt|updatedAt|createdBy|updatedBy|published|memberCount|myMembership|member|email|^type$|typeKnown|iconBlobId|logoBlobId|passwordHash|secret|token/i;

type Json = {
  type?: string;
  properties?: Record<string, Json>;
  items?: Json;
  [k: string]: unknown;
};
const isZod = (value: unknown): value is z.ZodType =>
  value !== null && typeof value === 'object' && '_zod' in value;

/** Every property path of a schema: `provider.id`, `consortia[].name`. */
function paths(schema: unknown): string[] {
  const json = (
    isZod(schema) ? z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }) : schema
  ) as Json;
  const out: string[] = [];
  const walk = (node: Json | undefined, prefix: string) => {
    if (!node) return;
    for (const [name, child] of Object.entries(node.properties ?? {})) {
      const here = prefix ? `${prefix}.${name}` : name;
      out.push(here);
      walk(child, here);
    }
    if (node.items) walk(node.items, `${prefix}[]`);
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      for (const branch of (node[key] as Json[] | undefined) ?? []) walk(branch, prefix);
    }
  };
  walk(json, '');
  // `consortia[]` is a prefix, not a property: the items' own properties are named `consortia[].id`.
  return out.map((path) => path.replace(/^\[\]\./, ''));
}

async function routes() {
  const { kernel } = await app.start();
  return kernel.routes.map((entry) => entry.route) as unknown as {
    method: string;
    path: string;
    public?: boolean;
    publicReason?: string;
    responses: Record<string, { content?: Record<string, { schema?: unknown }> } | undefined>;
  }[];
}
const schemaOf = (
  list: Awaited<ReturnType<typeof routes>>,
  path: string,
  mime = 'application/json',
) =>
  list.find((r) => r.method === 'get' && r.path === path)?.responses[200]?.content?.[mime]?.schema;

describe('the public records name exactly the pinned fields [ASVS-8.2.3]', () => {
  it('holds for the public service record', async () => {
    const schema = schemaOf(await routes(), '/public/services/{ref}');
    expect(paths(schema).sort()).toEqual([...PUBLIC_SERVICE].sort());
  });

  it('holds for the public organisation record', async () => {
    const schema = schemaOf(await routes(), '/public/organisations/{id}');
    expect(paths(schema).sort()).toEqual([...PUBLIC_ORGANISATION].sort());
  });

  it('holds for the public profile of an organisation: the organisation profile without its contact point', async () => {
    const schema = schemaOf(
      await routes(),
      '/public/organisations/{id}/schema-org',
      'application/ld+json',
    );
    expect(paths(schema).sort()).toEqual([...PUBLIC_PROFILE_ORGANISATION].sort());
  });

  it('names no private field anywhere in a public route’s answer, at any depth', async () => {
    const list = await routes();
    const publicRoutes = list.filter((route) => route.path.startsWith('/public/'));
    expect(publicRoutes.map((r) => r.path).sort()).toEqual([
      '/public/organisations/{id}',
      '/public/organisations/{id}/schema-org',
      '/public/services/{ref}',
      '/public/services/{ref}/schema-org',
    ]);
    for (const route of publicRoutes) {
      for (const [status, response] of Object.entries(route.responses)) {
        for (const [mime, content] of Object.entries(response?.content ?? {})) {
          for (const path of paths(content.schema)) {
            const name = path.slice(path.lastIndexOf('.') + 1);
            expect(name, `${route.path} ${status} ${mime}: ${path}`).not.toMatch(PRIVATE_NAMES);
          }
        }
      }
    }
  });

  it('names no contact point and no stage in the profile a signed-in reader gets either', async () => {
    const schema = schemaOf(await routes(), '/services/{id}/schema-org', 'application/ld+json');
    const names = paths(schema);
    expect(names.length).toBeGreaterThan(8);
    expect(names.filter((n) => /contact|stage/i.test(n))).toEqual([]);
  });

  it('really walks: a planted private field in a public record is named', () => {
    const planted = z.object({
      id: z.string(),
      provider: z.object({ id: z.string(), contactEmail: z.string() }),
    });
    expect(paths(planted)).toContain('provider.contactEmail');
    expect(
      paths(planted).filter((p) => PRIVATE_NAMES.test(p.slice(p.lastIndexOf('.') + 1))),
    ).toEqual(['provider.contactEmail']);
  });
});

describe('the public routes of the live registry are the ones the ADR names', () => {
  it('lists exactly the four public routes under /public, each with a reason, and none writes [ASVS-8.2.1]', async () => {
    const list = await routes();
    const under = list.filter((route) => route.path.startsWith('/public/'));
    expect(under.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'get /public/organisations/{id}',
      'get /public/organisations/{id}/schema-org',
      'get /public/services/{ref}',
      'get /public/services/{ref}/schema-org',
    ]);
    for (const route of under) {
      expect(route.public, route.path).toBe(true);
      expect(route.publicReason!.length, route.path).toBeGreaterThan(60);
      expect(route.publicReason, route.path).toMatch(/404/);
    }
    // No route under /public changes anything, and no route outside it serves a record of the same kind anonymously.
    expect(under.every((route) => route.method === 'get')).toBe(true);
  });
});
