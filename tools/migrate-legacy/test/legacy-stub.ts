// A stub of the legacy REST API (`ipk-bit/scorpion` at 5a92c31) for the tests: a small Hono app over made-up data that
// answers like the legacy routes, quirks included: the measurements route starts at 2022-01-01 unless asked otherwise,
// pages each InfluxDB series (table) on its own, counts only the first one, and leaves out values of 0; the services
// route returns one row per service and provider and leaves out a service without a provider; `/aai/users` answers []
// to a key that is not an administrator's. Every name here is invented.
import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';

export interface StubSeries {
  service: string;
  /** The InfluxDB measurement name: the provider's abbreviation at the time of writing. */
  provider: string;
  /** ISO instants and their fields (KPI name → value). */
  points: { time: string; fields: Record<string, number> }[];
}

export interface StubData {
  providers: { abbreviation: string; name: string }[];
  categories: string[];
  services: {
    abbreviation: string;
    name: string;
    category: string | null;
    providers: string[];
    license: string | null;
    stage: string | null;
    consortia: string[];
  }[];
  kpis: { name: string; description: string }[];
  /** `(CATEGORY)-[:DEFINES {necessity}]->(KPI)`. */
  categoryKpis: { category: string; kpi: string; necessity: string }[];
  /** `(SERVICE)-[:DEFINES]->(KPI)`. */
  serviceKpis: { service: string; kpi: string }[];
  series: StubSeries[];
  users: { id: string; user_name: string; email: string; is_admin: boolean; providers: string[] }[];
  requests: { id: string; userId: string; provider: string }[];
  /** API key → user id. */
  keys: Record<string, string>;
}

/** Made-up data: two providers, a consortium given by name, one service with two series, a value of 0, a full date. */
export function stubData(): StubData {
  return {
    providers: [
      { abbreviation: 'BioNet', name: 'BioNet Services' },
      { abbreviation: 'PlantData', name: 'PlantData Centre' },
      { abbreviation: 'Seed Lab', name: 'Seed Laboratory' },
    ],
    categories: ['Tools', 'Databases'],
    services: [
      {
        abbreviation: 'GeneFlow',
        name: 'GeneFlow',
        category: 'Tools',
        providers: ['BioNet'],
        license: 'MIT',
        stage: 'PROD',
        consortia: ['Imaginary Consortium'],
      },
      {
        abbreviation: 'LeafDB',
        name: 'Leaf Database',
        category: 'Databases',
        providers: ['PlantData'],
        license: 'apache-2.0',
        stage: 'prod',
        consortia: ['IMC', 'Imaginary Consortium'],
      },
      {
        abbreviation: 'Root Atlas',
        name: 'Root Atlas',
        category: 'Databases',
        providers: ['PlantData', 'BioNet'],
        license: 'Proprietary',
        stage: 'DEV',
        consortia: [],
      },
      {
        abbreviation: 'SeedBank',
        name: 'Seed Bank',
        category: 'Databases',
        providers: ['Seed Lab'],
        license: null,
        stage: 'TERM',
        consortia: [],
      },
      {
        abbreviation: 'Orphan',
        name: 'Orphan Service',
        category: 'Tools',
        providers: [],
        license: null,
        stage: 'DEV',
        consortia: [],
      },
    ],
    kpis: [
      { name: 'users', description: 'Users per month' },
      { name: 'jobs', description: 'Jobs per month' },
      { name: 'downloads', description: 'Downloads per month' },
    ],
    categoryKpis: [
      { category: 'Tools', kpi: 'users', necessity: 'mandatory' },
      { category: 'Tools', kpi: 'jobs', necessity: 'optional' },
      { category: 'Databases', kpi: 'users', necessity: 'mandatory' },
    ],
    serviceKpis: [{ service: 'LeafDB', kpi: 'downloads' }],
    series: [
      {
        service: 'GeneFlow',
        provider: 'BioNet',
        points: [
          { time: '2019-11-01T00:00:00Z', fields: { users: 40, jobs: 120 } },
          { time: '2021-12-01T00:00:00Z', fields: { users: 41, jobs: 0 } },
          { time: '2022-01-01T00:00:00Z', fields: { users: 44, jobs: 130 } },
          { time: '2022-01-15T00:00:00Z', fields: { users: 45 } },
        ],
      },
      {
        service: 'LeafDB',
        provider: 'PlantData',
        points: [
          { time: '2020-01-01T00:00:00Z', fields: { users: 10, downloads: 300 } },
          { time: '2020-02-01T00:00:00Z', fields: { users: 11, downloads: 310 } },
        ],
      },
      {
        // The second series of LeafDB: written under an earlier provider name that sorts first, later months.
        service: 'LeafDB',
        provider: 'OldPlant',
        points: [
          { time: '2023-03-01T00:00:00Z', fields: { users: 20 } },
          { time: '2023-04-01T00:00:00Z', fields: { users: 21 } },
          { time: '2023-05-01T00:00:00Z', fields: { users: 22 } },
        ],
      },
    ],
    users: [
      {
        id: 'sub-1',
        user_name: 'Ada Quillfeather',
        email: 'ada.quillfeather@example.org',
        is_admin: true,
        providers: ['BioNet'],
      },
      {
        id: 'sub-2',
        user_name: 'brook-tinkerton',
        email: 'brook.tinkerton@example.org',
        is_admin: false,
        providers: [],
      },
    ],
    requests: [{ id: 'req-1', userId: 'sub-2', provider: 'PlantData' }],
    keys: { 'stub-admin-key-6f1c9a2e': 'sub-1', 'stub-user-key-0b7d3e55': 'sub-2' },
  };
}

