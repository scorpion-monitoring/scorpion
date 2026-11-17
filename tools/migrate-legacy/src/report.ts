// The report of a run: counts per kind (read, created, kept, changed, dropped) and one line per record that was dropped,
// updated, or migrated with a value a rule changed, with the rule that decided it. JSON for the tool (sprint 3 compares
// against it) and Markdown for people. It may hold names, so it is written with mode 0600 and never into the repository.
import { join } from 'node:path';
import { emptyPrivateDirectory, refuseInsideRepository, writePrivateFile } from './files.ts';
import type { RecordResult } from './load.ts';
import type { Manifest } from './snapshot.ts';
import { KINDS, type Finding, type Kind } from './transform.ts';

export const REPORT_FORMAT = 'scorpion-legacy-report/1';

export interface ReportRecord extends RecordResult {
  rules: { rule: string; effect: Finding['effect']; detail: string }[];
}

export interface Report {
  format: typeof REPORT_FORMAT;
  mode: 'dry-run' | 'run';
  startedAt: string;
  finishedAt: string;
  /** Set when the run stopped before the end. */
  stopped?: string;
  snapshot: { source: string; fetchedAt: string; files: number };
  mapping: { file: string; open: number };
  account: { username: string; state: 'found' | 'created' | 'not created (dry run)' };
  target: { empty: boolean; notes: string[] };
  counts: Record<
    Kind,
    { read: number; created: number; kept: number; changed: number; dropped: number }
  >;
  records: ReportRecord[];
}

/** Joins the load's results with the transform's and the load's findings, one record per legacy key and kind. */
export function buildRecords(
  results: readonly RecordResult[],
  findings: readonly Finding[],
): ReportRecord[] {
  const key = (kind: Kind, legacy: string) => `${kind}\u0000${legacy}`;
  const records = new Map<string, ReportRecord>();
  for (const result of results)
    records.set(key(result.kind, result.legacy), { ...result, rules: [] });
  for (const finding of findings) {
    const k = key(finding.kind, finding.legacy);
    const record =
      records.get(k) ??
      ({
        kind: finding.kind,
        legacy: finding.legacy,
        target: null,
        outcome: 'dropped',
        rules: [],
      } satisfies ReportRecord);
    if (finding.effect === 'dropped') record.outcome = 'dropped';
    record.rules.push({ rule: finding.rule, effect: finding.effect, detail: finding.detail });
    records.set(k, record);
  }
  const order = (r: ReportRecord) => KINDS.indexOf(r.kind);
  return [...records.values()].sort((a, b) =>
    order(a) !== order(b)
      ? order(a) - order(b)
      : a.legacy < b.legacy
        ? -1
        : a.legacy > b.legacy
          ? 1
          : 0,
  );
}

export function countRecords(
  read: Record<Kind, number>,
  records: readonly ReportRecord[],
): Report['counts'] {
  const counts = Object.fromEntries(
    KINDS.map((kind) => [kind, { read: read[kind], created: 0, kept: 0, changed: 0, dropped: 0 }]),
  ) as Report['counts'];
  for (const record of records) counts[record.kind][record.outcome] += 1;
  return counts;
}

const code = (value: string | null) => (value === null ? '—' : `\`${value.replaceAll('`', "'")}\``);

export function reportMarkdown(report: Report): string {
  const dry = report.mode === 'dry-run';
  const lines = [
    `# Migration report: registry${dry ? ' (dry run: nothing was written)' : ''}`,
    '',
    `- Snapshot: ${report.snapshot.source}, fetched ${report.snapshot.fetchedAt} (${report.snapshot.files} files, checked against the manifest)`,
    `- Mapping: ${report.mapping.file} (${report.mapping.open} open line(s))`,
    `- Account: \`${report.account.username}\` (${report.account.state})`,
    `- Target: ${report.target.empty ? 'empty' : 'not empty'}${report.target.notes.length ? `; ${report.target.notes.join('; ')}` : ''}`,
    `- From ${report.startedAt} to ${report.finishedAt}`,
    ...(report.stopped ? ['', `**Stopped:** ${report.stopped}`] : []),
    '',
    '## Counts',
    '',
    `| Kind | Read | ${dry ? 'Would be created' : 'Created'} | Kept | ${dry ? 'Would change' : 'Changed'} | Dropped |`,
    '| --- | --- | --- | --- | --- | --- |',
    ...KINDS.map((kind) => {
      const c = report.counts[kind];
      return `| ${kind} | ${c.read} | ${c.created} | ${c.kept} | ${c.changed} | ${c.dropped} |`;
    }),
  ];
  const section = (title: string, records: ReportRecord[]) => {
    if (records.length === 0) return;
    lines.push('', `## ${title}`, '');
    for (const r of records) {
      const rules = r.rules.map((x) => `${x.rule}: ${x.detail}`).join('; ');
      const fields = r.fields?.length ? `updated ${r.fields.join(', ')}` : '';
      lines.push(
        `- ${r.kind} ${code(r.legacy)} → ${code(r.target)}: ${[fields, rules].filter(Boolean).join('; ')}`,
      );
    }
  };
  section(
    'Dropped',
    report.records.filter((r) => r.outcome === 'dropped'),
  );
  section(
    dry ? 'Would change in the target' : 'Changed in the target',
    report.records.filter((r) => r.outcome === 'changed'),
  );
  section(
    'Migrated with a value a rule changed',
    report.records.filter((r) => r.outcome !== 'dropped' && r.rules.length > 0),
  );
  return `${lines.join('\n')}\n`;
}

/** Writes `report.json` and `report.md` (mode 0600) into a new or empty directory outside the repository. */
export async function writeReport(dir: string, report: Report): Promise<string> {
  const target = refuseInsideRepository(dir, 'The report directory');
  await emptyPrivateDirectory(target, 'The report directory');
  await writePrivateFile(join(target, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writePrivateFile(join(target, 'report.md'), reportMarkdown(report));
  return target;
}

export const snapshotSummary = (manifest: Manifest): Report['snapshot'] => ({
  source: manifest.source,
  fetchedAt: manifest.fetchedAt,
  files: Object.keys(manifest.files).length,
});
