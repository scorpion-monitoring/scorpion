// `migrate-legacy discover`: what a snapshot holds and which of it the new rules refuse, as counts and spellings. It
// names no person: no username, no address, no name of a user appears in it (only organisation abbreviations, service
// abbreviations, consortium names, KPI names, stage and licence spellings, which are not personal). Its output goes into
// the M13 plan's §14, so it must stay that way.
import {
  checkAbbreviation,
  checkName,
  consortiumKind,
  deriveSlug,
  isValidSlug,
  providerCount,
  spdxIndex,
} from './rules.ts';
import type { MeasurementPoint, Snapshot } from './snapshot.ts';

const USERNAME = /^[a-z0-9_-]{3,31}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Discovery {
  fetchedAt: string;
  counts: Record<string, number>;
  stages: { spelling: string; services: number }[];
  licences: { spelling: string; services: number; spdx: 'id' | 'other case' | 'no' | '—' }[];
  providers: {
    invalidAbbreviations: { abbreviation: string; problem: string }[];
    trimmedAbbreviations: string[];
    duplicateAbbreviations: string[][];
    invalidNames: string[];
    duplicateNames: string[][];
  };
  services: {
    invalidSlugs: { abbreviation: string; derived: string }[];
    caseCollisions: string[][];
    twoProviders: { abbreviation: string; providers: string[] }[];
    unknownProvider: string[];
    invalidNames: string[];
    differingRows: string[];
    /** Named like their own provider: the legacy workaround that made a consortium a provider with one service. */
    namedLikeTheirProvider: string[];
  };
  consortia: {
    byAbbreviation: string[];
    byName: string[];
    /** Consortium names that are also a provider's name (the same organisation in both lists). */
    alsoProviders: string[];
  };
  measurements: {
    servicesWithPoints: number;
    points: number;
    unparsableDates: number;
    notFirstOfMonth: number;
    servicesNotFirstOfMonth: number;
    monthsWithSeveralPoints: number;
    /** Months missing between the first and the last month of a service's KPI: a 0 the API left out, or no report. */
    gapMonths: number;
    kpiHistoriesWithGaps: number;
    servicesWithSeveralSeries: { abbreviation: string; series: number }[];
    negativeValues: number;
    futureMonths: number;
    before1900: number;
    unknownKpis: string[];
    filesWithoutService: string[];
  };
  users: Record<string, number>;
  backups?: {
    services: { both: number; onlyApi: number; onlyBackup: number };
    points: {
      same: number;
      otherValue: number;
      onlyApi: number;
      onlyBackup: number;
      zeroInBackupOnly: number;
    };
  };
}

