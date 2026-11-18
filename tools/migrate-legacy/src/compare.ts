// `migrate-legacy compare` (M13 plan §8, sprint 3): every value the migration should have written, read back through
// kpi.ingestion and checked against the snapshot, per service, KPI and month; and the other records at the level the target
// answers cheaply. It writes nothing to the database: it uses trusted reads only, so it needs no account (the migration
// account is deactivated at the end of a run).
//
// The expected state is the run's own: `buildPlans` (the same transform, `transformMeasurements` included), never a copy.
// Every difference has a class:
//   - expected: a rule of the transform explains it (a point dropped by a rule, merged in a month, a 0 written for a missing
//     month, a service or KPI not migrated or dropped by the mapping);
//   - unexplained: something a run writes is not in the target as the run writes it (a value missing or different with the
//     source `legacy-migration`, a value of that source the snapshot does not explain, a record missing). Exit code 1;
//   - reported: a difference a person may have made after the run (a value of another source, a record changed where the run
//     keeps what exists). Listed, never a failure.
import type { UserActor } from '@scorpion/contracts';
import type { IdentityService } from '@scorpion/core-identity/public';
import type { KpiFrameworkPublic } from '@scorpion/kpi-framework/public';
import {
  MAX_SERIES_MONTHS,
  MAX_STORED_VALUES,
  MIN_YEAR,
  type KpiIngestionPublic,
  type StoredValue,
} from '@scorpion/kpi-ingestion/public';
import type { OrganisationsPublic } from '@scorpion/registry-organisations/public';
import { PROVIDER_ROLE, type ServicesPublic } from '@scorpion/registry-services/public';
import { join } from 'node:path';
import type { Plans } from './commands.ts';
import { emptyPrivateDirectory, refuseInsideRepository, writePrivateFile } from './files.ts';
import { MEASUREMENT_SOURCE } from './load-measurements.ts';
import { isMigratedAccount } from './load-people.ts';
import { CONSORTIUM_ROLE } from './load.ts';
import type { ServiceMeasurements } from './measurements.ts';
import type { Report } from './report.ts';
import { actorOf, TargetError } from './target.ts';
import type { Kind } from './transform.ts';

export const COMPARE_FORMAT = 'scorpion-legacy-compare/1';

/** Why a value differs from the snapshot, by class. */
export const EXPECTED_REASONS = [
  'filled-zero',
  'dropped-by-rule',
  'merged-in-month',
  'service-not-migrated',
  'indicator-not-migrated',
] as const;
export const UNEXPLAINED_REASONS = ['missing', 'different-value', 'extra'] as const;
export const REPORTED_REASONS = ['changed-after-run', 'entered-after-run'] as const;
export type ExpectedReason = (typeof EXPECTED_REASONS)[number];
export type UnexplainedReason = (typeof UNEXPLAINED_REASONS)[number];
export type ReportedReason = (typeof REPORTED_REASONS)[number];
type Reason = ExpectedReason | UnexplainedReason | ReportedReason;

/** One difference of a value. Expected ones are listed per rule and KPI (`count`), the others one per month. */
export interface ValueDifference {
  class: 'expected' | 'unexplained' | 'reported';
  reason: Reason;
  /** The legacy KPI name, or the target's indicator name for a value the snapshot does not know. */
  kpi: string;
  /** `YYYY-MM`. */
  period?: string;
  /** For an expected difference: how many points or values. */
  count?: number;
  /** The transform's rule, for `dropped-by-rule`. */
  rule?: string;
  expected?: number;
  found?: string;
  source?: string;
}

export type ValueCounts = { points: number; expected: number; matched: number } & Record<
  Reason,
  number
>;

export interface ServiceComparison {
  /** The legacy service abbreviation. */
  legacy: string;
  slug: string | null;
  /** `not-migrated`: the transform left it out; `missing`: the run should have created it and the target has no such service. */
  state: 'compared' | 'not-migrated' | 'missing';
  counts: ValueCounts;
  differences: ValueDifference[];
  /** Set when more unexplained or reported differences exist than are listed. */
  unlisted?: number;
}

