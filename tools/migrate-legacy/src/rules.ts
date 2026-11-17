// The rules of the M13 plan §3 for the registry part, as pure functions. Each one applies the new application's own rule
// (the parsers the services use, from the modules' public.ts) and says what it did, so the report can name the rule
// that decided a record. No database, no network.
import { bundledSpdxList } from '@scorpion/integrations';
import { parseAbbreviation, parseName } from '@scorpion/registry-organisations/public';
import { MAX_SLUG_LENGTH, parseSlug } from '@scorpion/registry-services/public';

export type Checked<T> = { ok: true; value: T; changed: boolean } | { ok: false; message: string };

/** An organisation's abbreviation (no white space or "/", at most 64). `changed` when the rule trimmed it. */
export function checkAbbreviation(value: string): Checked<string> {
  const parsed = parseAbbreviation(value);
  return parsed.ok
    ? { ok: true, value: parsed.value, changed: parsed.value !== value }
    : { ok: false, message: parsed.message };
}

/** An organisation's or a service's name (one line, 1 to 200). `changed` when white space was collapsed. */
export function checkName(value: string): Checked<string> {
  const parsed = parseName(value);
  return parsed.ok
    ? { ok: true, value: parsed.value, changed: parsed.value !== value }
    : { ok: false, message: parsed.message };
}

/** Whether `value` is a valid slug as it stands (ADR-0035). */
export function isValidSlug(value: string): boolean {
  const parsed = parseSlug(value);
  return parsed.ok && parsed.value === value;
}

/**
 * A slug made from a legacy abbreviation that breaks the slug rule (decision 7: derived, the mapping may override):
 * accents dropped, every run of other characters becomes "-", the start is a letter or a digit, at most 64 characters.
 * A result that is still refused (a reserved word, the shape of a UUID) gets "-service"; an empty one is "service".
 */
export function deriveSlug(abbreviation: string): string {
  let slug = abbreviation
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/[-._]+$/, '');
  if (slug === '') slug = 'service';
  if (!parseSlug(slug).ok) slug = `${slug.slice(0, MAX_SLUG_LENGTH - '-service'.length)}-service`;
  return slug;
}

/** `slug`, or `slug-2`, `slug-3`, … (cut to fit 64), whichever is not in `taken` (lower-cased slugs). */
export function uniqueSlug(slug: string, taken: ReadonlySet<string>): string {
  if (!taken.has(slug.toLowerCase())) return slug;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${slug.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase()) && parseSlug(candidate).ok) return candidate;
  }
}

export type StageResult =
  | { ok: true; key: string; rule?: 'stage.respelled' | 'stage.mapped' | 'stage.missing-mapped' }
  | { ok: false; rule: 'stage.unknown' | 'stage.missing' };

/**
 * A legacy stage spelling to a key of the vocabulary `stage` (ADR-0018 keeps the legacy keys, `TERM` included): the key
 * itself; the mapping's entry for the spelling; the one key that differs only in case; or, for no stage, the mapping's
 * `missingStage`. Anything else is not migrated.
 */
export function resolveStage(
  spelling: string | null,
  terms: readonly string[],
  mapping: { stages: Readonly<Record<string, string | null>>; missingStage: string | null },
): StageResult {
  const value = spelling?.trim() ?? '';
  if (value === '') {
    return mapping.missingStage !== null && terms.includes(mapping.missingStage)
      ? { ok: true, key: mapping.missingStage, rule: 'stage.missing-mapped' }
      : { ok: false, rule: 'stage.missing' };
  }
  if (terms.includes(value)) return { ok: true, key: value };
  const mapped = mapping.stages[value];
  if (mapped !== undefined && mapped !== null && terms.includes(mapped)) {
    return { ok: true, key: mapped, rule: 'stage.mapped' };
  }
  const caseless = terms.filter((term) => term.toLowerCase() === value.toLowerCase());
  if (caseless.length === 1) return { ok: true, key: caseless[0]!, rule: 'stage.respelled' };
  return { ok: false, rule: 'stage.unknown' };
}

/** The SPDX ids the services accept, lower-cased → as spelled (the bundled list the stub and the fallback use). */
export function spdxIndex(ids: readonly string[] = bundledSpdxList().licenses.map((l) => l.id)) {
  return new Map(ids.map((id) => [id.toLowerCase(), id]));
}

export type LicenceResult = {
  license: string | null;
  rule?: 'licence.respelled' | 'licence.mapped' | 'licence.not-spdx';
};

/**
 * A legacy licence to an SPDX id or nothing: no licence stays none; the mapping's entry for the spelling (null: leave it
 * empty); the SPDX id in any case; else it is left empty and reported (plan §3).
 */
export function resolveLicence(
  spelling: string | null,
  mapping: { licences: Readonly<Record<string, string | null>> },
  index: ReadonlyMap<string, string>,
): LicenceResult {
  const value = spelling?.trim() ?? '';
  if (value === '') return { license: null };
  if (value in mapping.licences) {
    const mapped = mapping.licences[value] ?? null;
    if (mapped === null) return { license: null, rule: 'licence.not-spdx' };
    const id = index.get(mapped.toLowerCase());
    return id
      ? { license: id, rule: 'licence.mapped' }
      : { license: null, rule: 'licence.not-spdx' };
  }
  const id = index.get(value.toLowerCase());
  if (id === undefined) return { license: null, rule: 'licence.not-spdx' };
  return id === value ? { license: id } : { license: id, rule: 'licence.respelled' };
}

/** The providers of one service across its rows: the new model needs exactly one. */
export function providerCount(
  rows: readonly { provider: string | null }[],
):
  | { ok: true; provider: string }
  | { ok: false; rule: 'service.no-provider' | 'service.two-providers'; providers: string[] } {
  const providers = [
    ...new Set(rows.map((row) => row.provider?.trim() ?? '').filter((p) => p !== '')),
  ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (providers.length === 1) return { ok: true, provider: providers[0]! };
  return {
    ok: false,
    rule: providers.length === 0 ? 'service.no-provider' : 'service.two-providers',
    providers,
  };
}

export type ConsortiumKind = 'abbreviation' | 'name';

/**
 * How the API names a consortium: `get_all_services` returns `CONSORTIA.name`. A name that passes the abbreviation rule
 * can be the abbreviation as it is ("by abbreviation"); one that does not ("by name") needs an abbreviation from the
 * mapping.
 */
export function consortiumKind(name: string): ConsortiumKind {
  const checked = checkAbbreviation(name);
  return checked.ok && !checked.changed ? 'abbreviation' : 'name';
}