/** In code-unit order, the same on every machine (not the locale's). */
const sorted = (values: Iterable<string>) =>
  [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Groups `values` by `key`; returns the groups with more than one member. */
function collisions(values: readonly string[], key: (value: string) => string): string[][] {
  const groups = new Map<string, string[]>();
  for (const value of values) groups.set(key(value), [...(groups.get(key(value)) ?? []), value]);
  return [...groups.values()].filter((group) => group.length > 1).map((group) => sorted(group));
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

/**
 * How many InfluxDB series the API's answer shows at least: it lists table by table (ordered by measurement name, the
 * provider), each in time order, so time steps back where a table starts that is earlier than the one before. A second
 * table that is also later cannot be told apart from the first; the fetch reads every table whole either way.
 */
export function seriesIn(points: readonly MeasurementPoint[]): number {
  let series = points.length > 0 ? 1 : 0;
  let previous = -Infinity;
  for (const point of points) {
    if (!point.parsed) continue;
    if (point.parsed.time < previous) series += 1;
    previous = point.parsed.time;
  }
  return series;
}

/** How many months between the first and the last of `months` (`YYYY-MM`) are not among them. */
export function missingMonths(months: ReadonlySet<string>): number {
  if (months.size === 0) return 0;
  const index = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
  const values = [...months].map(index);
  return Math.max(...values) - Math.min(...values) + 1 - months.size;
}

const pointKey = (p: MeasurementPoint) => `${p.kpi}\u0000${p.parsed ? p.parsed.time : p.date}`;

export function discover(snapshot: Snapshot, now: Date = new Date()): Discovery {
  const services = new Map<string, Snapshot['services']>();
  for (const row of snapshot.services) {
    services.set(row.abbreviation, [...(services.get(row.abbreviation) ?? []), row]);
  }
  const first = (abbreviation: string) => services.get(abbreviation)![0]!;
  const serviceNames = sorted(services.keys());
  const providerAbbreviations = snapshot.providers.map((p) => p.abbreviation);
  const knownProviders = new Set(providerAbbreviations);

  // Providers.
  const invalidAbbreviations: Discovery['providers']['invalidAbbreviations'] = [];
  const trimmedAbbreviations: string[] = [];
  for (const abbreviation of providerAbbreviations) {
    const checked = checkAbbreviation(abbreviation);
    if (!checked.ok) invalidAbbreviations.push({ abbreviation, problem: checked.message });
    else if (checked.changed) trimmedAbbreviations.push(abbreviation);
  }

  // Services.
  const twoProviders: Discovery['services']['twoProviders'] = [];
  const unknownProvider: string[] = [];
  const differingRows: string[] = [];
  for (const abbreviation of serviceNames) {
    const rows = services.get(abbreviation)!;
    const count = providerCount(rows);
    if (!count.ok && count.rule === 'service.two-providers') {
      twoProviders.push({ abbreviation, providers: sorted(count.providers) });
    }
    if (count.ok && !knownProviders.has(count.provider)) unknownProvider.push(abbreviation);
    const shape = (row: (typeof rows)[number]) =>
      JSON.stringify([row.name, row.category, row.license, row.stage, sorted(row.consortia)]);
    if (new Set(rows.map(shape)).size > 1) differingRows.push(abbreviation);
  }

  // Stages and licences, per service (its first row).
  // No stage or licence at all, and an empty one, read the same: `(none)`.
  const orNone = (value: string | null) => (value?.trim() ? value : '(none)');
  const stages = countBy(serviceNames, (s) => orNone(first(s).stage));
  const licences = countBy(serviceNames, (s) => orNone(first(s).license));
  const spdx = spdxIndex();

  // Consortia: the names the services link to.
  const consortia = new Set(snapshot.services.flatMap((row) => row.consortia));

  // Measurements.
  const indicators = new Set(
    [
      ...Object.values(snapshot.indicatorsByCategory),
      ...Object.values(snapshot.indicatorsByService),
    ].flatMap((list) => list.map((kpi) => kpi.name)),
  );
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  let points = 0;
  let unparsableDates = 0;
  let notFirstOfMonth = 0;
  let servicesNotFirstOfMonth = 0;
  let monthsWithSeveralPoints = 0;
  let gapMonths = 0;
  let kpiHistoriesWithGaps = 0;
  let negativeValues = 0;
  let futureMonths = 0;
  let before1900 = 0;
  const unknownKpis = new Set<string>();
  const servicesWithSeveralSeries: Discovery['measurements']['servicesWithSeveralSeries'] = [];
  for (const [service, list] of snapshot.measurements) {
    points += list.length;
    let offDay = 0;
    const months = countBy(
      list.filter((p) => p.parsed),
      (p) => `${p.kpi}\u0000${p.parsed!.month}`,
    );
    monthsWithSeveralPoints += [...months.values()].filter((n) => n > 1).length;
    const monthsByKpi = new Map<string, Set<string>>();
    for (const point of list) {
      if (!point.parsed) continue;
      monthsByKpi.set(point.kpi, (monthsByKpi.get(point.kpi) ?? new Set()).add(point.parsed.month));
    }
    for (const present of monthsByKpi.values()) {
      const missing = missingMonths(present);
      gapMonths += missing;
      if (missing > 0) kpiHistoriesWithGaps += 1;
    }
    for (const point of list) {
      if (!indicators.has(point.kpi)) unknownKpis.add(point.kpi);
      if (point.value < 0) negativeValues += 1;
      if (!point.parsed) {
        unparsableDates += 1;
        continue;
      }
      if (!point.parsed.firstOfMonth) offDay += 1;
      if (point.parsed.month > thisMonth) futureMonths += 1;
      if (point.parsed.year < 1900) before1900 += 1;
    }
    notFirstOfMonth += offDay;
    if (offDay > 0) servicesNotFirstOfMonth += 1;
    const series = seriesIn(list);
    if (series > 1) servicesWithSeveralSeries.push({ abbreviation: service, series });
  }

  // Users: counts only.
  const usernames = snapshot.users.map((u) => u.user_name.toLowerCase());
  const emails = snapshot.users.map((u) => u.email.trim().toLowerCase());
  const membershipsApproved = snapshot.users.reduce((n, u) => n + u.providers.length, 0);
  const users: Record<string, number> = {
    users: snapshot.users.length,
    administrators: snapshot.users.filter((u) => u.is_admin).length,
    'usernames that break the rule (after lower-casing)': usernames.filter((u) => !USERNAME.test(u))
      .length,
    'usernames taken twice (case-insensitive)': collisions(usernames, (u) => u).reduce(
      (n, g) => n + g.length,
      0,
    ),
    'addresses that are not an address': emails.filter((e) => !EMAIL.test(e)).length,
    'addresses used twice (case-insensitive)': collisions(emails, (e) => e).reduce(
      (n, g) => n + g.length,
      0,
    ),
    'approved memberships': membershipsApproved,
    'approved memberships of an unknown provider': snapshot.users
      .flatMap((u) => u.providers)
      .filter((p) => !knownProviders.has(p)).length,
    'pending membership requests': snapshot.membershipRequests.length,
    'pending requests of an unknown provider': snapshot.membershipRequests.filter(
      (r) => !knownProviders.has(r.provider),
    ).length,
    'users with more than 10 pending requests': [
      ...countBy(snapshot.membershipRequests, (r) => r.username.toLowerCase()).values(),
    ].filter((n) => n > 10).length,
  };

  const discovery: Discovery = {
    fetchedAt: snapshot.manifest.fetchedAt,
    counts: {
      providers: snapshot.providers.length,
      categories: snapshot.categories.length,
      'service rows (one per service and provider)': snapshot.services.length,
      services: serviceNames.length,
      consortia: consortia.size,
      'KPIs (distinct names)': indicators.size,
      'KPIs per category (sum of defined)': Object.values(snapshot.indicatorsByCategory).reduce(
        (n, list) => n + list.filter((k) => k.categories.some((c) => c.necessity !== null)).length,
        0,
      ),
      'service-specific KPIs (selected, not defined by the category)': Object.values(
        snapshot.indicatorsByService,
      ).reduce(
        (n, list) =>
          n +
          list.filter((k) => k.selected && k.categories.every((c) => c.necessity === null)).length,
        0,
      ),
      'measurement files': snapshot.measurements.size,
      users: snapshot.users.length,
      'pending membership requests': snapshot.membershipRequests.length,
    },
    stages: sorted(stages.keys()).map((spelling) => ({
      spelling,
      services: stages.get(spelling)!,
    })),
    licences: sorted(licences.keys()).map((spelling) => {
      const id = spdx.get(spelling.toLowerCase());
      const kind = spelling === '(none)' ? '—' : id === spelling ? 'id' : id ? 'other case' : 'no';
      return { spelling, services: licences.get(spelling)!, spdx: kind };
    }),
    providers: {
      invalidAbbreviations,
      trimmedAbbreviations,
      duplicateAbbreviations: collisions(providerAbbreviations, (a) => a.trim().toLowerCase()),
      invalidNames: snapshot.providers
        .filter((p) => !checkName(p.name).ok)
        .map((p) => p.abbreviation),
      duplicateNames: collisions(
        snapshot.providers.map((p) => p.abbreviation),
        (a) =>
          snapshot.providers
            .find((p) => p.abbreviation === a)!
            .name.trim()
            .toLowerCase(),
      ),
    },
    services: {
      invalidSlugs: serviceNames
        .filter((s) => !isValidSlug(s))
        .map((abbreviation) => ({ abbreviation, derived: deriveSlug(abbreviation) })),
      caseCollisions: collisions(serviceNames, (s) => s.toLowerCase()),
      twoProviders,
      unknownProvider,
      invalidNames: serviceNames.filter((s) => !checkName(first(s).name).ok),
      differingRows,
      namedLikeTheirProvider: serviceNames.filter((s) => {
        const count = providerCount(services.get(s)!);
        return count.ok && count.provider.toLowerCase() === s.toLowerCase();
      }),
    },
    consortia: {
      byAbbreviation: sorted([...consortia].filter((c) => consortiumKind(c) === 'abbreviation')),
      byName: sorted([...consortia].filter((c) => consortiumKind(c) === 'name')),
      alsoProviders: sorted(
        [...consortia].filter((c) =>
          snapshot.providers.some(
            (p) => p.name.trim().toLowerCase() === c.trim().toLowerCase() || p.abbreviation === c,
          ),
        ),
      ),
    },
    measurements: {
      servicesWithPoints: [...snapshot.measurements.values()].filter((l) => l.length > 0).length,
      points,
      unparsableDates,
      notFirstOfMonth,
      servicesNotFirstOfMonth,
      monthsWithSeveralPoints,
      gapMonths,
      kpiHistoriesWithGaps,
      servicesWithSeveralSeries,
      negativeValues,
      futureMonths,
      before1900,
      unknownKpis: sorted(unknownKpis),
      filesWithoutService: sorted(
        [...snapshot.measurements.keys()].filter((s) => !services.has(s)),
      ),
    },
    users,
  };

  if (snapshot.backups) discovery.backups = compareBackups(snapshot.measurements, snapshot.backups);
  return discovery;
}

/** The API's measurements against the S3 backups, point by point (KPI and instant). */
export function compareBackups(
  api: ReadonlyMap<string, readonly MeasurementPoint[]>,
  backups: ReadonlyMap<string, readonly MeasurementPoint[]>,
): NonNullable<Discovery['backups']> {
  const result: NonNullable<Discovery['backups']> = {
    services: { both: 0, onlyApi: 0, onlyBackup: 0 },
    points: { same: 0, otherValue: 0, onlyApi: 0, onlyBackup: 0, zeroInBackupOnly: 0 },
  };
  for (const service of new Set([...api.keys(), ...backups.keys()])) {
    // A service without points (an empty file) has no history on that side.
    const a = api.get(service)?.length ? api.get(service) : undefined;
    const b = backups.get(service)?.length ? backups.get(service) : undefined;
    if (a && b) result.services.both += 1;
    else if (a) result.services.onlyApi += 1;
    else if (b) result.services.onlyBackup += 1;
    const fromApi = new Map((a ?? []).map((p) => [pointKey(p), p.value]));
    const fromBackup = new Map((b ?? []).map((p) => [pointKey(p), p.value]));
    for (const [key, value] of fromApi) {
      if (!fromBackup.has(key)) result.points.onlyApi += 1;
      else if (fromBackup.get(key) === value) result.points.same += 1;
      else result.points.otherValue += 1;
    }
    for (const [key, value] of fromBackup) {
      if (fromApi.has(key)) continue;
      result.points.onlyBackup += 1;
      if (value === 0) result.points.zeroInBackupOnly += 1;
    }
  }
  return result;
}

const table = (head: string[], rows: (string | number)[][]) =>
  [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map(
      (row) => `| ${row.map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`,
    ),
  ].join('\n');

const list = (items: readonly string[]) =>
  items.length === 0 ? 'none' : items.map((i) => `\`${i}\``).join(', ');

/** The discovery as Markdown, for the terminal and for the plan's §14. */
export function discoveryMarkdown(d: Discovery): string {
  const m = d.measurements;
  const out = [
    `# Discovery of a legacy snapshot`,
    '',
    `Snapshot fetched at ${d.fetchedAt}. Counts, spellings and abbreviations only; no person is named.`,
    '',
    '## Counts',
    '',
    table(['Kind', 'Count'], Object.entries(d.counts)),
    '',
    '## Stage spellings',
    '',
    table(
      ['Spelling', 'Services'],
      d.stages.map((s) => [`\`${s.spelling}\``, s.services]),
    ),
    '',
    '## Licence spellings',
    '',
    table(
      ['Spelling', 'Services', 'SPDX id (bundled list)'],
      d.licences.map((l) => [`\`${l.spelling}\``, l.services, l.spdx]),
    ),
    '',
    '## Providers',
    '',
    `- Abbreviations the rule refuses (white space, "/", over 64): ${
      d.providers.invalidAbbreviations.length === 0
        ? 'none'
        : d.providers.invalidAbbreviations
            .map((p) => `\`${p.abbreviation}\` (${p.problem})`)
            .join(', ')
    }`,
    `- Abbreviations with white space at an end (trimmed): ${list(d.providers.trimmedAbbreviations)}`,
    `- Abbreviations equal without case: ${d.providers.duplicateAbbreviations.map((g) => list(g)).join('; ') || 'none'}`,
    `- Providers whose name the rule refuses: ${list(d.providers.invalidNames)}`,
    `- Providers whose names are equal without case: ${d.providers.duplicateNames.map((g) => list(g)).join('; ') || 'none'}`,
    '',
    '## Services',
    '',
    `- Abbreviations that are not a valid slug (and the slug derived from them): ${
      d.services.invalidSlugs.length === 0
        ? 'none'
        : d.services.invalidSlugs.map((s) => `\`${s.abbreviation}\` → \`${s.derived}\``).join(', ')
    }`,
    `- Abbreviations equal without case: ${d.services.caseCollisions.map((g) => list(g)).join('; ') || 'none'}`,
    `- With two or more providers: ${
      d.services.twoProviders.length === 0
        ? 'none'
        : d.services.twoProviders
            .map((s) => `\`${s.abbreviation}\` (${s.providers.join(', ')})`)
            .join(', ')
    }`,
    `- With no provider or no category: not visible through the API (\`/api/v1/services\` matches only services that have both)`,
    `- With a provider that \`/providers\` does not list: ${list(d.services.unknownProvider)}`,
    `- Whose name the rule refuses: ${list(d.services.invalidNames)}`,
    `- Whose rows differ beyond the provider: ${list(d.services.differingRows)}`,
    `- Named like their own provider (the legacy workaround for a consortium?): ${list(d.services.namedLikeTheirProvider)}`,
    '',
    '## Consortia (the API gives their names)',
    '',
    `- Usable as an abbreviation: ${list(d.consortia.byAbbreviation)}`,
    `- A name only (needs an abbreviation in the mapping): ${list(d.consortia.byName)}`,
    `- Also in the provider list (by name or abbreviation): ${list(d.consortia.alsoProviders)}`,
    '',
    '## Measurements',
    '',
    table(
      ['Finding', 'Count'],
      [
        ['services with points', m.servicesWithPoints],
        ['points', m.points],
        ['dates that do not parse', m.unparsableDates],
        ['points not on the first of a month', m.notFirstOfMonth],
        ['services with such points', m.servicesNotFirstOfMonth],
        ['KPI-months with several points', m.monthsWithSeveralPoints],
        ['months missing inside a KPI history (a 0 left out, or no report)', m.gapMonths],
        ['KPI histories (service and KPI) with such months', m.kpiHistoriesWithGaps],
        [
          'services whose answer steps back in time (a second series)',
          m.servicesWithSeveralSeries.length,
        ],
        ['negative values', m.negativeValues],
        ['points in a future month', m.futureMonths],
        ['points before 1900', m.before1900],
      ],
    ),
    '',
    `- Services whose answer steps back in time (at least this many series): ${
      m.servicesWithSeveralSeries.length === 0
        ? 'none'
        : m.servicesWithSeveralSeries.map((s) => `\`${s.abbreviation}\` (${s.series})`).join(', ')
    }`,
    `- KPI names in measurements that no KPI list has: ${list(m.unknownKpis)}`,
    `- Measurement files of a service \`/services\` does not list: ${list(m.filesWithoutService)}`,
    '- The API leaves out every value of 0 (`if record[label]`), and the S3 backups were made through it: a value of 0 is a missing month in both.',
    '',
    '## Users (counts only)',
    '',
    table(['Finding', 'Count'], Object.entries(d.users)),
  ];
  if (d.backups) {
    const b = d.backups;
    out.push(
      '',
      '## The API against the S3 backups',
      '',
      table(
        ['Finding', 'Count'],
        [
          ['services in both', b.services.both],
          ['services in the API only', b.services.onlyApi],
          ['services in the backups only', b.services.onlyBackup],
          ['points equal', b.points.same],
          ['points with another value', b.points.otherValue],
          ['points in the API only', b.points.onlyApi],
          ['points in the backups only', b.points.onlyBackup],
          ['of these, a value of 0', b.points.zeroInBackupOnly],
        ],
      ),
    );
  }
  return `${out.join('\n')}\n`;
}