export interface RecordDifference {
  class: 'unexplained' | 'reported';
  /** The legacy key of the record. */
  legacy: string;
  reason: string;
  detail: string;
}

export interface RecordComparison {
  kind: Exclude<Kind, 'measurement'>;
  /** Records the plan migrates. */
  expected: number;
  /** Of those, found in the target. */
  found: number;
  /** Records the target cannot be asked about cheaply (see the README). */
  unchecked: number;
  differences: RecordDifference[];
}

export interface CompareReport {
  format: typeof COMPARE_FORMAT;
  startedAt: string;
  finishedAt: string;
  snapshot: Report['snapshot'];
  mapping: Report['mapping'];
  target: { database: string };
  /** `clean` when nothing is unexplained. */
  result: 'clean' | 'unexplained';
  unexplained: number;
  reported: number;
  claims: { open: number; claimed: number; expired: number };
  measurements: { totals: ValueCounts; services: ServiceComparison[] };
  records: RecordComparison[];
}

/** The most unexplained and reported differences listed per service; the rest are counted. */
export const LISTED_DIFFERENCES = 200;

const emptyCounts = (): ValueCounts =>
  Object.fromEntries(
    [
      'points',
      'expected',
      'matched',
      ...EXPECTED_REASONS,
      ...UNEXPLAINED_REASONS,
      ...REPORTED_REASONS,
    ].map((key) => [key, 0]),
  ) as ValueCounts;

const lower = (value: string) => value.toLowerCase();
const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A stored value with its indicator's name in the target (`undefined` when the indicator has gone). */
export type NamedValue = StoredValue & { name: string | undefined };

const sameValue = (found: StoredValue, expected: number) =>
  found.valueNumber === null ? found.value === String(expected) : found.valueNumber === expected;

/**
 * One service's values: the plan of the transform against what the target stores. Pure. `names` maps a legacy KPI name to
 * the name of its indicator in the target (the plan's), `unavailable` holds the KPIs the plan does not migrate.
 */
