// Helpers of the impact tests: unique names (specs share a database), the error a promise rejects with, a consortium with services and a KPI world.
import { DomainError } from '@scorpion/contracts';
import {
  makeIndicator,
  makeKpiSet,
  makeMeasurement,
  makeService,
  makeServiceKpis,
  type Queryable,
} from '@scorpion/testing';

let counter = 0;
export const uniq = (prefix: string) =>
  `${prefix}-${++counter}-${Math.random().toString(36).slice(2, 7)}`;

/** The error a promise rejects with; the test fails when it resolved. */
export async function rejection(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

/** The `in:path` of every problem of a 422, sorted. */
export const paths = (error: DomainError) =>
  (error.errors ?? []).map((e) => `${e.in}:${e.path}`).sort();

// ----- a KPI world: a consortium, services with a KPI set and a headline, and measurements -----------------

/** An indicator in a set of its own with an evaluation (or none), as the framework stores them. */
export async function headlineSet(
  pool: Queryable,
  {
    valueType = 'integer',
    aggregate = 'sum' as string | null,
    unit = 'count' as string | null,
  } = {},
) {
  const head = await makeIndicator(pool, { name: uniq('Head'), valueType, unit });
  const set = await makeKpiSet(pool, {
    name: uniq('set'),
    indicators: [{ indicatorId: head.id, necessity: 'mandatory' }],
    ...(aggregate === null ? {} : { evaluation: { indicatorId: head.id, aggregate } }),
  });
  return { head, set };
}

/** A service of the consortium with the given set (none when `set` is absent) and a value per month end: `{ '2025-12-31': 4 }`. */
export async function serviceWith(
  pool: Queryable,
  consortiumId: string,
  {
    name = uniq('Svc'),
    set,
    headId,
    values = {},
    published = true,
    alsoIn = [],
  }: {
    name?: string;
    set?: { id: string };
    headId?: string;
    values?: Record<string, number | string>;
    published?: boolean;
    /** More consortia the service is linked to. */
    alsoIn?: readonly string[];
  } = {},
) {
  const service = await makeService(pool, {
    name,
    public: published,
    consortia: [consortiumId, ...alsoIn],
  });
  if (set) await makeServiceKpis(pool, { serviceId: service.id, setId: set.id });
  for (const [period, value] of Object.entries(values))
    await makeMeasurement(pool, {
      serviceId: service.id,
      indicatorId: headId!,
      period,
      ...(typeof value === 'string' ? { valueText: value } : { valueNumeric: value }),
    });
  return service;
}
