// Transform for the KPI framework (M13 plan §3, sprint 2): legacy KPIs, categories and the services' KPIs into the
// operations the load step writes, and a finding for every record a rule dropped or changed. Pure: the vocabularies of the
// target come in as facts. A category is a KPI set (ADR-0040) and necessity is the set row's term; the service's set is the
// set of its category; the service's additional KPIs are its extras, and so is every KPI that has a value for the service
// and is not in its set (decision 9), so no value is lost.
import type { Mapping } from './mapping.ts';
import type { Snapshot } from './snapshot.ts';
import { checkName, resolveTerm } from './rules.ts';
import type { Finding, RegistryPlan } from './transform.ts';

export interface KpiFacts {
  valueTypes: readonly string[];
  /** The keys of the vocabulary `thematic-category`. */
  thematic: readonly string[];
  /** The keys of the vocabulary `kpi.unit`. */
  units: readonly string[];
  /** The keys of the vocabulary `necessity`. */
  necessities: readonly string[];
  /** The keys of the vocabulary `kpi.service-category`. */
  rimoCategories: readonly string[];
}

export interface IndicatorOp {
  /** The legacy KPI name (also the key of its findings). */
  legacy: string;
  name: string;
  description: string | null;
  valueType: string;
  thematic: string;
  unit: string | null;
  slug?: string;
}

export interface SetRowOp {
  /** The legacy KPI name. */
  indicator: string;
  necessity: string;
}

export interface SetOp {
  /** The legacy category name. */
  legacy: string;
  name: string;
  slug?: string;
  rimoCategory: string | null;
  rows: SetRowOp[];
}

export interface ServiceKpisOp {
  /** The legacy service abbreviation. */
  legacy: string;
  slug: string;
  /** The legacy category name of the set, or `null` when the service has none (or the set was not migrated). */
  set: string | null;
  /** The legacy names of the KPIs it opted into beyond the set. */
  extras: string[];
}