export function compareService(input: {
  plan: ServiceMeasurements;
  slug: string | null;
  /** Whether the target has the service (ignored when `slug` is null). */
  found: boolean;
  names: ReadonlyMap<string, string>;
  unavailable: ReadonlySet<string>;
  stored: readonly NamedValue[];
}): ServiceComparison {
  const { plan, slug } = input;
  const counts = emptyCounts();
  counts.points = plan.points.read;
  const differences: ValueDifference[] = [];
  const listed: ValueDifference[] = [];
  let unlisted = 0;
  const list = (difference: ValueDifference) => {
    counts[difference.reason] += 1;
    if (listed.length < LISTED_DIFFERENCES) listed.push(difference);
    else unlisted += 1;
  };

  if (slug === null) {
    counts['service-not-migrated'] = plan.points.read;
    differences.push({
      class: 'expected',
      reason: 'service-not-migrated',
      kpi: '*',
      count: plan.points.read,
    });
    return { legacy: plan.service, slug, state: 'not-migrated', counts, differences };
  }

  // The points the transform left out, and the zeros it wrote: expected.
  for (const { rule, kpi, points } of plan.dropped) {
    counts['dropped-by-rule'] += points;
    differences.push({ class: 'expected', reason: 'dropped-by-rule', kpi, rule, count: points });
  }
  for (const { kpi, period, points } of plan.merged) {
    counts['merged-in-month'] += points;
    differences.push({ class: 'expected', reason: 'merged-in-month', kpi, period, count: points });
  }

  // The values the run writes, by target indicator name (without case) and month.
  const expected = new Map<
    string,
    { kpi: string; period: string; value: number; filled: boolean }
  >();
  const lost = new Map<string, number>();
  for (const row of plan.batches.flat()) {
    if (input.unavailable.has(row.kpi)) {
      lost.set(row.kpi, (lost.get(row.kpi) ?? 0) + 1);
      continue;
    }
    const name = input.names.get(row.kpi) ?? row.kpi;
    expected.set(`${lower(name)}|${row.period}`, {
      kpi: row.kpi,
      period: row.period,
      value: row.value,
      filled: row.filled === true,
    });
  }
  for (const [kpi, n] of [...lost].sort(([a], [b]) => byCode(a, b))) {
    counts['indicator-not-migrated'] += n;
    differences.push({ class: 'expected', reason: 'indicator-not-migrated', kpi, count: n });
  }
  counts.expected = expected.size;

  const state = input.found ? 'compared' : 'missing';
  const seen = new Set<string>();
  // A filled 0 found as written is an expected difference from the snapshot, per KPI.
  const filled = new Map<string, number>();
  for (const value of input.stored) {
    const period = value.period.slice(0, 7);
    const name = value.name ?? value.indicatorId;
    const key = `${lower(name)}|${period}`;
    const want = expected.get(key);
    const ours = value.source === MEASUREMENT_SOURCE;
    if (!want) {
      list({
        class: ours ? 'unexplained' : 'reported',
        reason: ours ? 'extra' : 'entered-after-run',
        kpi: name,
        period,
        found: value.value,
        source: value.source,
      });
      continue;
    }
    seen.add(key);
    if (sameValue(value, want.value)) {
      if (want.filled) filled.set(want.kpi, (filled.get(want.kpi) ?? 0) + 1);
      else counts.matched += 1;
      continue;
    }
    list({
      class: ours ? 'unexplained' : 'reported',
      reason: ours ? 'different-value' : 'changed-after-run',
      kpi: want.kpi,
      period,
      expected: want.value,
      found: value.value,
      source: value.source,
    });
  }
  for (const [key, want] of expected) {
    if (seen.has(key)) continue;
    list({
      class: 'unexplained',
      reason: 'missing',
      kpi: want.kpi,
      period: want.period,
      expected: want.value,
    });
  }
  for (const [kpi, count] of [...filled].sort(([a], [b]) => byCode(a, b))) {
    counts['filled-zero'] += count;
    differences.push({ class: 'expected', reason: 'filled-zero', kpi, count });
  }
  listed.sort(
    (a, b) =>
      byCode(a.class, b.class) || byCode(a.kpi, b.kpi) || byCode(a.period ?? '', b.period ?? ''),
  );
  return {
    legacy: plan.service,
    slug,
    state,
    counts,
    differences: [...differences, ...listed],
    ...(unlisted > 0 ? { unlisted } : {}),
  };
}

