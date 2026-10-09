// ASVS 8.2.3 (field-level access, response side). A walker over the LIVE route registry: no response
// schema of any route, at any depth, may declare a property that names a secret. There is no field-level
// permission engine (M4b Decision 9); the guard is that such a field is never part of a response at all,
// and the one-time creation responses are the named exceptions below.
//
// The walker turns every response schema into JSON Schema (`z.toJSONSchema` follows arrays, unions,
// intersections, optionals, nullables, records, lazy schemas and references) and collects the key of
// every `properties` map it meets. A schema that is already plain OpenAPI JSON is walked as it is.
import { z } from '@scorpion/contracts';
import { describe, expect, it } from 'vitest';
import { useIdentityApp } from './testing/identity-app.ts';

const app = useIdentityApp();

/** Property names no response may carry. Exact names: `csrfToken` and `avatarHash` are different fields. */
const FORBIDDEN = [
  'secretHash',
  'passwordHash',
  'tokenHash',
  'clientSecret',
  'secret',
  'password',
  'token',
] as const;

/**
 * The routes whose response may carry a forbidden name, and which names. `token` is the plaintext of a
 * personal access token, shown once to its owner when it is created or rotated and never again
 * (ADR 0015); the list route returns the token's metadata and no secret.
 */
const EXCEPTIONS: Record<string, readonly string[]> = {
  'POST /tokens': ['token'], // one-time creation response
  'POST /tokens/{id}/rotate': ['token'], // one-time response: the new plaintext replaces the old
};

interface RouteLike {
  method: string;
  path: string;
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> } | undefined>;
}

/** Every property name declared anywhere inside a schema, with the path it was found at. */
function propertyNames(schema: unknown): string[] {
  const json = isZod(schema)
    ? z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' })
    : schema;
  const found: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
    } else if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'properties' && value !== null && typeof value === 'object') {
          for (const name of Object.keys(value)) found.push(`${path}.${name}`);
        }
        walk(value, `${path}.${key}`);
      }
    }
  };
  walk(json, '');
  return found;
}
const isZod = (value: unknown): value is z.ZodType =>
  value !== null && typeof value === 'object' && '_zod' in value;

/** The violations of a route list: `GET /x 200 application/json: .result.items.passwordHash`. */
function forbiddenResponseFields(routes: readonly RouteLike[]): string[] {
  const violations: string[] = [];
  for (const route of routes) {
    const key = `${route.method.toUpperCase()} ${route.path}`;
    const allowed = EXCEPTIONS[key] ?? [];
    for (const [status, response] of Object.entries(route.responses ?? {})) {
      for (const [mime, content] of Object.entries(response?.content ?? {})) {
        for (const at of propertyNames(content.schema)) {
          const name = at.slice(at.lastIndexOf('.') + 1);
          if ((FORBIDDEN as readonly string[]).includes(name) && !allowed.includes(name)) {
            violations.push(`${key} ${status} ${mime}: ${at}`);
          }
        }
      }
    }
  }
  return violations;
}

describe('response schemas never name a secret', () => {
  it('holds for every route of the live registry [ASVS-8.2.3]', async () => {
    const { kernel } = await app.start();
    const routes = kernel.routes.map((entry) => entry.route as RouteLike);
    expect(forbiddenResponseFields(routes)).toEqual([]);
  });

  it('really walks the registry: it sees the routes that carry the risky data', async () => {
    const { kernel } = await app.start();
    const keys = kernel.routes.map(
      (entry) => `${entry.route.method.toUpperCase()} ${entry.route.path}`,
    );
    expect(keys.length).toBeGreaterThan(40);
    for (const expected of [
      'POST /tokens',
      'POST /tokens/{id}/rotate',
      'GET /tokens',
      'GET /account/sessions',
      'GET /audit',
      'GET /secrets',
      'GET /auth/me',
    ]) {
      expect(keys).toContain(expected);
    }
    // The exceptions name routes that exist (a renamed route must not leave a stale exception).
    for (const key of Object.keys(EXCEPTIONS)) expect(keys).toContain(key);
    // And it reads the schemas: the token route's response names `token`, the list route's does not.
    const names = (key: string) =>
      kernel.routes
        .filter((e) => `${e.route.method.toUpperCase()} ${e.route.path}` === key)
        .flatMap((e) =>
          propertyNames(
            (e.route as RouteLike).responses?.['200']?.content?.['application/json']?.schema ??
              (e.route as RouteLike).responses?.['201']?.content?.['application/json']?.schema,
          ),
        )
        .map((at) => at.slice(at.lastIndexOf('.') + 1));
    expect(names('POST /tokens')).toContain('token');
    expect(names('GET /tokens')).not.toContain('token');
    expect(names('GET /tokens')).toContain('prefix');
  });

  it('names a planted violation, at any depth and through every wrapper [ASVS-8.2.3]', () => {
    const user = z.object({ id: z.string(), passwordHash: z.string() });
    const planted = (schema: z.ZodType): RouteLike => ({
      method: 'get',
      path: '/planted',
      responses: { 200: { content: { 'application/json': { schema } } } },
    });
    const wrappers: Record<string, z.ZodType> = {
      plain: user,
      'in an array': z.array(user),
      'in an envelope': z.object({ metadata: z.object({}), result: z.array(user) }),
      optional: z.object({ a: user.optional() }),
      nullable: z.object({ a: user.nullable() }),
      'in a union': z.union([z.object({ ok: z.boolean() }), user]),
      'in an intersection': z.intersection(z.object({ ok: z.boolean() }), user),
      'in a record': z.record(z.string(), user),
      'in a lazy schema': z.lazy(() => user),
      'a deep secret': z.object({
        a: z.object({ b: z.array(z.object({ clientSecret: z.string() })) }),
      }),
      'a plain token': z.object({ token: z.string() }),
    };
    for (const [label, schema] of Object.entries(wrappers)) {
      const violations = forbiddenResponseFields([planted(schema)]);
      expect(violations, label).toHaveLength(1);
      expect(violations[0], label).toMatch(
        /^GET \/planted 200 application\/json: \..*(passwordHash|clientSecret|token)$/,
      );
    }
    // A plain OpenAPI object is walked as well, and the exception list is exact: another route
    // that returns `token` is a violation, and so is `secret` on the token route.
    expect(
      forbiddenResponseFields([
        {
          method: 'get',
          path: '/raw',
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { secretHash: { type: 'string' } } },
                },
              },
            },
          },
        },
        {
          method: 'post',
          path: '/tokens',
          responses: {
            201: {
              content: {
                'application/json': { schema: z.object({ token: z.string(), secret: z.string() }) },
              },
            },
          },
        },
      ]),
    ).toEqual([
      'GET /raw 200 application/json: .secretHash',
      'POST /tokens 201 application/json: .secret',
    ]);
    // The fields that merely look alike are not forbidden.
    expect(
      forbiddenResponseFields([
        planted(z.object({ csrfToken: z.string(), avatarHash: z.string(), tokenId: z.string() })),
      ]),
    ).toEqual([]);
  });
});