/** Python's `str()` of a UTC datetime, as the legacy API prints it. */
export const pythonTime = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '+00:00');

export interface StubServer {
  url: string;
  data: StubData;
  /** Every request: method, path and query. */
  requests: {
    method: string;
    path: string;
    query: Record<string, string>;
    key: string | undefined;
  }[];
  /** Answers the next `n` requests to `path` with 503. */
  failNext(path: string, n: number): void;
  stop(): Promise<void>;
}

function envelope<T>(items: T[], page: number, pageSize: number, total = items.length) {
  const skip = page * pageSize;
  return {
    metadata: {
      currentPage: skip / pageSize,
      pageSize,
      totalCount: total,
      totalPages: Math.ceil(total / pageSize),
    },
    result: items.slice(skip, skip + pageSize),
  };
}

export function legacyApp(
  data: StubData,
  server: Pick<StubServer, 'requests'>,
  failures: Map<string, number>,
) {
  const app = new Hono();
  const userOf = (key: string | undefined) => (key ? data.keys[key] : undefined);
  const paging = (q: Record<string, string>) => ({
    page: Number(q.page ?? 0),
    pageSize: Number(q.pageSize ?? 100),
  });

  app.use('*', async (c, next) => {
    const key = c.req.header('x-api-key');
    server.requests.push({ method: c.req.method, path: c.req.path, query: c.req.query(), key });
    const left = failures.get(c.req.path) ?? 0;
    if (left > 0) {
      failures.set(c.req.path, left - 1);
      return c.json({ detail: 'Service Unavailable' }, 503);
    }
    if (c.req.method !== 'GET') return c.json({ detail: 'Method Not Allowed' }, 405);
    if (!userOf(key)) return c.json({ detail: 'Not authenticated' }, 401);
    return next();
  });

  app.get('/api/v1/providers', (c) => {
    const { page, pageSize } = paging(c.req.query());
    return c.json(envelope(data.providers, page, pageSize));
  });
  app.get('/api/v1/categories', (c) => {
    const { page, pageSize } = paging(c.req.query());
    return c.json(
      envelope(
        data.categories.map((name) => ({ name })),
        page,
        pageSize,
      ),
    );
  });
  app.get('/api/v1/services', (c) => {
    const { page, pageSize } = paging(c.req.query());
    const rows = data.services.flatMap((s) =>
      s.category === null
        ? []
        : s.providers.map((provider) => ({
            abbreviation: s.abbreviation,
            name: s.name,
            category: s.category,
            provider,
            license: s.license,
            consortia: s.consortia,
            stage: s.stage,
          })),
    );
    return c.json(envelope(rows, page, pageSize));
  });
  app.get('/api/v1/indicators', (c) => {
    const q = c.req.query();
    const { page, pageSize } = paging(q);
    const service = q.service ? data.services.find((s) => s.abbreviation === q.service) : undefined;
    if (q.service && !service?.category) return c.json({ detail: 'Internal Server Error' }, 500);
    const categories = service ? [service.category!] : q.category ? [q.category] : data.categories;
    const kpis = [...data.kpis]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((kpi) => {
        const rows = categories.map((category) => {
          const defined = data.categoryKpis.find(
            (d) => d.category === category && d.kpi === kpi.name,
          );
          return { name: category, necessity: defined?.necessity ?? null };
        });
        const own = service
          ? data.serviceKpis.some((d) => d.service === service.abbreviation && d.kpi === kpi.name)
          : false;
        return {
          name: kpi.name,
          description: kpi.description,
          categories: rows,
          selected: rows.some((r) => r.necessity !== null) || own,
        };
      });
    return c.json(envelope(kpis, page, pageSize));
  });
  app.get('/api/v1/measurements', (c) => {
    const q = c.req.query();
    const { page, pageSize } = paging(q);
    const start = Date.parse(q.start ?? '2022-01-01T00:00:00Z');
    const stop = Date.parse(q.stop ?? '2030-12-31T00:00:00Z');
    // InfluxDB returns the tables in the order of their group key, which starts with the measurement name (the provider).
    const tables = data.series
      .filter((s) => s.service === q.service)
      .sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0))
      .map((s) =>
        s.points
          .filter((p) => Date.parse(p.time) >= start && Date.parse(p.time) < stop)
          .sort((a, b) => Date.parse(a.time) - Date.parse(b.time)),
      )
      .filter((records) => records.length > 0);
    const skip = page * pageSize;
    const result = tables.flatMap((records) =>
      records.slice(skip, skip + pageSize).flatMap((record) =>
        Object.entries(record.fields)
          // `if (record[label] ...)`: a value of 0 is falsy and left out.
          .filter(([, value]) => Boolean(value))
          .map(([kpi, value]) => ({ date: pythonTime(record.time), kpi, value })),
      ),
    );
    const total = tables[0]?.length ?? 0;
    return c.json({
      metadata: {
        currentPage: page,
        pageSize,
        totalCount: total,
        totalPages: Math.ceil(total / pageSize),
      },
      result,
    });
  });
  app.get('/aai/users', (c) => {
    const me = data.users.find((u) => u.id === userOf(c.req.header('x-api-key')));
    if (!me?.is_admin) return c.json([]);
    return c.json(
      data.users.map((u) => ({
        user_name: u.user_name,
        email: u.email,
        is_admin: u.is_admin,
        providers: u.providers,
      })),
    );
  });
  app.get('/aai/requests/membership', (c) =>
    c.json(
      data.requests.map((r) => {
        const u = data.users.find((user) => user.id === r.userId)!;
        return { id: r.id, mail: u.email, username: u.user_name, provider: r.provider };
      }),
    ),
  );
  return app;
}

/** Starts the stub on a free port below `prefix` (the legacy `PREFIX`). */
export async function startLegacyStub(
  data: StubData = stubData(),
  prefix = '/legacy',
): Promise<StubServer> {
  const requests: StubServer['requests'] = [];
  const failures = new Map<string, number>();
  const inner = legacyApp(data, { requests }, failures);
  const app = new Hono().route(prefix, inner);
  let server: ServerType | undefined;
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) =>
      resolve(info.port),
    );
  });
  return {
    url: `http://127.0.0.1:${port}${prefix}`,
    data,
    requests,
    failNext: (path, n) => failures.set(`${prefix}${path}`, n),
    stop: () => new Promise<void>((done) => server!.close(() => done())),
  };
}
