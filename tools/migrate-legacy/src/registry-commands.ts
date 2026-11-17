// `migrate-legacy plan` and `migrate-legacy run` for the registry part (sprint 1): providers, consortia, services.
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { CliDeps } from './cli.ts';
import { emptyPrivateDirectory, refuseInsideRepository, RefusedPath } from './files.ts';
import { loadRegistry, RunStopped, type RecordResult } from './load.ts';
import { emptyMapping, readMapping, type Mapping } from './mapping.ts';
import {
  buildRecords,
  countRecords,
  REPORT_FORMAT,
  snapshotSummary,
  writeReport,
  type Report,
} from './report.ts';
import { resolveLicence, spdxIndex } from './rules.ts';
import { readSnapshot, type Snapshot } from './snapshot.ts';
import {
  migrationAccount,
  MIGRATION_USERNAME,
  openTarget,
  targetState,
  type Target,
} from './target.ts';
import { transformRegistry, type Finding, type TargetFacts } from './transform.ts';

async function factsOf(target: Target): Promise<TargetFacts> {
  const terms = await target.settings.listTerms('stage');
  return { stageTerms: terms.map((term) => term.key), spdx: spdxIndex() };
}

/** A first mapping for `snapshot`: every gap the transform found is a `null` and a line in `open`. */
export function firstMapping(
  snapshot: Snapshot,
  findings: readonly Finding[],
  facts: TargetFacts,
): Mapping {
  const mapping = emptyMapping();
  const open = new Set<string>();
  for (const finding of findings) {
    if (!finding.gap) continue;
    open.add(`${finding.gap}: ${finding.detail}`);
    const match = /^(providers|consortia)\[(".*")\]\.abbreviation$/.exec(finding.gap);
    if (match) {
      const section = match[1] as 'providers' | 'consortia';
      mapping[section][JSON.parse(match[2]!) as string] = { abbreviation: null };
    }
    const stage = /^stages\[(".*")\]$/.exec(finding.gap);
    if (stage) mapping.stages[JSON.parse(stage[1]!) as string] = null;
  }
  const index = facts.spdx;
  for (const spelling of new Set(snapshot.services.map((s) => s.license?.trim() ?? ''))) {
    if (
      spelling === '' ||
      resolveLicence(spelling, { licences: {} }, index).rule !== 'licence.not-spdx'
    )
      continue;
    mapping.licences[spelling] = null;
    open.add(
      `licences[${JSON.stringify(spelling)}]: not an SPDX id; give one, or leave null to leave the licence empty`,
    );
  }
  mapping.open = [...open].sort();
  return mapping;
}

export async function planCommand(args: string[], { env, io }: CliDeps): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { out: { type: 'string' } },
    strict: true,
  });
  const [dir, ...extra] = positionals;
  if (!dir || !values.out || extra.length > 0) {
    io.err('plan needs one snapshot directory and --out <mapping.json>.');
    return 2;
  }
  const out = refuseInsideRepository(values.out, 'The mapping file');
  const snapshot = await readSnapshot(dir);
  const target = await openTarget(env);
  try {
    const facts = await factsOf(target);
    const plan = transformRegistry(snapshot, emptyMapping(), facts);
    const mapping = firstMapping(snapshot, plan.findings, facts);
    await writeFile(out, `${JSON.stringify(mapping, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST')
        throw new RefusedPath(`The mapping file ${out} exists; give a new path.`);
      throw error;
    });
    io.out(`Mapping written to ${out}: ${mapping.open.length} open line(s) to decide.`);
    return 0;
  } finally {
    await target.stop();
  }
}

export async function runCommand(args: string[], { env, io, now }: CliDeps): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      mapping: { type: 'string' },
      report: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const [dir, ...extra] = positionals;
  if (!dir || !values.mapping || !values.report || extra.length > 0) {
    io.err('run needs one snapshot directory, --mapping <file> and --report <dir>.');
    return 2;
  }
  const dryRun = values['dry-run'];
  const clock = now ?? (() => new Date());
  const startedAt = clock().toISOString();
  // The report directory is checked before anything else, so a run never writes and then fails to report.
  const reportDir = refuseInsideRepository(values.report, 'The report directory');
  await emptyPrivateDirectory(reportDir, 'The report directory');
  const snapshot = await readSnapshot(dir);
  const mapping = await readMapping(values.mapping);

  const target = await openTarget(env);
  try {
    const facts = await factsOf(target);
    const plan = transformRegistry(snapshot, mapping, facts);
    const state = await targetState(target, {
      providers: plan.providers.map((p) => p.abbreviation),
      services: plan.services.map((s) => s.slug),
    });
    if (!dryRun && !values.yes) {
      io.err(
        `This run writes to the database of DATABASE_URL, which is ${state.empty ? 'empty' : `not empty (${state.notes.join('; ')})`}. ` +
          'Records that exist are kept or updated by their abbreviation and slug. Run it with --dry-run first; pass --yes to write.',
      );
      return 2;
    }
    if (!state.empty) io.err(`The target is not empty: ${state.notes.join('; ')}.`);

    const account = await migrationAccount(target, { create: !dryRun });
    let results: RecordResult[] = [];
    let findings: Finding[] = [...plan.findings];
    let stopped: string | undefined;
    try {
      const loaded = await loadRegistry(plan, target, { dryRun, actor: account.actor });
      results = loaded.results;
      findings = [...findings, ...loaded.findings];
    } catch (error) {
      if (!(error instanceof RunStopped)) throw error;
      results = error.results;
      stopped = error.message;
    }
    const records = buildRecords(results, findings);
    const report: Report = {
      format: REPORT_FORMAT,
      mode: dryRun ? 'dry-run' : 'run',
      startedAt,
      finishedAt: clock().toISOString(),
      ...(stopped ? { stopped } : {}),
      snapshot: snapshotSummary(snapshot.manifest),
      mapping: { file: values.mapping, open: mapping.open.length },
      account: { username: MIGRATION_USERNAME, state: account.state },
      target: state,
      counts: countRecords(plan.read, records),
      records,
    };
    await writeReport(reportDir, report);
    for (const [kind, c] of Object.entries(report.counts)) {
      io.out(
        `${kind}: ${c.read} read, ${c.created} ${dryRun ? 'would be created' : 'created'}, ${c.kept} kept, ` +
          `${c.changed} ${dryRun ? 'would change' : 'changed'}, ${c.dropped} dropped`,
      );
    }
    io.out(`Report written to ${reportDir}${dryRun ? ' (dry run: nothing was written)' : ''}.`);
    if (stopped) {
      io.err(`Stopped: ${stopped}`);
      return 1;
    }
    return 0;
  } finally {
    await target.stop();
  }
}
