// Helpers of the analytics tests: a service of one provider with a KPI set of several kinds of indicator, a person who belongs to the provider,
// one who belongs to no provider, and unique names (specs share a database).
import { DomainError } from '@scorpion/contracts';
import {
  makeIndicator,
  makeKpiSet,
  makeMeasurement,
  makeMembership,
  makeOrganisation,
  makeService,
  makeServiceKpis,
} from '@scorpion/testing';
import type { AnalyticsStarted } from './harness.ts';

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

/** The last day of a month as the measurements store it. */
export const monthEndOf = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

/**
 * A service with downloads (Usage, integer), satisfaction (Satisfaction, percentage), uptime (Technical, duration) and a note (Usage, text),
 * all in its KPI set, and `dropped`, an indicator it reported once and no longer has. The clock stands at 2026-06-15.
 */
export async function analyticsWorld(s: AnalyticsStarted) {
  const provider = await makeOrganisation(s.pool, { type: 'provider' });
  const svc = await makeService(s.pool, { provider: provider.id });
  const ind = {
    downloads: await makeIndicator(s.pool, {
      name: uniq('Downloads'),
      valueType: 'integer',
      thematic: 'Usage',
      unit: 'count',
    }),
    satisfaction: await makeIndicator(s.pool, {
      name: uniq('Satisfaction'),
      valueType: 'percentage',
      thematic: 'Satisfaction',
      unit: 'percent',
    }),
    uptime: await makeIndicator(s.pool, {
      name: uniq('Uptime'),
      valueType: 'duration',
      thematic: 'Technical',
    }),
    note: await makeIndicator(s.pool, {
      name: uniq('Note'),
      valueType: 'text',
      qualitative: true,
      thematic: 'Usage',
    }),
    dropped: await makeIndicator(s.pool, {
      name: uniq('Dropped'),
      valueType: 'integer',
      thematic: 'Usage',
    }),
  };
  const set = await makeKpiSet(s.pool, {
    name: uniq('Analytics set'),
    indicators: [
      { indicatorId: ind.downloads.id, necessity: 'mandatory' },
      { indicatorId: ind.satisfaction.id, necessity: 'recommended' },
      { indicatorId: ind.uptime.id, necessity: 'optional' },
      { indicatorId: ind.note.id, necessity: 'optional' },
    ],
  });
  await makeServiceKpis(s.pool, { serviceId: svc.id, setId: set.id });
  const member = await s.actor('user');
  await makeMembership(s.pool, {
    organisationId: provider.id,
    userId: member.userId,
    state: 'approved',
  });
  const people = { member, plain: await s.actor('user'), admin: await s.actor('admin') };
  /** Stores one value of the service (the factory writes the row directly). */
  const put = (
    indicator: { id: string },
    period: string,
    value: number | string,
    serviceId = svc.id,
  ) =>
    makeMeasurement(s.pool, {
      serviceId,
      indicatorId: indicator.id,
      period,
      ...(typeof value === 'string' ? { valueText: value } : { valueNumeric: value }),
    });
  return { ...s, provider, svc, ind, set, people, put };
}
export type AnalyticsWorld = Awaited<ReturnType<typeof analyticsWorld>>;
