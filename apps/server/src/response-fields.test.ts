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

// The contact point of an organisation (and of a service, below) is the organisation's role address, not a user's (M6 sprint 2, field
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
  // A service has the same kind of contact point (M7): the record serves it to Admin and the members of its
  // provider always (the scoped `service.read-contact`), and to other signed-in persons by the setting
  // `exposeContactPoint`. Every route that returns the record may carry it (the edit, the icon and the
  // publication routes answer with the record). Never in a list row, an event or the Schema.org profile (a
  // `Service` has no contact point).
  'GET /services/{id}': ['contactEmail', 'contactType'],
  'GET /services/by-slug/{slug}': ['contactEmail', 'contactType'],
  'POST /services': ['contactEmail', 'contactType'],
  'PATCH /services/{id}': ['contactEmail', 'contactType'],
  'PUT /services/{id}/icon': ['contactEmail', 'contactType'],
  'DELETE /services/{id}/icon': ['contactEmail', 'contactType'],
  'PUT /services/{id}/publication': ['contactEmail', 'contactType'],
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
      'GET /services',
      'GET /services/facets',
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

// The field table of a membership (docs/security/authorization.md, section Membership; M6 sprint 5). What each
// membership route may return is pinned name by name, so a new field has to pass through this list and the
// table. The member list shows a username and a date, nothing else: no state, no role, no address, no id of
// the person. An address of a person is in no membership answer; `decidedBy` and `endedBy` are stored and are
// returned by no route (the audit trail holds who acted).
const ENVELOPE = ['metadata', 'currentPage', 'pageSize', 'totalCount', 'totalPages', 'result'];
const ORGANISATION_REF = ['id', 'type', 'abbreviation', 'name'];
const MANAGED_ROW = [
  'id',
  'organisation',
  ...ORGANISATION_REF.slice(1), // `id` is already there
  'userId',
  'username',
  'state',
  'role',
  'requestedAt',
  'decidedAt',
  'roleChangedAt',
  'allowedActions',
];
const MEMBERSHIP_ANSWERS: Record<string, readonly string[]> = {
  'GET /organisations/{id}/members': ['username', 'since'],
  'GET /account/memberships': [
    'id',
    'organisation',
    ...ORGANISATION_REF.slice(1),
    'state',
    'role',
    'requestedAt',
    'decidedAt',
    'endedAt',
  ],
  'GET /memberships': MANAGED_ROW,
  'GET /memberships/summary': ['pending', 'manages'],
  'POST /memberships/{id}/decision': MANAGED_ROW,
  'POST /memberships/{id}/role': MANAGED_ROW,
  'POST /memberships/{id}/remove': MANAGED_ROW,
};

describe('the fields of a membership', () => {
  it('are the ones the field table names, per route, and no address or decider is among them [ASVS-8.2.3]', async () => {
    const { kernel } = await app.start();
    for (const [key, expected] of Object.entries(MEMBERSHIP_ANSWERS)) {
      const entry = kernel.routes.find(
        ({ route }) => `${route.method.toUpperCase()} ${route.path}` === key,
      );
      expect(entry, key).toBeDefined();
      const names = new Set(
        Object.entries((entry!.route as RouteLike).responses ?? {})
          .filter(([status]) => status === '200')
          .flatMap(([, response]) =>
            Object.values(response?.content ?? {}).flatMap((content) =>
              propertyNames(content.schema).map((at) => at.slice(at.lastIndexOf('.') + 1)),
            ),
          ),
      );
      for (const name of ENVELOPE) names.delete(name);
      expect([...names].sort(), key).toEqual([...new Set(expected)].sort());
      for (const name of names) expect(name, key).not.toMatch(/email|address|decidedBy|endedBy/i);
    }
  });

  it('are the whole membership surface: every route that names a membership is in the list above or acts on the caller’s own row', async () => {
    const { kernel } = await app.start();
    const keys = kernel.routes
      .map(({ route }) => `${route.method.toUpperCase()} ${route.path}`)
      .filter((key) => /membership/.test(key));
    const ownRow = ['POST /organisations/{id}/membership', 'DELETE /organisations/{id}/membership'];
    expect(keys.sort()).toEqual(
      [
        ...Object.keys(MEMBERSHIP_ANSWERS).filter((key) => /membership/.test(key)),
        ...ownRow,
      ].sort(),
    );
  });
});

// The schema of the create wizard (M7 sprint 5, docs/security/authorization.md, "The create body and the schema
// of the create wizard"). It tells the browser how to draw and check the form and holds nothing of any person
// or service: the property names are pinned here, so a field that is added has to pass through this list and the
// table, and none of them is a name that belongs to a person, an organisation or a record. `limits.email` and
// `limits.contactKind` are numbers (the most characters a contact address and its kind may have), not contact data.
const CREATE_SCHEMA_NAMES = [
  'bodyBytes',
  'choices',
  'column',
  'component',
  'config',
  'contactKind',
  'contributed',
  'default',
  'defaults',
  'description',
  'de',
  'deferred',
  'devConsole',
  'email',
  'en',
  'fieldTypes',
  'fields',
  'help',
  'id',
  'intro',
  'key',
  'label',
  'labelKey',
  'labels',
  'limits',
  'max',
  'memberOnly',
  'min',
  'name',
  'order',
  'orgTypes',
  'path',
  'required',
  'role',
  'roles',
  'sameAs',
  'schema',
  'slug',
  'steps',
  'title',
  'type',
  'url',
  'value',
  'widget',
];

describe('the schema of the create wizard', () => {
  it('names exactly the properties the field table lists, and nothing of a person or a record', async () => {
    const { kernel } = await app.start();
    const entry = kernel.routes.find(
      ({ route }) => `${route.method.toUpperCase()} ${route.path}` === 'GET /services/schema',
    );
    expect(entry, 'GET /services/schema').toBeDefined();
    const names = new Set(
      Object.entries((entry!.route as RouteLike).responses ?? {})
        .filter(([status]) => status === '200')
        .flatMap(([, response]) =>
          Object.values(response?.content ?? {}).flatMap((content) =>
            propertyNames(content.schema).map((at) => at.slice(at.lastIndexOf('.') + 1)),
          ),
        ),
    );
    expect([...names].sort()).toEqual([...CREATE_SCHEMA_NAMES].sort());
    for (const name of names) {
      expect(name).not.toMatch(
        /user|owner|createdBy|updatedBy|password|secret|token|contactEmail|contactPoint/i,
      );
    }
  });
});
