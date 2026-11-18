// Load for the KPI framework: indicators, KPI sets with their rows, and each service's set and extras, through the public
// service of kpi.framework as the migration account. Idempotent by natural key: an indicator and a set are found by name
// (unique without case in the target), a service by its slug. What exists is **kept**, not overwritten: after the first run
// people edit these (descriptions, measured-by, the headline KPI), and a repeated run must not undo it. A difference is
// reported. Rows and extras that are missing are added (the union), so a run stopped halfway is finished by running it again.
import { type UserActor } from '@scorpion/contracts';
import type { KpiFrameworkPublic } from '@scorpion/kpi-framework/public';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { attemptWith, type Outcome, type RecordResult } from './load.ts';
import type { KpiPlan } from './kpi-transform.ts';
import type { Finding } from './transform.ts';

export interface KpiPorts {
  kpi: Pick<KpiFrameworkPublic, 'indicators' | 'sets' | 'serviceKpis'>;
  services: Pick<ServicesPublic, 'findBySlugAsSystem'>;
}

export interface KpiLoad {
  results: RecordResult[];
  findings: Finding[];
  /** The id of each indicator, by legacy KPI name (empty in a dry run for what would be created). */
  indicatorIds: Map<string, string>;
}

const PAGE = 100;

type IndicatorRow = Awaited<
  ReturnType<KpiPorts['kpi']['indicators']['list']>
>['indicators'][number];
type SetRow = Awaited<ReturnType<KpiPorts['kpi']['sets']['list']>>['sets'][number];

/** Every page of a listing (the services cap a page at 100). */
async function all<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; total: number }>,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 0; ; page += 1) {
    const got = await fetchPage(page);
    items.push(...got.items);
    if (got.items.length === 0 || items.length >= got.total) return items;
  }
}