export interface KpiPlan {
  read: { indicator: number; 'kpi-set': number; 'service-kpis': number };
  indicators: IndicatorOp[];
  sets: SetOp[];
  serviceKpis: ServiceKpisOp[];
  /** Legacy KPI names that are not migrated (dropped, or refused by a gap): their measurements are dropped too. */
  unavailable: Set<string>;
  findings: Finding[];
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const quote = (value: string) => JSON.stringify(value);

export function transformKpis(
  snapshot: Pick<
    Snapshot,
    'categories' | 'services' | 'indicatorsByCategory' | 'indicatorsByService'
  >,
  /** The values a service has per legacy KPI name, by legacy service abbreviation (from the measurements transform). */
  measured: ReadonlyMap<string, ReadonlyMap<string, number>>,
  mapping: Mapping,
  facts: KpiFacts,
  registry: Pick<RegistryPlan, 'services'>,
): KpiPlan {
  const findings: Finding[] = [];

  // The categories, from the list and from the services (a service's category that the list lacks is still a set).
  const firstRowOf = new Map<string, Snapshot['services'][number]>();
  for (const row of snapshot.services)
    if (!firstRowOf.has(row.abbreviation)) firstRowOf.set(row.abbreviation, row);
  const categories = [
    ...new Set([
      ...snapshot.categories.map((c) => c.name),
      ...snapshot.services.map((s) => s.category),
    ]),
  ].sort(byCode);

  // The KPIs: every name a category, a service or a measurement mentions, with the first description there is.
  const migratedServices = new Map(registry.services.map((s) => [s.legacy, s] as const));
  const descriptions = new Map<string, string | null>();
  const seen = (name: string, description: string | null) => {
    if (!descriptions.has(name) || (descriptions.get(name) === null && description !== null)) {
      descriptions.set(name, description);
    }
  };
  for (const list of [snapshot.indicatorsByCategory, snapshot.indicatorsByService]) {
    for (const key of Object.keys(list).sort(byCode)) {
      for (const kpi of list[key]!) seen(kpi.name, kpi.description?.trim() || null);
    }
  }
  const fromMeasurements = new Set<string>();
  for (const [service, byKpi] of measured) {
    if (!migratedServices.has(service)) continue;
    for (const kpi of byKpi.keys()) {
      if (!descriptions.has(kpi)) fromMeasurements.add(kpi);
      seen(kpi, null);
    }
  }

  const unavailable = new Set<string>();
  const indicators: IndicatorOp[] = [];
  const canonical = new Map<string, string>(); // lower-cased name → legacy name of the first
  for (const legacy of [...descriptions.keys()].sort(byCode)) {
    const decided = mapping.indicators[legacy];
    const at = `indicators[${quote(legacy)}]`;
    const refuse = (rule: string, detail: string, gap?: string, blocking = false) => {
      findings.push({
        kind: 'indicator',
        legacy,
        rule,
        effect: 'dropped',
        detail,
        ...(gap ? { gap } : {}),
        ...(blocking ? { blocking } : {}),
      });
      unavailable.add(legacy);
    };
    if (decided?.drop) {
      refuse('indicator.dropped-by-mapping', 'the mapping drops it');
      continue;
    }
    const name = checkName(legacy);
    if (!name.ok) {
      refuse('indicator.name-invalid', name.message, `${at}.drop`, true);
      continue;
    }
    if (name.changed)
      findings.push({
        kind: 'indicator',
        legacy,
        rule: 'indicator.name-normalised',
        effect: 'adjusted',
        detail: 'white space collapsed',
      });
    const twin = canonical.get(name.value.toLowerCase());
    if (twin !== undefined) {
      refuse(
        'indicator.name-duplicate',
        `the name is taken by ${quote(twin)} (case is ignored)`,
        `${at}.drop`,
        true,
      );
      continue;
    }
    const thematic = decided?.thematic;
    if (typeof thematic !== 'string') {
      refuse(
        'indicator.thematic-open',
        'the mapping gives no thematic category, which an indicator needs',
        `${at}.thematic`,
        true,
      );
      continue;
    }
    if (!facts.thematic.includes(thematic)) {
      refuse(
        'indicator.thematic-unknown',
        `${quote(thematic)} is not a key of the vocabulary thematic-category (${facts.thematic.join(', ')})`,
        `${at}.thematic`,
        true,
      );
      continue;
    }
    const valueType = decided?.valueType ?? 'integer';
    if (!facts.valueTypes.includes(valueType)) {
      refuse(
        'indicator.value-type-unknown',
        `${quote(valueType)} is not a value type (${facts.valueTypes.join(', ')})`,
        `${at}.valueType`,
        true,
      );
      continue;
    }
    const unit = decided?.unit ?? null;
    if (unit !== null && !facts.units.includes(unit)) {
      refuse(
        'indicator.unit-unknown',
        `${quote(unit)} is not a key of the vocabulary kpi.unit`,
        `${at}.unit`,
        true,
      );
      continue;
    }
    canonical.set(name.value.toLowerCase(), legacy);
    if (fromMeasurements.has(legacy)) {
      findings.push({
        kind: 'indicator',
        legacy,
        rule: 'indicator.from-measurements',
        effect: 'adjusted',
        detail: 'no category or service lists this KPI; it is known only from measurements',
      });
    }
    indicators.push({
      legacy,
      name: name.value,
      description: descriptions.get(legacy) ?? null,
      valueType,
      thematic,
      unit,
      ...(decided?.slug ? { slug: decided.slug } : {}),
    });
  }
  const available = new Set(indicators.map((i) => i.legacy));

  // The sets: one per category, rows from `GET /indicators?category=`.
  const sets: SetOp[] = [];
  for (const legacy of categories) {
    const decided = mapping.kpiSets[legacy];
    const at = `kpiSets[${quote(legacy)}]`;
    const drop = (rule: string, detail: string, gap?: string) =>
      findings.push({
        kind: 'kpi-set',
        legacy,
        rule,
        effect: 'dropped',
        detail,
        ...(gap ? { gap } : {}),
      });
    if (decided?.drop) {
      drop('kpi-set.dropped-by-mapping', 'the mapping drops it');
      continue;
    }
    const name = checkName(legacy);
    if (!name.ok) {
      drop('kpi-set.name-invalid', name.message, `${at}.drop`);
      continue;
    }
    const rimo = decided?.rimoCategory ?? null;
    if (rimo !== null && !facts.rimoCategories.includes(rimo)) {
      drop(
        'kpi-set.rimo-category-unknown',
        `${quote(rimo)} is not a key of the vocabulary kpi.service-category`,
        `${at}.rimoCategory`,
      );
      continue;
    }
    const rows: SetRowOp[] = [];
    for (const kpi of [...(snapshot.indicatorsByCategory[legacy] ?? [])].sort((a, b) =>
      byCode(a.name, b.name),
    )) {
      if (!available.has(kpi.name) || rows.some((r) => r.indicator === kpi.name)) continue;
      // The legacy route lists every KPI for every category; the category defines a KPI only when it gives it a
      // necessity (`DEFINES`), which the API also shows as `selected`. Any other KPI is not a row of this set.
      const entry = kpi.categories.find((c) => c.name === legacy);
      if (entry?.necessity == null && kpi.selected !== true) continue;
      const spelling = entry?.necessity ?? null;
      const resolved = resolveTerm(
        spelling,
        facts.necessities,
        mapping.necessities,
        mapping.missingNecessity,
      );
      if (!resolved.ok) {
        findings.push({
          kind: 'kpi-set',
          legacy,
          rule: `kpi-set.necessity-${resolved.rule}`,
          effect: 'adjusted',
          detail: `${quote(kpi.name)}: ${
            resolved.rule === 'missing'
              ? 'no necessity, and the mapping gives no usable missingNecessity'
              : `${quote(spelling ?? '')} is not a key of the vocabulary necessity`
          }; the row is not migrated (the KPI becomes an optional extra where it has values)`,
          gap:
            resolved.rule === 'missing'
              ? 'missingNecessity'
              : `necessities[${quote(spelling ?? '')}]`,
        });
        continue;
      }
      if (resolved.rule === 'missing-mapped') {
        findings.push({
          kind: 'kpi-set',
          legacy,
          rule: 'kpi-set.necessity-missing-mapped',
          effect: 'adjusted',
          detail: `${quote(kpi.name)}: no necessity in the legacy data → ${quote(resolved.key)} (missingNecessity)`,
        });
      } else if (resolved.rule) {
        findings.push({
          kind: 'kpi-set',
          legacy,
          rule: `kpi-set.necessity-${resolved.rule}`,
          effect: 'adjusted',
          detail: `${quote(kpi.name)}: ${quote(spelling ?? '')} → ${quote(resolved.key)}`,
        });
      }
      rows.push({ indicator: kpi.name, necessity: resolved.key });
    }
    sets.push({
      legacy,
      name: name.value,
      rimoCategory: rimo,
      rows,
      ...(decided?.slug ? { slug: decided.slug } : {}),
    });
  }
  const setByLegacy = new Map(sets.map((s) => [s.legacy, s] as const));

  // The services' sets and extras.
  const serviceKpis: ServiceKpisOp[] = [];
  for (const op of registry.services) {
    const category = firstRowOf.get(op.legacy)?.category ?? null;
    const set = category !== null ? (setByLegacy.get(category) ?? null) : null;
    if (category !== null && set === null) {
      findings.push({
        kind: 'service-kpis',
        legacy: op.legacy,
        rule: 'service-kpis.set-not-migrated',
        effect: 'adjusted',
        detail: `its category ${quote(category)} is not migrated as a KPI set; the service starts without one`,
      });
    }
    const inSet = new Set(set?.rows.map((r) => r.indicator) ?? []);
    const extras: string[] = [];
    for (const kpi of [...(snapshot.indicatorsByService[op.legacy] ?? [])].sort((a, b) =>
      byCode(a.name, b.name),
    )) {
      if (available.has(kpi.name) && !inSet.has(kpi.name) && !extras.includes(kpi.name))
        extras.push(kpi.name);
    }
    for (const [kpi, values] of [...(measured.get(op.legacy) ?? [])].sort(([a], [b]) =>
      byCode(a, b),
    )) {
      if (!available.has(kpi) || inSet.has(kpi) || extras.includes(kpi)) continue;
      extras.push(kpi);
      findings.push({
        kind: 'service-kpis',
        legacy: op.legacy,
        rule: 'service-kpis.kpi-added-optional',
        effect: 'adjusted',
        detail: `${quote(kpi)} has ${values} value(s) but is not in the service's set or additional KPIs; added as an optional extra so no value is lost`,
      });
    }
    serviceKpis.push({
      legacy: op.legacy,
      slug: op.slug,
      set: set?.legacy ?? null,
      extras: extras.sort(byCode),
    });
  }

  return {
    read: {
      indicator: descriptions.size,
      'kpi-set': categories.length,
      'service-kpis': registry.services.length,
    },
    indicators,
    sets,
    serviceKpis,
    unavailable,
    findings,
  };
}
