// The snapshot: one directory of JSON files that `fetch` writes and every other command reads. The manifest names each
// file with its SHA-256, so a file changed or added after the fetch is refused, and the report can repeat what it read.
//
//   manifest.json                  { format, source, fetchedAt, files: { <path>: { sha256, bytes } } }
//   providers.json                 GET /api/v1/providers, every page
//   categories.json                GET /api/v1/categories
//   services.json                  GET /api/v1/services (one row per service and provider)
//   indicators-by-category.json    { <category>: GET /api/v1/indicators?category= }
//   indicators-by-service.json     { <service>:  GET /api/v1/indicators?service= }
//   users.json                     GET /aai/users                (personal data)
//   membership-requests.json       GET /aai/requests/membership  (personal data)
//   measurements/<service>.json    GET /api/v1/measurements?service= as [{ kpi, date, value }], the shape of the S3 backups
//
// `<service>` in a file name is the abbreviation with `encodeURIComponent`, so `/` and other characters are safe.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { parseLegacyDate, type LegacyDate } from './dates.ts';
import { sha256 } from './files.ts';
import {
  legacyCategory,
  legacyIndicator,
  legacyMeasurement,
  legacyMembershipRequest,
  legacyProvider,
  legacyService,
  legacyUser,
  type LegacyCategory,
  type LegacyIndicator,
  type LegacyMembershipRequest,
  type LegacyProvider,
  type LegacyService,
  type LegacyUser,
} from './legacy.ts';

export const SNAPSHOT_FORMAT = 'scorpion-legacy-snapshot/1';
export const MANIFEST = 'manifest.json';
export const FILES = {
  providers: 'providers.json',
  categories: 'categories.json',
  services: 'services.json',
  indicatorsByCategory: 'indicators-by-category.json',
  indicatorsByService: 'indicators-by-service.json',
  users: 'users.json',
  membershipRequests: 'membership-requests.json',
} as const;
export const MEASUREMENTS_DIR = 'measurements';

export const measurementFile = (service: string) =>
  `${MEASUREMENTS_DIR}/${encodeURIComponent(service)}.json`;

export const manifestSchema = z.strictObject({
  format: z.literal(SNAPSHOT_FORMAT),
  /** The legacy base URL, without credentials, query or fragment. */
  source: z.string().max(2000),
  fetchedAt: z.iso.datetime(),
  files: z.record(
    z.string().max(600),
    z.strictObject({ sha256: z.string().regex(/^[0-9a-f]{64}$/), bytes: z.number().int().min(0) }),
  ),
});
export type Manifest = z.infer<typeof manifestSchema>;

/** A point of a measurement file, with its date parsed (`parsed` is missing for a date that does not parse). */
export interface MeasurementPoint {
  kpi: string;
  value: number;
  date: string;
  parsed: LegacyDate | undefined;
}

export interface Snapshot {
  manifest: Manifest;
  providers: LegacyProvider[];
  categories: LegacyCategory[];
  services: LegacyService[];
  indicatorsByCategory: Record<string, LegacyIndicator[]>;
  indicatorsByService: Record<string, LegacyIndicator[]>;
  users: LegacyUser[];
  membershipRequests: LegacyMembershipRequest[];
  /** By service abbreviation, in the order of the file (the API's order: InfluxDB table by table). */
  measurements: Map<string, MeasurementPoint[]>;
  /** The S3 backups, when `--measurements` gave them; same shape. */
  backups?: Map<string, MeasurementPoint[]>;
}

export class SnapshotError extends Error {}

const measurementList = z.array(legacyMeasurement).max(5_000_000);

function problem(file: string, error: z.ZodError): SnapshotError {
  const first = error.issues[0];
  const at = first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'invalid';
  return new SnapshotError(`${file} does not have the expected shape (${at}).`);
}

function parseJson<T>(file: string, content: string, schema: z.ZodType<T>): T {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new SnapshotError(`${file} is not JSON.`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw problem(file, result.error);
  return result.data;
}

/** The points of one measurement file, dates parsed. */
export function readMeasurementFile(file: string, content: string): MeasurementPoint[] {
  return parseJson(file, content, measurementList).map((point) => ({
    kpi: point.kpi,
    value: point.value,
    date: point.date,
    parsed: parseLegacyDate(point.date),
  }));
}

/** The service a measurement file is for: the file name without `.json`, decoded. */
export function serviceOfFile(name: string): string | undefined {
  if (!name.endsWith('.json')) return undefined;
  try {
    return decodeURIComponent(name.slice(0, -'.json'.length));
  } catch {
    return undefined;
  }
}

/** Every file below `dir`, as `a/b.json` paths. */
async function listFiles(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(dir, prefix), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await listFiles(dir, path)));
    else found.push(path);
  }
  return found;
}

