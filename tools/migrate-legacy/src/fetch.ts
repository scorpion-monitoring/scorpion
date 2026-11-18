// `migrate-legacy fetch`: reads the legacy REST API into a snapshot directory (layout in snapshot.ts). GET requests only.
//
// Two quirks of the measurements route (`crud.get_measurements_for_service`) are handled here:
// - its `start` defaults to 2022-01-01, so the fetch asks from 1900 (and up to 2100, past the default stop of 2030);
// - it pages each InfluxDB table (series) on its own and counts only the first one, so the fetch asks for one page that
//   is larger than any history and then reads the next page, which must be empty: proof that no series was cut.
import { join } from 'node:path';
import { z } from 'zod';
import { emptyPrivateDirectory, sha256, writePrivateFile } from './files.ts';
import { LegacyApiError, type LegacyClient } from './http.ts';
import {
  envelope,
  legacyCategory,
  legacyIndicator,
  legacyMeasurement,
  legacyMembershipRequest,
  legacyProvider,
  legacyService,
  legacyUser,
} from './legacy.ts';
import { FILES, MANIFEST, measurementFile, SNAPSHOT_FORMAT, type Manifest } from './snapshot.ts';

export const MEASUREMENTS_START = '1900-01-01T00:00:00Z';
export const MEASUREMENTS_STOP = '2100-01-01T00:00:00Z';
/** Larger than any history: one point per KPI and month for 8000 years. */
export const MEASUREMENTS_PAGE_SIZE = 100_000;
/** The page size of the other list routes (their default; the routes have no maximum). */
export const LIST_PAGE_SIZE = 100;

export interface FetchCounts {
  providers: number;
  categories: number;
  serviceRows: number;
  services: number;
  indicatorAnswers: number;
  users: number;
  membershipRequests: number;
  measurementPoints: number;
}

function checked<T>(what: string, schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new LegacyApiError(
      `${what} did not answer in the expected shape (${first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'invalid'}).`,
    );
  }
  return result.data;
}

/** Every page of a list route of `/api/v1`, until `totalCount` items are read. */
async function allPages<T>(
  client: LegacyClient,
  path: string,
  item: z.ZodType<T>,
  query: Record<string, string> = {},
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 0; page < 100_000; page++) {
    const body = checked(
      `GET ${path}`,
      envelope(item),
      await client.get(path, { ...query, page, pageSize: LIST_PAGE_SIZE }),
    );
    items.push(...body.result);
    if (items.length >= body.metadata.totalCount) return items;
    if (body.result.length === 0) {
      throw new LegacyApiError(
        `GET ${path} stopped at ${items.length} of ${body.metadata.totalCount} items.`,
      );
    }
  }
  throw new LegacyApiError(`GET ${path} has more pages than the fetch reads.`);
}

/** The whole history of one service, in one page, checked by reading the next page (which must be empty). */
export async function fetchMeasurements(
  client: LegacyClient,
  service: string,
): Promise<z.infer<typeof legacyMeasurement>[]> {
  const query = { service, start: MEASUREMENTS_START, stop: MEASUREMENTS_STOP };
  const schema = envelope(legacyMeasurement);
  const first = checked(
    `GET /api/v1/measurements`,
    schema,
    await client.get('/api/v1/measurements', {
      ...query,
      page: 0,
      pageSize: MEASUREMENTS_PAGE_SIZE,
    }),
  );
  if (first.metadata.totalCount >= MEASUREMENTS_PAGE_SIZE) {
    throw new LegacyApiError(
      `The history of a service has ${first.metadata.totalCount} time points, more than one page of ${MEASUREMENTS_PAGE_SIZE}.`,
    );
  }
  const second = checked(
    `GET /api/v1/measurements`,
    schema,
    await client.get('/api/v1/measurements', {
      ...query,
      page: 1,
      pageSize: MEASUREMENTS_PAGE_SIZE,
    }),
  );
  if (second.result.length > 0) {
    throw new LegacyApiError(
      `The measurements of a service did not fit one page: the second read returned ${second.result.length} more points.`,
    );
  }
  return first.result;
}

export async function fetchSnapshot(options: {
  client: LegacyClient;
  out: string;
  now?: () => Date;
  progress?: (line: string) => void;
}): Promise<{ manifest: Manifest; counts: FetchCounts }> {
  const { client, out } = options;
  const progress = options.progress ?? (() => {});
  await emptyPrivateDirectory(out, 'The snapshot directory');
  const files: Manifest['files'] = {};
  async function write(path: string, data: unknown) {
    const content = `${JSON.stringify(data, null, 2)}\n`;
    await writePrivateFile(join(out, path), content);
    files[path] = { sha256: sha256(content), bytes: Buffer.byteLength(content) };
  }

  // First the administrator's route: a wrong key fails here (401), a key of an account that is not an administrator
  // gets an empty list (the route answers [] then), before anything else is read.
  const users = checked('GET /aai/users', z.array(legacyUser), await client.get('/aai/users'));
  if (users.length === 0) {
    throw new LegacyApiError(
      'GET /aai/users returned no user: LEGACY_API_KEY belongs to an account that is not an administrator.',
    );
  }
  const membershipRequests = checked(
    'GET /aai/requests/membership',
    z.array(legacyMembershipRequest),
    await client.get('/aai/requests/membership'),
  );
  const providers = await allPages(client, '/api/v1/providers', legacyProvider);
  const categories = await allPages(client, '/api/v1/categories', legacyCategory);
  const services = await allPages(client, '/api/v1/services', legacyService);
  progress(
    `Read ${providers.length} providers, ${categories.length} categories, ${services.length} service rows.`,
  );

  const indicatorsByCategory: Record<string, unknown[]> = {};
  for (const category of new Set(categories.map((c) => c.name))) {
    indicatorsByCategory[category] = await allPages(client, '/api/v1/indicators', legacyIndicator, {
      category,
    });
  }
  const serviceNames = [...new Set(services.map((s) => s.abbreviation))];
  const indicatorsByService: Record<string, unknown[]> = {};
  for (const service of serviceNames) {
    indicatorsByService[service] = await allPages(client, '/api/v1/indicators', legacyIndicator, {
      service,
    });
  }

  let measurementPoints = 0;
  for (const [index, service] of serviceNames.entries()) {
    const points = await fetchMeasurements(client, service);
    measurementPoints += points.length;
    await write(measurementFile(service), points);
    if ((index + 1) % 10 === 0 || index + 1 === serviceNames.length) {
      progress(`Measurements of ${index + 1} of ${serviceNames.length} services.`);
    }
  }

  await write(FILES.providers, providers);
  await write(FILES.categories, categories);
  await write(FILES.services, services);
  await write(FILES.indicatorsByCategory, indicatorsByCategory);
  await write(FILES.indicatorsByService, indicatorsByService);
  await write(FILES.users, users);
  await write(FILES.membershipRequests, membershipRequests);

  // The manifest goes last: a fetch that stopped halfway leaves a directory without one, which no command reads.
  const manifest: Manifest = {
    format: SNAPSHOT_FORMAT,
    source: client.baseUrl,
    fetchedAt: (options.now?.() ?? new Date()).toISOString(),
    files: Object.fromEntries(
      Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  };
  await writePrivateFile(join(out, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    manifest,
    counts: {
      providers: providers.length,
      categories: categories.length,
      serviceRows: services.length,
      services: serviceNames.length,
      indicatorAnswers:
        Object.keys(indicatorsByCategory).length + Object.keys(indicatorsByService).length,
      users: users.length,
      membershipRequests: membershipRequests.length,
      measurementPoints,
    },
  };
}
