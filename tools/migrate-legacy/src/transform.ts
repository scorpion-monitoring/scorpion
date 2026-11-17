// Transform for the registry part (M13 plan §3): legacy providers, consortia and services plus the mapping into the
// operations the load step writes, and a finding for every record a rule dropped or changed. Pure: the target's stage
// keys and SPDX ids come in as facts. Deterministic: records are handled in code-unit order of their legacy key.
import type { LegacyProvider, LegacyService } from './legacy.ts';
import type { Mapping } from './mapping.ts';
import {
  checkAbbreviation,
  checkName,
  consortiumKind,
  deriveSlug,
  isValidSlug,
  providerCount,
  resolveLicence,
  resolveStage,
  uniqueSlug,
} from './rules.ts';

export type Kind = 'provider' | 'consortium' | 'service';
export const KINDS: readonly Kind[] = ['provider', 'consortium', 'service'];

export interface Finding {
  kind: Kind;
  /** The legacy key: provider abbreviation, consortium name, service abbreviation. */
  legacy: string;
  rule: string;
  /** `dropped`: not migrated. `adjusted`: migrated with a value a rule changed. */
  effect: 'dropped' | 'adjusted';
  detail: string;
  /** Where the mapping can decide it (`plan` writes a gap there). */
  gap?: string;
}

export interface OrganisationOp {
  kind: 'provider' | 'consortium';
  legacy: string;
  abbreviation: string;
  name: string;
}

export interface ServiceOp {
  legacy: string;
  slug: string;
  name: string;
  stage: string;
  license: string | null;
  /** The new abbreviation of the provider. */
  provider: string;
  /** The new abbreviations of the consortia. */
  consortia: string[];
}

export interface RegistryPlan {
  read: Record<Kind, number>;
  providers: OrganisationOp[];
  consortia: OrganisationOp[];
  services: ServiceOp[];
  findings: Finding[];
}