/**
 * Reads the manifest and checks every file against it: a file that is missing, changed (another SHA-256) or not listed
 * is refused. Returns the manifest and the contents by path.
 */
export async function verifySnapshot(
  dir: string,
): Promise<{ manifest: Manifest; contents: Map<string, string> }> {
  const manifestText = await readFile(join(dir, MANIFEST), 'utf8').catch(() => {
    throw new SnapshotError(`${dir} has no ${MANIFEST}; it is not a snapshot written by fetch.`);
  });
  const manifest = parseJson(MANIFEST, manifestText, manifestSchema);
  const present = (await listFiles(dir)).filter((path) => path !== MANIFEST);
  const unlisted = present.filter((path) => !(path in manifest.files));
  if (unlisted.length > 0) {
    throw new SnapshotError(
      `The snapshot holds files its manifest does not list: ${unlisted.slice(0, 5).join(', ')}.`,
    );
  }
  const contents = new Map<string, string>();
  for (const [path, expected] of Object.entries(manifest.files)) {
    if (path.includes('..') || path.startsWith('/')) {
      throw new SnapshotError(`The manifest names a path outside the snapshot: ${path}.`);
    }
    const buffer = await readFile(join(dir, path)).catch(() => {
      throw new SnapshotError(`${path} is listed in the manifest but missing.`);
    });
    if (sha256(buffer) !== expected.sha256) {
      throw new SnapshotError(
        `${path} was changed after the fetch (its SHA-256 differs from the manifest). Fetch a new snapshot.`,
      );
    }
    contents.set(path, buffer.toString('utf8'));
  }
  for (const required of Object.values(FILES)) {
    if (!contents.has(required)) throw new SnapshotError(`The snapshot has no ${required}.`);
  }
  return { manifest, contents };
}

/** The S3 backups: every `<service>.json` in `dir`, one array of `{ kpi, date, value }` each. */
export async function readBackups(dir: string): Promise<Map<string, MeasurementPoint[]>> {
  const backups = new Map<string, MeasurementPoint[]>();
  const names = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    const service = serviceOfFile(name);
    if (service === undefined) throw new SnapshotError(`${name}: the file name is not a service.`);
    backups.set(service, readMeasurementFile(name, await readFile(join(dir, name), 'utf8')));
  }
  return backups;
}

/** Reads and checks a snapshot (and the S3 backups, when given) into plain records. No network. */
export async function readSnapshot(
  dir: string,
  options: { measurements?: string } = {},
): Promise<Snapshot> {
  const { manifest, contents } = await verifySnapshot(dir);
  const read = <T>(file: string, schema: z.ZodType<T>) =>
    parseJson(file, contents.get(file)!, schema);
  const measurements = new Map<string, MeasurementPoint[]>();
  for (const [path, content] of [...contents].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!path.startsWith(`${MEASUREMENTS_DIR}/`)) continue;
    const service = serviceOfFile(path.slice(MEASUREMENTS_DIR.length + 1));
    if (service === undefined) throw new SnapshotError(`${path}: the file name is not a service.`);
    measurements.set(service, readMeasurementFile(path, content));
  }
  const byName = z.record(z.string().max(2000), z.array(legacyIndicator).max(100_000));
  return {
    manifest,
    providers: read(FILES.providers, z.array(legacyProvider).max(100_000)),
    categories: read(FILES.categories, z.array(legacyCategory).max(100_000)),
    services: read(FILES.services, z.array(legacyService).max(100_000)),
    indicatorsByCategory: read(FILES.indicatorsByCategory, byName),
    indicatorsByService: read(FILES.indicatorsByService, byName),
    users: read(FILES.users, z.array(legacyUser).max(100_000)),
    membershipRequests: read(
      FILES.membershipRequests,
      z.array(legacyMembershipRequest).max(100_000),
    ),
    measurements,
    ...(options.measurements ? { backups: await readBackups(options.measurements) } : {}),
  };
}
