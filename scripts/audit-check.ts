// `pnpm audit:check`: the dependency audit of CI (Scorecard: Vulnerabilities).
//
// Runs `pnpm audit --audit-level high --prod --json` (production dependencies, read from the lockfile)
// and fails on every `high` or `critical` advisory that is not in `.github/audit-allowlist.json`.
// `moderate` and `low` advisories are reported and never block. An advisory with no fix yet goes into
// the allow-list with a reason and an expiry date; an entry that has expired fails the check, so a
// silenced advisory has to be looked at again. See CONTRIBUTING.md, "Dependency audit".
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export interface AllowEntry {
  /** GitHub advisory id, `GHSA-xxxx-xxxx-xxxx`. */
  id: string;
  /** The affected package, for the reader. */
  package: string;
  /** Why the advisory does not apply or cannot be fixed yet. */
  reason: string;
  /** Last day (`YYYY-MM-DD`, UTC) on which the entry counts. */
  expires: string;
}

export interface Advisory {
  id: string;
  package: string;
  severity: string;
  title: string;
  url: string;
}

const GHSA = /^GHSA(-[a-z0-9]{4}){3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BLOCKING = new Set(['high', 'critical']);

/** Returns the problems of an allow-list document; empty when it is valid. */
export function validateAllowlist(doc: unknown): string[] {
  const entries = (doc as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) return ['the allow-list needs an "entries" array'];
  const problems: string[] = [];
  const seen = new Set<string>();
  entries.forEach((entry: Partial<AllowEntry> | null, i) => {
    const where = `entries[${i}]`;
    if (!entry || typeof entry !== 'object') return void problems.push(`${where} is not an object`);
    if (typeof entry.id !== 'string' || !GHSA.test(entry.id)) {
      problems.push(`${where}.id must be a GitHub advisory id (GHSA-xxxx-xxxx-xxxx)`);
    } else if (seen.has(entry.id)) {
      problems.push(`${where}.id ${entry.id} is listed twice`);
    } else {
      seen.add(entry.id);
    }
    if (typeof entry.package !== 'string' || entry.package.trim() === '') {
      problems.push(`${where}.package is required`);
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) {
      problems.push(`${where}.reason is required and must say why (at least 20 characters)`);
    }
    if (
      typeof entry.expires !== 'string' ||
      !DATE.test(entry.expires) ||
      Number.isNaN(Date.parse(entry.expires))
    ) {
      problems.push(`${where}.expires is required and must be a date, YYYY-MM-DD`);
    }
    const extra = Object.keys(entry).filter(
      (key) => !['id', 'package', 'reason', 'expires'].includes(key),
    );
    if (extra.length > 0) problems.push(`${where} has unknown fields: ${extra.join(', ')}`);
  });
  return problems;
}

export interface AuditResult {
  /** high or critical, not allowed: the check fails. */
  blocking: Advisory[];
  /** high or critical, covered by a valid allow-list entry. */
  allowed: Advisory[];
  /** moderate or low: reported only. */
  reported: Advisory[];
  /** Entries whose expiry date has passed: the check fails. */
  expired: AllowEntry[];
  /** Entries that match no advisory any more: remove them. */
  unused: AllowEntry[];
}

/** `today` is `YYYY-MM-DD`; an entry is valid through the day it expires. */
export function evaluate(advisories: Advisory[], allow: AllowEntry[], today: string): AuditResult {
  const expired = allow.filter((entry) => entry.expires < today);
  const valid = new Map(allow.filter((entry) => entry.expires >= today).map((e) => [e.id, e]));
  const result: AuditResult = { blocking: [], allowed: [], reported: [], expired, unused: [] };
  const hit = new Set<string>();
  for (const advisory of advisories) {
    if (!BLOCKING.has(advisory.severity)) result.reported.push(advisory);
    else if (valid.has(advisory.id)) {
      result.allowed.push(advisory);
      hit.add(advisory.id);
    } else result.blocking.push(advisory);
  }
  result.unused = allow.filter((entry) => !hit.has(entry.id) && !expired.includes(entry));
  return result;
}

/** Reads the advisories out of `pnpm audit --json` (the npm v6 audit format). Throws on anything else. */
export function parseAudit(json: string): Advisory[] {
  const doc = JSON.parse(json) as { advisories?: Record<string, Record<string, unknown>> };
  if (!doc || typeof doc.advisories !== 'object' || doc.advisories === null) {
    throw new Error('pnpm audit did not return an "advisories" object');
  }
  return Object.values(doc.advisories).map((a) => ({
    id: String(a.github_advisory_id ?? a.id),
    package: String(a.module_name),
    severity: String(a.severity),
    title: String(a.title),
    url: String(a.url),
  }));
}

if (import.meta.main) main();

function main() {
  const allowDoc: unknown = JSON.parse(readFileSync('.github/audit-allowlist.json', 'utf8'));
  const problems = validateAllowlist(allowDoc);
  if (problems.length > 0) {
    console.error(`.github/audit-allowlist.json is invalid:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }

  // The exit status says "vulnerabilities found"; the JSON is what we judge. Anything that is not
  // JSON (a network error, a registry outage) is an error, so the check never passes by accident.
  const run = spawnSync('pnpm', ['audit', '--audit-level', 'high', '--prod', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  let advisories: Advisory[];
  try {
    advisories = parseAudit(run.stdout);
  } catch (error) {
    console.error(`Could not read the audit result: ${(error as Error).message}`);
    console.error(run.stderr || run.stdout.slice(0, 500));
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const result = evaluate(advisories, (allowDoc as { entries: AllowEntry[] }).entries, today);
  const line = (a: Advisory) => `  ${a.id} ${a.severity} ${a.package}: ${a.title} (${a.url})`;

  if (result.reported.length > 0) {
    console.log(`Reported only (moderate or low):\n${result.reported.map(line).join('\n')}`);
  }
  if (result.allowed.length > 0) {
    console.log(`Allowed by .github/audit-allowlist.json:\n${result.allowed.map(line).join('\n')}`);
  }
  for (const entry of result.unused) {
    console.warn(`Allow-list entry ${entry.id} (${entry.package}) matches no advisory: remove it.`);
  }
  for (const entry of result.expired) {
    console.error(
      `Allow-list entry ${entry.id} (${entry.package}) expired on ${entry.expires}: fix it or renew it with a new reason.`,
    );
  }
  if (result.blocking.length > 0) {
    console.error(
      `High or critical advisories in production dependencies:\n${result.blocking.map(line).join('\n')}`,
    );
  }
  if (result.blocking.length > 0 || result.expired.length > 0) process.exit(1);
  console.log('Dependency audit passed.');
}
