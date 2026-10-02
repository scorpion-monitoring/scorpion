import {
  createRoute,
  paginate,
  paginationQuery,
  listEnvelope,
  z,
  Conflict,
  Forbidden,
  Invalid,
  NotFound,
  Unauthorized,
  type AppEnv,
  type RouteHandler,
} from '@scorpion/contracts';
import { defineModule } from '@scorpion/kernel';

// Fixture: a module with routes that end in every kind of result the pipeline must map.
interface Thing {
  id: string;
  name: string;
}

interface ThingStore {
  list(q: string | undefined): Thing[];
  get(id: string): Thing;
  create(name: string): Thing;
}

const thing = z.object({ id: z.string(), name: z.string() }).meta({ id: 'FixtureThing' });
const json = <S extends z.ZodType>(schema: S) => ({ 'application/json': { schema } });

const list = createRoute({
  method: 'get',
  path: '/things',
  permission: 'fixture.routes.read',
  request: { query: paginationQuery().extend({ q: z.string().max(20).optional() }) },
  responses: { 200: { description: 'A page of things.', content: json(listEnvelope(thing)) } },
});

const get = createRoute({
  method: 'get',
  path: '/things/{id}',
  permission: 'fixture.routes.read',
  request: { params: z.object({ id: z.string().min(1).max(40) }) },
  responses: { 200: { description: 'One thing.', content: json(thing) } },
});

const create = createRoute({
  method: 'post',
  path: '/things',
  permission: 'fixture.routes.write',
  rateLimit: 'strict',
  request: {
    body: { required: true, content: json(z.strictObject({ name: z.string().min(1).max(20) })) },
  },
  responses: { 201: { description: 'Created.', content: json(thing) } },
});

const fail = (path: string, permission = 'fixture.routes.read') =>
  createRoute({ method: 'get', path, permission, responses: { 200: { description: 'Never.' } } });

const ping = createRoute({
  method: 'get',
  path: '/ping',
  public: true,
  publicReason: 'Fixture: proves that public routes bypass the authoriser.',
  responses: {
    200: {
      description: 'pong',
      content: json(z.object({ pong: z.literal(true), requestId: z.string() })),
    },
  },
});

export default defineModule<ThingStore>({
  id: 'fixture.routes',
  version: '1.0.0',
  permissions: {
    'fixture.routes.read': { description: 'Read fixture things' },
    'fixture.routes.write': { description: 'Write fixture things' },
  },
  services: () => {
    const things: Thing[] = Array.from({ length: 45 }, (_, i) => ({
      id: `t${String(i).padStart(2, '0')}`,
      name: `Thing ${i}`,
    }));
    return {
      list: (q) => things.filter((t) => !q || t.name.includes(q)),
      get: (id) =>
        things.find((t) => t.id === id) ??
        (() => {
          throw new NotFound(`No thing "${id}".`);
        })(),
      create(name) {
        if (things.some((t) => t.name === name))
          throw new Conflict(`There is already a thing named "${name}".`);
        const created = { id: `t${things.length}`, name };
        things.push(created);
        return created;
      },
    };
  },
  routes: (r) => {
    const store = r.service<ThingStore>();
    r.internal(list, ((c) => {
      const query = c.req.valid('query');
      const all = store.list(query.q);
      const start = query.page * query.pageSize;
      return c.json(paginate(query, all.length, all.slice(start, start + query.pageSize)), 200);
    }) satisfies RouteHandler<typeof list, AppEnv>);
    r.internal(get, ((c) => c.json(store.get(c.req.valid('param').id), 200)) satisfies RouteHandler<
      typeof get,
      AppEnv
    >);
    r.internal(create, ((c) =>
      c.json(store.create(c.req.valid('json').name), 201)) satisfies RouteHandler<
      typeof create,
      AppEnv
    >);
    r.internal(ping, ((c) =>
      c.json({ pong: true as const, requestId: c.get('requestId') }, 200)) satisfies RouteHandler<
      typeof ping,
      AppEnv
    >);
    r.internal(fail('/boom'), () => {
      throw new Error('kaboom: secret internals postgres://svc:pw-secret@db/x');
    });
    r.internal(fail('/forbidden'), () => {
      throw new Forbidden('You may not touch this.');
    });
    r.internal(fail('/unauthorized'), () => {
      throw new Unauthorized();
    });
    r.internal(fail('/unknown-reference'), () => {
      throw new Invalid('The provider does not exist.', [
        { in: 'body', path: 'provider', message: 'Unknown provider "nope".' },
      ]);
    });
    r.internal(fail('/big', 'fixture.routes.write'), () => new Response('unreachable'));
    r.public('v1', ping, ((c) =>
      c.json({ pong: true as const, requestId: c.get('requestId') }, 200)) satisfies RouteHandler<
      typeof ping,
      AppEnv
    >);
  },
});