export interface TargetFacts {
  /** The keys of the vocabulary `stage` in the target. */
  stageTerms: readonly string[];
  /** SPDX ids, lower-cased → as spelled. */
  spdx: ReadonlyMap<string, string>;
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const quote = (value: string) => JSON.stringify(value);

function organisations(
  kind: 'provider' | 'consortium',
  legacy: readonly { key: string; name: string }[],
  decisions: Mapping['providers'],
  findings: Finding[],
): OrganisationOp[] {
  const ops: OrganisationOp[] = [];
  const abbreviations = new Map<string, string>();
  const names = new Map<string, string>();
  const section = kind === 'provider' ? 'providers' : 'consortia';
  for (const { key, name: legacyName } of [...legacy].sort((a, b) => byCode(a.key, b.key))) {
    const decided = decisions[key];
    const at = `${section}[${quote(key)}]`;
    const drop = (rule: string, detail: string, gap?: string) =>
      findings.push({
        kind,
        legacy: key,
        rule,
        effect: 'dropped',
        detail,
        ...(gap ? { gap } : {}),
      });
    const adjust = (rule: string, detail: string) =>
      findings.push({ kind, legacy: key, rule, effect: 'adjusted', detail });
    if (decided?.drop) {
      drop(`${kind}.dropped-by-mapping`, 'the mapping drops it');
      continue;
    }

    let abbreviation: string;
    if (typeof decided?.abbreviation === 'string') {
      const checked = checkAbbreviation(decided.abbreviation);
      if (!checked.ok) {
        drop(
          `${kind}.abbreviation-invalid`,
          `the mapping's abbreviation: ${checked.message}`,
          `${at}.abbreviation`,
        );
        continue;
      }
      abbreviation = checked.value;
      if (abbreviation !== key)
        adjust(`${kind}.abbreviation-mapped`, `${quote(key)} → ${quote(abbreviation)}`);
    } else if (decided?.abbreviation === null) {
      drop(
        `${kind}.abbreviation-open`,
        'the mapping leaves the abbreviation open',
        `${at}.abbreviation`,
      );
      continue;
    } else if (kind === 'consortium' && consortiumKind(key) === 'name') {
      drop(
        'consortium.abbreviation-open',
        'the API gives the consortium by its name, which is not a valid abbreviation; the mapping must give one',
        `${at}.abbreviation`,
      );
      continue;
    } else {
      const checked = checkAbbreviation(key);
      if (!checked.ok) {
        drop(`${kind}.abbreviation-invalid`, checked.message, `${at}.abbreviation`);
        continue;
      }
      abbreviation = checked.value;
      if (checked.changed)
        adjust(`${kind}.abbreviation-trimmed`, `${quote(key)} → ${quote(abbreviation)}`);
    }

    const checkedName = checkName(decided?.name ?? legacyName);
    if (!checkedName.ok) {
      drop(`${kind}.name-invalid`, checkedName.message, `${at}.name`);
      continue;
    }
    const name = checkedName.value;
    if (decided?.name !== undefined && name !== legacyName)
      adjust(`${kind}.name-mapped`, 'the mapping gives the name');
    else if (checkedName.changed) adjust(`${kind}.name-normalised`, 'white space collapsed');

    const sameAbbreviation = abbreviations.get(abbreviation.toLowerCase());
    if (sameAbbreviation !== undefined) {
      drop(
        `${kind}.abbreviation-duplicate`,
        `the abbreviation is taken by ${quote(sameAbbreviation)} (case is ignored)`,
        `${at}.abbreviation`,
      );
      continue;
    }
    const sameName = names.get(name.toLowerCase());
    if (sameName !== undefined) {
      drop(
        `${kind}.name-duplicate`,
        `the name is taken by ${quote(sameName)} (case is ignored)`,
        `${at}.name`,
      );
      continue;
    }
    abbreviations.set(abbreviation.toLowerCase(), key);
    names.set(name.toLowerCase(), key);
    ops.push({ kind, legacy: key, abbreviation, name });
  }
  return ops;
}

export function transformRegistry(
  snapshot: { providers: readonly LegacyProvider[]; services: readonly LegacyService[] },
  mapping: Mapping,
  facts: TargetFacts,
): RegistryPlan {
  const findings: Finding[] = [];
  const rowsByService = new Map<string, LegacyService[]>();
  for (const row of snapshot.services) {
    rowsByService.set(row.abbreviation, [...(rowsByService.get(row.abbreviation) ?? []), row]);
  }
  const consortiumNames = [...new Set(snapshot.services.flatMap((row) => row.consortia))];

  const providers = organisations(
    'provider',
    snapshot.providers.map((p) => ({ key: p.abbreviation, name: p.name })),
    mapping.providers,
    findings,
  );
  const consortia = organisations(
    'consortium',
    consortiumNames.map((name) => ({ key: name, name })),
    mapping.consortia,
    findings,
  );
  const providerByLegacy = new Map(providers.map((op) => [op.legacy, op.abbreviation]));
  const consortiumByLegacy = new Map(consortia.map((op) => [op.legacy, op.abbreviation]));
  const legacyProviders = new Set(snapshot.providers.map((p) => p.abbreviation));

  // Services: first the checks that do not depend on the others, then the slugs (kept or mapped ones reserve theirs
  // before derived ones are made unique against them).
  type Pending = Omit<ServiceOp, 'slug'> & { slug?: string; derived?: boolean };
  const pending: Pending[] = [];
  for (const legacy of [...rowsByService.keys()].sort(byCode)) {
    const rows = rowsByService.get(legacy)!;
    const first = rows[0]!;
    const decided = mapping.services[legacy];
    const at = `services[${quote(legacy)}]`;
    const drop = (rule: string, detail: string, gap?: string) =>
      findings.push({
        kind: 'service',
        legacy,
        rule,
        effect: 'dropped',
        detail,
        ...(gap ? { gap } : {}),
      });
    const adjust = (rule: string, detail: string) =>
      findings.push({ kind: 'service', legacy, rule, effect: 'adjusted', detail });
    if (decided?.drop) {
      drop('service.dropped-by-mapping', 'the mapping drops it');
      continue;
    }
    const count = providerCount(rows);
    if (!count.ok) {
      drop(
        count.rule,
        count.rule === 'service.two-providers'
          ? `the new model has one provider; the legacy data has ${count.providers.map(quote).join(', ')}`
          : 'the legacy data has no provider',
        `${at}.drop`,
      );
      continue;
    }
    const provider = providerByLegacy.get(count.provider);
    if (provider === undefined) {
      drop(
        legacyProviders.has(count.provider)
          ? 'service.provider-dropped'
          : 'service.provider-unknown',
        `its provider ${quote(count.provider)} is ${legacyProviders.has(count.provider) ? 'not migrated' : 'not in the provider list'}`,
      );
      continue;
    }
    const name = checkName(first.name);
    if (!name.ok) {
      drop('service.name-invalid', name.message, `${at}.drop`);
      continue;
    }
    if (name.changed) adjust('service.name-normalised', 'white space collapsed');

    let stage: string;
    if (decided?.stage !== undefined && facts.stageTerms.includes(decided.stage)) {
      stage = decided.stage;
      adjust('stage.mapped', `the mapping gives ${quote(stage)} for this service`);
    } else {
      const resolved = resolveStage(first.stage, facts.stageTerms, mapping);
      if (!resolved.ok) {
        const spelling = first.stage?.trim() ?? '';
        drop(
          `service.${resolved.rule}`,
          resolved.rule === 'stage.missing'
            ? 'the legacy data has no stage, and the mapping gives no missingStage'
            : `${quote(spelling)} is not a stage key (${facts.stageTerms.join(', ')})`,
          resolved.rule === 'stage.missing' ? 'missingStage' : `stages[${quote(spelling)}]`,
        );
        continue;
      }
      stage = resolved.key;
      if (resolved.rule) {
        adjust(
          `service.${resolved.rule}`,
          resolved.rule === 'stage.missing-mapped'
            ? `no stage in the legacy data → ${quote(stage)} (missingStage)`
            : `${quote(first.stage ?? '')} → ${quote(stage)}`,
        );
      }
    }

    const licence = resolveLicence(first.license, mapping, facts.spdx);
    if (licence.rule) {
      adjust(
        `service.${licence.rule}`,
        licence.license === null
          ? `${quote(first.license ?? '')} is not an SPDX id; left empty`
          : `${quote(first.license ?? '')} → ${quote(licence.license)}`,
      );
    }

    const links: string[] = [];
    for (const consortium of [...new Set(first.consortia)].sort(byCode)) {
      const target = consortiumByLegacy.get(consortium);
      if (target === undefined) {
        adjust(
          'service.consortium-link-dropped',
          `the consortium ${quote(consortium)} is not migrated`,
        );
      } else links.push(target);
    }

    let slug: string | undefined;
    if (decided?.slug !== undefined) {
      if (!isValidSlug(decided.slug)) {
        drop(
          'service.slug-invalid',
          `the mapping's slug ${quote(decided.slug)} is not a valid slug`,
          `${at}.slug`,
        );
        continue;
      }
      slug = decided.slug;
      if (slug !== legacy) adjust('service.slug-mapped', `${quote(legacy)} → ${quote(slug)}`);
    } else if (isValidSlug(legacy)) slug = legacy;

    pending.push({
      legacy,
      ...(slug === undefined ? { derived: true } : { slug }),
      name: name.value,
      stage,
      license: licence.license,
      provider,
      consortia: links,
    });
  }

  const taken = new Set<string>();
  const services: ServiceOp[] = [];
  for (const item of pending.filter((p) => !p.derived)) {
    if (taken.has(item.slug!.toLowerCase())) {
      findings.push({
        kind: 'service',
        legacy: item.legacy,
        rule: 'service.slug-duplicate',
        effect: 'dropped',
        detail: `the slug ${quote(item.slug!)} is taken by another service (case is ignored)`,
        gap: `services[${quote(item.legacy)}].slug`,
      });
      continue;
    }
    taken.add(item.slug!.toLowerCase());
    services.push({ ...item, slug: item.slug! });
  }
  for (const item of pending.filter((p) => p.derived)) {
    const slug = uniqueSlug(deriveSlug(item.legacy), taken);
    taken.add(slug.toLowerCase());
    findings.push({
      kind: 'service',
      legacy: item.legacy,
      rule: 'service.slug-derived',
      effect: 'adjusted',
      detail: `${quote(item.legacy)} is not a valid slug → ${quote(slug)}`,
    });
    services.push({
      legacy: item.legacy,
      slug,
      name: item.name,
      stage: item.stage,
      license: item.license,
      provider: item.provider,
      consortia: item.consortia,
    });
  }
  services.sort((a, b) => byCode(a.legacy, b.legacy));

  return {
    read: {
      provider: snapshot.providers.length,
      consortium: consortiumNames.length,
      service: rowsByService.size,
    },
    providers,
    consortia,
    services,
    findings,
  };
}