/** The windows of at most `MAX_SERIES_MONTHS` months from January 1900 to the month of `now`. */
export function windows(now: Date): [string, string][] {
  const month = (index: number) =>
    `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
  const last = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const out: [string, string][] = [];
  for (let from = MIN_YEAR * 12; from <= last; from += MAX_SERIES_MONTHS) {
    out.push([month(from), month(Math.min(from + MAX_SERIES_MONTHS - 1, last))]);
  }
  return out;
}

export interface ComparePorts {
  organisations: Pick<OrganisationsPublic, 'findByAbbreviationAsSystem' | 'listOwn'>;
  services: Pick<ServicesPublic, 'findBySlugAsSystem'>;
  kpi: Pick<
    KpiFrameworkPublic,
    'effectiveIndicatorsAsSystem' | 'evaluationOfServiceAsSystem' | 'indicatorsByIdAsSystem'
  >;
  ingestion: { reads: Pick<KpiIngestionPublic['reads'], 'storedValuesAsSystem'> };
  identity: { users: Pick<IdentityService['users'], 'findByEmail' | 'claimOfAsSystem'> };
}

const PAGE = 100;

/** Compares the target with the plans. Reads only. */
export async function compareTarget(
  plans: Pick<Plans, 'registry' | 'kpis' | 'people' | 'measurements'>,
  ports: ComparePorts,
  now: Date,
): Promise<
  Pick<CompareReport, 'measurements' | 'records' | 'claims' | 'unexplained' | 'reported'>
> {
  const { registry, kpis, people, measurements } = plans;
  const records: RecordComparison[] = [];
  const kind = (k: RecordComparison['kind']): RecordComparison => {
    const record: RecordComparison = {
      kind: k,
      expected: 0,
      found: 0,
      unchecked: 0,
      differences: [],
    };
    records.push(record);
    return record;
  };
  const differ = (
    record: RecordComparison,
    cls: RecordDifference['class'],
    legacy: string,
    reason: string,
    detail: string,
  ) => record.differences.push({ class: cls, legacy, reason, detail });

  // Organisations by type and abbreviation.
  const orgIds = { provider: new Map<string, string>(), consortium: new Map<string, string>() };
  for (const type of ['provider', 'consortium'] as const) {
    const record = kind(type);
    for (const op of type === 'provider' ? registry.providers : registry.consortia) {
      record.expected += 1;
      const found = await ports.organisations.findByAbbreviationAsSystem(type, op.abbreviation);
      if (!found) {
        differ(record, 'unexplained', op.legacy, 'missing', `no ${type} ${op.abbreviation}`);
        continue;
      }
      record.found += 1;
      orgIds[type].set(lower(op.abbreviation), found.id);
    }
  }

  // Services by slug, with their provider and consortia.
  const serviceIds = new Map<string, string>();
  const services = kind('service');
  for (const op of registry.services) {
    services.expected += 1;
    const found = await ports.services.findBySlugAsSystem(op.slug);
    if (!found) {
      differ(services, 'unexplained', op.legacy, 'missing', `no service ${op.slug}`);
      continue;
    }
    services.found += 1;
    serviceIds.set(op.legacy, found.id);
    if (found.redirectedFrom !== undefined)
      differ(services, 'reported', op.legacy, 'slug-changed', `answers as ${found.slug}`);
    const provider = found.organisations.find((o) => o.role === PROVIDER_ROLE)?.id;
    const wantProvider = orgIds.provider.get(lower(op.provider));
    if (wantProvider !== undefined && provider !== wantProvider)
      differ(
        services,
        'reported',
        op.legacy,
        'provider-differs',
        `the provider is not ${op.provider}`,
      );
    const consortia = new Set(
      found.organisations.filter((o) => o.role === CONSORTIUM_ROLE).map((o) => o.id),
    );
    const wantConsortia = op.consortia
      .map((a) => orgIds.consortium.get(lower(a)))
      .filter((id): id is string => id !== undefined);
    const missingConsortia = wantConsortia.filter((id) => !consortia.has(id)).length;
    const otherConsortia = [...consortia].filter((id) => !wantConsortia.includes(id)).length;
    if (missingConsortia > 0)
      differ(
        services,
        'unexplained',
        op.legacy,
        'consortium-missing',
        `${missingConsortia} consortium link(s) missing`,
      );
    if (otherConsortia > 0)
      differ(
        services,
        'reported',
        op.legacy,
        'consortium-added',
        `${otherConsortia} other consortium link(s)`,
      );
  }

  // The effective KPIs of each migrated service: the only trusted read of set rows, necessities and extras.
  const effective = new Map<
    string,
    Awaited<ReturnType<ComparePorts['kpi']['effectiveIndicatorsAsSystem']>>
  >();
  const setOf = new Map<string, string | null>();
  for (const [legacy, id] of serviceIds) {
    effective.set(legacy, await ports.kpi.effectiveIndicatorsAsSystem(id));
    setOf.set(legacy, (await ports.kpi.evaluationOfServiceAsSystem(id))?.setId ?? null);
  }
  const indicatorName = new Map(kpis.indicators.map((op) => [op.legacy, op.name] as const));
  const nameOf = (legacy: string) => indicatorName.get(legacy) ?? legacy;

  // Values per service: the stored values with their indicator's name.
  const names = new Set<string>();
  for (const rows of effective.values()) for (const row of rows) names.add(lower(row.name));
  const totals = emptyCounts();
  const comparisons: ServiceComparison[] = [];
  const migrated = new Map(registry.services.map((op) => [op.legacy, op.slug] as const));
  const ranges = windows(now);
  for (const plan of measurements.services) {
    const slug = migrated.get(plan.service) ?? null;
    const id = serviceIds.get(plan.service);
    const stored: StoredValue[] = [];
    if (id !== undefined) {
      for (const [from, to] of ranges) {
        const got = await ports.ingestion.reads.storedValuesAsSystem(id, from, to);
        if (got.length >= MAX_STORED_VALUES)
          throw new TargetError(
            `The service ${slug} has more values in ${from}…${to} than one read returns.`,
          );
        stored.push(...got);
      }
    }
    const details = await ports.kpi.indicatorsByIdAsSystem([
      ...new Set(stored.map((v) => v.indicatorId)),
    ]);
    const byId = new Map(details.map((row) => [row.id, row.name] as const));
    for (const row of details) names.add(lower(row.name));
    const comparison = compareService({
      plan,
      slug,
      found: id !== undefined,
      names: indicatorName,
      unavailable: kpis.unavailable,
      stored: stored.map((value) => ({ ...value, name: byId.get(value.indicatorId) })),
    });
    comparisons.push(comparison);
    for (const key of Object.keys(totals) as (keyof ValueCounts)[])
      totals[key] += comparison.counts[key];
  }

  // Indicators: there is no trusted read by slug, so an indicator is checked by its name among the services' KPIs and values.
  const indicators = kind('indicator');
  for (const op of kpis.indicators) {
    indicators.expected += 1;
    if (names.has(lower(op.name))) indicators.found += 1;
    else indicators.unchecked += 1;
  }

  // KPI sets: through the services planned with them; the rows and necessities from the effective set of one of them.
  const sets = kind('kpi-set');
  const planSetIds = new Map<string, Set<string>>();
  for (const op of kpis.serviceKpis) {
    if (op.set === null) continue;
    const setId = setOf.get(op.legacy);
    if (setId === undefined || setId === null) continue;
    planSetIds.set(op.set, (planSetIds.get(op.set) ?? new Set()).add(setId));
  }
  for (const op of kpis.sets) {
    sets.expected += 1;
    const ids = planSetIds.get(op.legacy);
    if (!ids) {
      sets.unchecked += 1;
      continue;
    }
    sets.found += 1;
    if (ids.size > 1)
      differ(
        sets,
        'reported',
        op.legacy,
        'services-differ',
        `its services have ${ids.size} different sets`,
      );
    const holder = kpis.serviceKpis.find((s) => s.set === op.legacy && setOf.get(s.legacy) != null);
    const rows = (effective.get(holder!.legacy) ?? []).filter((row) => row.source === 'set');
    const necessity = new Map(rows.map((row) => [lower(row.name), row.necessity] as const));
    for (const row of op.rows) {
      const name = nameOf(row.indicator);
      const found = necessity.get(lower(name));
      if (found === undefined)
        differ(sets, 'unexplained', op.legacy, 'row-missing', `no row ${name}`);
      else if (found !== row.necessity)
        differ(
          sets,
          'reported',
          op.legacy,
          'necessity-differs',
          `${name} is ${found}, not ${row.necessity}`,
        );
      necessity.delete(lower(name));
    }
    if (necessity.size > 0)
      differ(sets, 'reported', op.legacy, 'row-added', `${necessity.size} other row(s)`);
  }

  // Each service's set and extras.
  const serviceKpis = kind('service-kpis');
  for (const op of kpis.serviceKpis) {
    serviceKpis.expected += 1;
    const rows = effective.get(op.legacy);
    if (rows === undefined) {
      differ(
        serviceKpis,
        'unexplained',
        op.legacy,
        'service-missing',
        'the service is not in the target',
      );
      continue;
    }
    serviceKpis.found += 1;
    const setId = setOf.get(op.legacy) ?? null;
    if (op.set !== null && setId === null)
      differ(serviceKpis, 'unexplained', op.legacy, 'set-missing', `no KPI set (want ${op.set})`);
    else if (op.set === null && setId !== null)
      differ(serviceKpis, 'reported', op.legacy, 'set-added', 'has a KPI set');
    else if (op.set !== null && (planSetIds.get(op.set)?.size ?? 0) > 1)
      differ(
        serviceKpis,
        'reported',
        op.legacy,
        'set-differs',
        `its set is not the one of the other services of ${op.set}`,
      );
    const present = new Set(rows.map((row) => lower(row.name)));
    const extras = new Set(
      rows.filter((row) => row.source === 'extra').map((row) => lower(row.name)),
    );
    const missing = op.extras.filter((legacy) => !present.has(lower(nameOf(legacy))));
    for (const legacy of op.extras) extras.delete(lower(nameOf(legacy)));
    if (missing.length > 0)
      differ(
        serviceKpis,
        'unexplained',
        op.legacy,
        'extra-missing',
        `missing: ${missing.map(nameOf).join(', ')}`,
      );
    if (extras.size > 0)
      differ(
        serviceKpis,
        'reported',
        op.legacy,
        'extra-added',
        `${extras.size} other extra KPI(s)`,
      );
  }

  // Users by address, with the state of their claim.
  const users = kind('user');
  const claims = { open: 0, claimed: 0, expired: 0 };
  const accounts = new Map<string, UserActor>();
  for (const op of people.users) {
    users.expected += 1;
    const found = await ports.identity.users.findByEmail(op.email);
    if (!found) {
      differ(users, 'unexplained', op.legacy, 'missing', 'no account has the address');
      continue;
    }
    const claim = await ports.identity.users.claimOfAsSystem(found.id);
    if (!isMigratedAccount(found, claim, op)) {
      differ(
        users,
        'reported',
        op.legacy,
        'address-held',
        'another account holds the address (the run reports user.email-taken)',
      );
      continue;
    }
    users.found += 1;
    accounts.set(op.legacy, actorOf(found));
    if (!claim) claims.claimed += 1;
    else if (claim.expiresAt.getTime() <= now.getTime()) claims.expired += 1;
    else claims.open += 1;
  }

  // Memberships: each migrated user's own, read as that user (the run requests them so).
  const memberships = kind('membership');
  const own = new Map<string, Map<string, string>>();
  for (const op of people.memberships) {
    memberships.expected += 1;
    const actor = accounts.get(op.user);
    if (!actor) {
      memberships.unchecked += 1;
      continue;
    }
    let rows = own.get(op.user);
    if (!rows) {
      rows = new Map();
      for (let page = 0; ; page += 1) {
        const got = await ports.organisations.listOwn(actor, { page, pageSize: PAGE });
        for (const row of got.items) rows.set(lower(row.organisation.abbreviation), row.state);
        if (got.items.length === 0 || (page + 1) * PAGE >= got.total) break;
      }
      own.set(op.user, rows);
    }
    const state = rows.get(lower(op.provider));
    if (state === undefined) {
      differ(memberships, 'unexplained', op.legacy, 'missing', `no membership of ${op.provider}`);
      continue;
    }
    memberships.found += 1;
    if (state === op.state) continue;
    if (op.state === 'approved' && state === 'requested')
      differ(memberships, 'unexplained', op.legacy, 'not-decided', 'requested, not approved');
    else differ(memberships, 'reported', op.legacy, 'state-differs', `${state}, not ${op.state}`);
  }

  const count = (cls: 'unexplained' | 'reported') =>
    records.reduce((n, r) => n + r.differences.filter((d) => d.class === cls).length, 0);
  const unexplained =
    count('unexplained') + UNEXPLAINED_REASONS.reduce((n, reason) => n + totals[reason], 0);
  const reported =
    count('reported') + REPORTED_REASONS.reduce((n, reason) => n + totals[reason], 0);
  return {
    measurements: { totals, services: comparisons },
    records,
    claims,
    unexplained,
    reported,
  };
}

const code = (value: string | null) => (value === null ? '—' : `\`${value.replaceAll('`', "'")}\``);

export function compareMarkdown(report: CompareReport): string {
  const t = report.measurements.totals;
  const lines = [
    `# Compare report: ${report.result === 'clean' ? 'clean' : `${report.unexplained} unexplained difference(s)`}`,
    '',
    `- Snapshot: ${report.snapshot.source}, fetched ${report.snapshot.fetchedAt} (${report.snapshot.files} files, checked against the manifest)`,
    `- Mapping: ${report.mapping.file} (${report.mapping.open} open line(s))`,
    `- Target: ${report.target.database}`,
    `- From ${report.startedAt} to ${report.finishedAt}`,
    `- Unexplained: ${report.unexplained}; reported (a person may have made them after the run): ${report.reported}`,
    `- Claims of the migrated accounts: ${report.claims.open} open, ${report.claims.claimed} claimed, ${report.claims.expired} expired`,
    '',
    '## Records',
    '',
    '| Kind | Expected | Found | Unchecked | Unexplained | Reported |',
    '| --- | --- | --- | --- | --- | --- |',
    ...report.records.map((r) => {
      const n = (cls: string) => r.differences.filter((d) => d.class === cls).length;
      return `| ${r.kind} | ${r.expected} | ${r.found} | ${r.unchecked} | ${n('unexplained')} | ${n('reported')} |`;
    }),
    '',
    '## Measurements (values)',
    '',
    `Points read ${t.points}; values the run writes ${t.expected}; equal to a snapshot point ${t.matched}.`,
    '',
    '| Class | Reason | Count |',
    '| --- | --- | --- |',
    ...EXPECTED_REASONS.map((r) => `| expected | ${r} | ${t[r]} |`),
    ...UNEXPLAINED_REASONS.map((r) => `| unexplained | ${r} | ${t[r]} |`),
    ...REPORTED_REASONS.map((r) => `| reported | ${r} | ${t[r]} |`),
    '',
    '### Per service',
    '',
    '| Service | Slug | State | Points | Expected | Matched | Filled 0 | Dropped / merged | Unexplained | Reported |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.measurements.services.map((s) => {
      const c = s.counts;
      const unexplained = UNEXPLAINED_REASONS.reduce((n, r) => n + c[r], 0);
      const reported = REPORTED_REASONS.reduce((n, r) => n + c[r], 0);
      return `| ${code(s.legacy)} | ${code(s.slug)} | ${s.state} | ${c.points} | ${c.expected} | ${c.matched} | ${c['filled-zero']} | ${c['dropped-by-rule'] + c['merged-in-month'] + c['service-not-migrated'] + c['indicator-not-migrated']} | ${unexplained} | ${reported} |`;
    }),
  ];
  const recordDifferences = report.records.flatMap((r) =>
    r.differences.map((d) => ({ ...d, kind: r.kind })),
  );
  for (const cls of ['unexplained', 'reported'] as const) {
    const values = report.measurements.services.flatMap((s) =>
      s.differences.filter((d) => d.class === cls).map((d) => ({ ...d, service: s.legacy })),
    );
    const others = recordDifferences.filter((d) => d.class === cls);
    if (values.length === 0 && others.length === 0) continue;
    lines.push('', `## ${cls === 'unexplained' ? 'Unexplained' : 'Reported'}`, '');
    for (const d of others) lines.push(`- ${d.kind} ${code(d.legacy)}: ${d.reason}: ${d.detail}`);
    for (const d of values) {
      const what = [
        d.expected !== undefined ? `expected ${d.expected}` : '',
        d.found !== undefined ? `found ${d.found}` : '',
        d.source ? `source ${d.source}` : '',
      ]
        .filter(Boolean)
        .join(', ');
      lines.push(
        `- measurement ${code(d.service)} ${code(d.kpi)} ${d.period ?? ''}: ${d.reason}${what ? ` (${what})` : ''}`,
      );
    }
  }
  const unlisted = report.measurements.services.filter((s) => s.unlisted);
  if (unlisted.length > 0) {
    lines.push(
      '',
      ...unlisted.map((s) => `- ${code(s.legacy)}: ${s.unlisted} more difference(s) not listed`),
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Writes `report.json` and `report.md` (mode 0600) into a new or empty directory outside the repository. */
export async function writeCompareReport(dir: string, report: CompareReport): Promise<string> {
  const target = refuseInsideRepository(dir, 'The report directory');
  await emptyPrivateDirectory(target, 'The report directory');
  await writePrivateFile(join(target, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writePrivateFile(join(target, 'report.md'), compareMarkdown(report));
  return target;
}