export async function loadKpis(
  plan: KpiPlan,
  ports: KpiPorts,
  options: { dryRun: boolean; actor?: UserActor },
): Promise<KpiLoad> {
  const { dryRun } = options;
  if (!dryRun && !options.actor) throw new Error('A run that writes needs the migration account.');
  // A dry run without the account reads nothing the services would refuse to a stranger, so it compares nothing.
  const actor = options.actor;
  const results: RecordResult[] = [];
  const findings: Finding[] = [];
  const attempt = attemptWith(results, findings);
  const indicatorIds = new Map<string, string>();
  const setIds = new Map<string, string>();

  const existingIndicators: Map<string, IndicatorRow> = actor
    ? new Map(
        (
          await all(async (page) => {
            const got = await ports.kpi.indicators.list(actor, {}, { page, pageSize: PAGE });
            return { items: got.indicators, total: got.total };
          })
        ).map((i) => [i.name.toLowerCase(), i] as const),
      )
    : new Map<string, IndicatorRow>();
  const existingSets: Map<string, SetRow> = actor
    ? new Map(
        (
          await all(async (page) => {
            const got = await ports.kpi.sets.list(actor, {}, { page, pageSize: PAGE });
            return { items: got.sets, total: got.total };
          })
        ).map((s) => [s.name.toLowerCase(), s] as const),
      )
    : new Map<string, SetRow>();

  const push = (
    kind: RecordResult['kind'],
    legacy: string,
    target: string | null,
    outcome: Outcome,
    fields?: string[],
  ) => results.push({ kind, legacy, target, outcome, ...(fields ? { fields } : {}) });

  for (const op of plan.indicators) {
    const found = existingIndicators.get(op.name.toLowerCase());
    if (found) {
      indicatorIds.set(op.legacy, found.id);
      const differs = (
        [
          ['description', found.description, op.description],
          ['valueType', found.valueType, op.valueType],
          ['thematic', found.thematic, op.thematic],
          ['unit', found.unit, op.unit],
        ] as const
      ).filter(([, have, want]) => (have ?? null) !== (want ?? null));
      if (differs.length > 0) {
        findings.push({
          kind: 'indicator',
          legacy: op.legacy,
          rule: 'indicator.differs-kept',
          effect: 'adjusted',
          detail: `exists with another ${differs.map(([field]) => field).join(', ')}; kept as it is (a repeated run does not undo edits)`,
        });
      }
      push('indicator', op.legacy, found.slug, 'kept');
      continue;
    }
    const done = await attempt('indicator', op.legacy, op.slug ?? op.name, async () =>
      dryRun || !actor
        ? undefined
        : ports.kpi.indicators.create(actor, {
            name: op.name,
            ...(op.description !== null ? { description: op.description } : {}),
            valueType: op.valueType,
            thematic: op.thematic,
            ...(op.unit !== null ? { unit: op.unit } : {}),
            ...(op.slug ? { slug: op.slug } : {}),
          }),
    );
    if (!done.ok) {
      plan.unavailable.add(op.legacy);
      continue;
    }
    if (done.value) indicatorIds.set(op.legacy, done.value.id);
    push('indicator', op.legacy, done.value?.slug ?? op.slug ?? null, 'created');
  }

  for (const op of plan.sets) {
    const rows = op.rows.filter((row) => !plan.unavailable.has(row.indicator));
    const found = existingSets.get(op.name.toLowerCase());
    let id = found?.id;
    let created = false;
    if (!found) {
      const done = await attempt('kpi-set', op.legacy, op.slug ?? op.name, async () =>
        dryRun || !actor
          ? undefined
          : ports.kpi.sets.create(actor, {
              name: op.name,
              ...(op.rimoCategory !== null ? { rimoCategory: op.rimoCategory } : {}),
              ...(op.slug ? { slug: op.slug } : {}),
            }),
      );
      if (!done.ok) continue;
      id = done.value?.id;
      created = true;
    }
    if (id) setIds.set(op.legacy, id);
    // The rows: the union of what the set has and what the legacy category defines (necessity of an existing row kept).
    let added = 0;
    if (id && actor) {
      const current = await ports.kpi.sets.get(actor, id);
      const have = new Map(current.indicators.map((r) => [r.indicatorId, r.necessity] as const));
      const want = new Map(have);
      for (const row of rows) {
        const indicatorId = indicatorIds.get(row.indicator);
        if (indicatorId === undefined) continue;
        if (!want.has(indicatorId)) {
          want.set(indicatorId, row.necessity);
          added += 1;
        } else if (want.get(indicatorId) !== row.necessity) {
          findings.push({
            kind: 'kpi-set',
            legacy: op.legacy,
            rule: 'kpi-set.necessity-differs-kept',
            effect: 'adjusted',
            detail: `${JSON.stringify(row.indicator)} has necessity ${JSON.stringify(want.get(indicatorId))}; the legacy data says ${JSON.stringify(row.necessity)}; kept`,
          });
        }
      }
      if (added > 0 && !dryRun) {
        const done = await attempt('kpi-set', op.legacy, current.slug, () =>
          ports.kpi.sets.setIndicators(actor, id, {
            indicators: [...want].map(([indicatorId, necessity]) => ({ indicatorId, necessity })),
          }),
        );
        if (!done.ok) continue;
      }
    } else {
      added = rows.length; // nothing to compare in the target yet: every row is new
    }
    push(
      'kpi-set',
      op.legacy,
      found?.slug ?? op.slug ?? null,
      created ? 'created' : added > 0 ? 'changed' : 'kept',
      !created && added > 0 ? [`${added} row(s)`] : undefined,
    );
  }

  for (const op of plan.serviceKpis) {
    const service = await ports.services.findBySlugAsSystem(op.slug);
    const setId = op.set === null ? null : (setIds.get(op.set) ?? null);
    const extraIds = op.extras.flatMap((name) => {
      const id = indicatorIds.get(name);
      return id ? [id] : [];
    });
    if (!service || !actor) {
      // Nothing to read: in a dry run before the service exists, this is what a run would set.
      push('service-kpis', op.legacy, op.slug, 'created');
      continue;
    }
    const current = await ports.kpi.serviceKpis.get(actor, service.id);
    const haveSet = current.set?.id ?? null;
    const haveExtras = new Set(current.extras.map((e) => e.indicatorId));
    const nextSet = haveSet ?? setId;
    if (haveSet !== null && setId !== null && haveSet !== setId) {
      findings.push({
        kind: 'service-kpis',
        legacy: op.legacy,
        rule: 'service-kpis.set-differs-kept',
        effect: 'adjusted',
        detail: 'the service already has another KPI set; kept as it is',
      });
    }
    const extras = new Set([...haveExtras, ...extraIds]);
    const changes = [
      ...(nextSet !== haveSet ? ['set'] : []),
      ...(extras.size !== haveExtras.size ? [`${extras.size - haveExtras.size} extra(s)`] : []),
    ];
    if (changes.length === 0) {
      push('service-kpis', op.legacy, op.slug, 'kept');
      continue;
    }
    const done = await attempt('service-kpis', op.legacy, op.slug, async () => {
      if (!dryRun)
        await ports.kpi.serviceKpis.set(actor, service.id, { setId: nextSet, extras: [...extras] });
    });
    if (done.ok) push('service-kpis', op.legacy, op.slug, 'changed', changes);
  }
  return { results, findings, indicatorIds };
}