describe('event payloads never name a secret', () => {
  // Events go to the outbox and to subscribers. The schemas are strict (decisions.test.ts in
  // core.audit), so what a schema does not declare cannot ride along; here no declared field is a secret.
  it('holds for every event the loaded modules declare', async () => {
    const { kernel } = await app.start();
    const events = [...kernel.composition.events.values()];
    expect(events.length).toBeGreaterThan(20);
    const violations = events.flatMap((event) =>
      propertyNames(event.schema)
        .filter((at) =>
          (FORBIDDEN as readonly string[]).includes(at.slice(at.lastIndexOf('.') + 1)),
        )
        .map((at) => `${event.name}: ${at}`),
    );
    expect(violations).toEqual([]);
  });
});

// The contact point of an organisation is the organisation's role address, not a user's (M6 sprint 2, field
// table of docs/security/authorization.md). It may appear in the answers of exactly these routes, which
// serve it only to the readers the table names: Admin and the managers of that organisation always, other
// signed-in persons while `organisation.exposeContactPoint` is on. It is never in a list row, a member list,
// a membership, an event payload or any other route.
const CONTACT_FIELDS = ['contactEmail', 'contactType', 'contactPoint'] as const;
const CONTACT_ROUTES: Record<string, readonly string[]> = {
  'GET /organisations/{id}': ['contactEmail', 'contactType'],
  'POST /organisations': ['contactEmail', 'contactType'],
  'PATCH /organisations/{id}': ['contactEmail', 'contactType'],
  'PUT /organisations/{id}/logo': ['contactEmail', 'contactType'],
  'DELETE /organisations/{id}/logo': ['contactEmail', 'contactType'],
  // The profile nests `contactType` inside `contactPoint`.
  'GET /organisations/{id}/schema-org': ['contactPoint', 'contactType'],
};
/** The instance's own contact address (branding settings), a different thing that happens to share a name. */
const NOT_THE_ORGANISATIONS = ['GET /branding'];

describe('the contact point of an organisation', () => {
  it('is declared by the routes the field table names and by no other route [ASVS-8.2.3]', async () => {
    const { kernel } = await app.start();
    const found: Record<string, string[]> = {};
    for (const { route } of kernel.routes) {
      const key = `${route.method.toUpperCase()} ${route.path}`;
      if (NOT_THE_ORGANISATIONS.includes(key)) continue;
      const names = new Set<string>();
      for (const response of Object.values((route as RouteLike).responses ?? {})) {
        for (const content of Object.values(response?.content ?? {})) {
          for (const at of propertyNames(content.schema)) {
            const name = at.slice(at.lastIndexOf('.') + 1);
            if ((CONTACT_FIELDS as readonly string[]).includes(name)) names.add(name);
          }
        }
      }
      if (names.size > 0) found[key] = [...names].sort();
    }
    expect(found).toEqual(
      Object.fromEntries(
        Object.entries(CONTACT_ROUTES).map(([key, names]) => [key, [...names].sort()]),
      ),
    );
  });

  it('is in no event payload, and no event payload of the organisation module carries a value of the record [ASVS-8.2.3]', async () => {
    const { kernel } = await app.start();
    const VALUES =
      /contact|email|address|website|sameas|ror|description|url|logo|name$|abbreviation/i;
    const offenders = [...kernel.composition.events.values()]
      .filter((event) => event.name.startsWith('registry.'))
      .flatMap((event) =>
        propertyNames(event.schema)
          .map((at) => at.slice(at.lastIndexOf('.') + 1))
          .filter((name) => VALUES.test(name))
          .map((name) => `${event.name}: ${name}`),
      );
    expect(offenders).toEqual([]);
  });

  it('is never part of a list row, a member list or a membership: those schemas name no contact field', async () => {
    const { kernel } = await app.start();
    const mustNot = [
      'GET /organisations',
      'GET /organisations/{id}/members',
      'GET /memberships',
      'GET /account/memberships',
    ];
    for (const key of mustNot) {
      const entry = kernel.routes.find(
        ({ route }) => `${route.method.toUpperCase()} ${route.path}` === key,
      );
      expect(entry, key).toBeDefined();
      const names = Object.values((entry!.route as RouteLike).responses ?? {}).flatMap((response) =>
        Object.values(response?.content ?? {}).flatMap((content) => propertyNames(content.schema)),
      );
      for (const name of names) expect(name, key).not.toMatch(/contact|email/i);
    }
  });
});
