// `migrate-legacy plan`, `run` and `users`: the stages of the migration in dependency order (plan §4): organisations and
// services, the KPI framework, users and roles, memberships, measurements; then the migration account's end.
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { CliDeps } from './cli.ts';
import { emptyPrivateDirectory, refuseInsideRepository, RefusedPath } from './files.ts';
import { loadKpis } from './load-kpis.ts';
import { loadMeasurements } from './load-measurements.ts';
import { loadMemberships, loadUsers } from './load-people.ts';
import { loadRegistry, RunStopped, type RecordResult } from './load.ts';
import { emptyMapping, readMapping, type Mapping } from './mapping.ts';
import { transformMeasurements, type MeasurementPlan } from './measurements.ts';
import { transformKpis, type KpiFacts, type KpiPlan } from './kpi-transform.ts';
import { transformPeople, type PeoplePlan } from './people-transform.ts';
import { noSubjects, readSubjects, type Subjects } from './subjects.ts';
import {
  THEMATIC_CATEGORY_VOCABULARY,
  UNIT_VOCABULARY,
  NECESSITY_VOCABULARY,
  SERVICE_CATEGORY_VOCABULARY,
} from '@scorpion/kpi-framework/public';
import {
  buildRecords,
  countRecords,
  REPORT_FORMAT,
  snapshotSummary,
  writeReport,
  type Report,
} from './report.ts';
import { providerCount, resolveLicence, spdxIndex } from './rules.ts';
import { readSnapshot, type Snapshot } from './snapshot.ts';
import {
  configuredProviders,
  describeDatabase,
  endAccount,
  migrationAccount,
  openTarget,
  targetState,
  type Target,
} from './target.ts';
import {
  KINDS,
  transformRegistry,
  type Finding,
  type Kind,
  type RegistryPlan,
  type TargetFacts,
} from './transform.ts';

async function factsOf(target: Target): Promise<TargetFacts> {
  const terms = await target.settings.listTerms('stage');
  return { stageTerms: terms.map((term) => term.key), spdx: spdxIndex() };
}

async function kpiFactsOf(target: Target): Promise<KpiFacts> {
  const keys = async (vocabulary: string) =>
    (await target.settings.listTerms(vocabulary)).map((term) => term.key);
  return {
    valueTypes: target.kpi.listValueTypes().map((type) => type.id),
    thematic: await keys(THEMATIC_CATEGORY_VOCABULARY),
    units: await keys(UNIT_VOCABULARY),
    necessities: await keys(NECESSITY_VOCABULARY),
    rimoCategories: await keys(SERVICE_CATEGORY_VOCABULARY),
  };
}

export interface Plans {
  registry: RegistryPlan;
  measurements: MeasurementPlan;
  kpis: KpiPlan;
  people: PeoplePlan;
  findings: Finding[];
  /** Findings that stop a run that writes. */
  blocking: Finding[];
  oidcProvider: string | null;
}

/** Every transform, in the order their results feed one another. Pure over what it is given; no write. */
export function buildPlans(input: {
  snapshot: Snapshot;
  mapping: Mapping;
  subjects: Subjects;
  facts: TargetFacts;
  kpiFacts: KpiFacts;
  /** The ids of the OIDC providers the target has configured. */
  providers: readonly string[];
  now: Date;
}): Plans {
  const { snapshot, mapping } = input;
  const registry = transformRegistry(snapshot, mapping, input.facts);
  const measurements = transformMeasurements(snapshot.measurements, {
    now: input.now,
    fillMissingMonths: mapping.fillMissingMonths,
  });
  const migrated = new Set(registry.services.map((service) => service.legacy));
  const measured = new Map(
    measurements.services
      .filter((service) => migrated.has(service.service))
      .map((service) => [service.service, service.perKpi] as const),
  );
  const kpis = transformKpis(snapshot, measured, mapping, input.kpiFacts, registry);
  const oidcProvider =
    mapping.oidcProvider ?? (input.providers.length === 1 ? input.providers[0]! : null);
  const people = transformPeople(snapshot, input.subjects, mapping, oidcProvider, registry);
  const findings = [
    ...registry.findings,
    ...kpis.findings,
    ...people.findings,
    ...measurements.findings,
  ];
  return {
    registry,
    measurements,
    kpis,
    people,
    findings,
    blocking: findings.filter((finding) => finding.blocking),
    oidcProvider,
  };
}

/** A first mapping for `snapshot`: every gap the transform found is a `null` and a line in `open`. */
/**
 * Decision 15: the legacy workaround made a consortium a provider of one service named like it. Every service named like
 * its own (single) provider is suggested as not migrated, and that provider as a consortium; `open` asks to check each.
 */
export function workaroundSuggestions(snapshot: Snapshot): { mapping: Mapping; open: string[] } {
  const mapping = emptyMapping();
  const open: string[] = [];
  const rows = new Map<string, Snapshot['services']>();
  for (const row of snapshot.services)
    rows.set(row.abbreviation, [...(rows.get(row.abbreviation) ?? []), row]);
  for (const [service, list] of [...rows].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const count = providerCount(list);
    if (!count.ok || count.provider.toLowerCase() !== service.toLowerCase()) continue;
    mapping.services[service] = { drop: true };
    mapping.providers[count.provider] = { type: 'consortium' };
    open.push(
      `services[${JSON.stringify(service)}]: named like its provider, the legacy workaround for a consortium: not migrated, and providers[${JSON.stringify(count.provider)}] becomes a consortium. Check it; remove both entries if it is a real service.`,
    );
  }
  return { mapping, open };
}

export function firstMapping(
  snapshot: Snapshot,
  findings: readonly Finding[],
  facts: TargetFacts,
  start: { mapping: Mapping; open: readonly string[] } = { mapping: emptyMapping(), open: [] },
  providers: readonly string[] = [],
): Mapping {
  const mapping = structuredClone(start.mapping);
  const open = new Set<string>(start.open);
  for (const finding of findings) {
    if (!finding.gap) continue;
    open.add(`${finding.gap}: ${finding.detail}`);
    const match = /^(providers|consortia)\[(".*")\]\.abbreviation$/.exec(finding.gap);
    if (match) {
      const section = match[1] as 'providers' | 'consortia';
      const key = JSON.parse(match[2]!) as string;
      mapping[section][key] = { ...mapping[section][key], abbreviation: null };
    }
    const stage = /^stages\[(".*")\]$/.exec(finding.gap);
    if (stage) mapping.stages[JSON.parse(stage[1]!) as string] = null;
    const thematic = /^indicators\[(".*")\]\.thematic$/.exec(finding.gap);
    if (thematic) {
      const key = JSON.parse(thematic[1]!) as string;
      mapping.indicators[key] = { ...mapping.indicators[key], thematic: null };
    }
    const necessity = /^necessities\[(".*")\]$/.exec(finding.gap);
    if (necessity) mapping.necessities[JSON.parse(necessity[1]!) as string] = null;
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
  // Decision 3: one issuer for the whole instance; the provider id is the one configured in the target.
  if (providers.length === 1) mapping.oidcProvider = providers[0]!;
  else {
    open.add(
      `oidcProvider: the target has ${providers.length === 0 ? 'no OIDC provider' : `${providers.length} OIDC providers`} configured; give the id of the one the migrated users sign in with (Settings, Sign-in providers)`,
    );
  }
  if (snapshot.users.length > 0) {
    open.add(
      'users: pass --subjects <file> (subject and username, one per line) to run and users; a user without a subject is not migrated (decision 12)',
    );
  }
  mapping.open = [...open].sort();
  return mapping;
}

async function writeNew(path: string, content: string, what: string): Promise<void> {
  await writeFile(path, content, { mode: 0o600, flag: 'wx' }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST')
        throw new RefusedPath(`The ${what} ${path} exists; give a new path.`);
      throw error;
    },
  );
}

export async function planCommand(args: string[], { env, io, now }: CliDeps): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { out: { type: 'string' }, subjects: { type: 'string' } },
    strict: true,
  });
  const [dir, ...extra] = positionals;
  if (!dir || !values.out || extra.length > 0) {
    io.err('plan needs one snapshot directory and --out <mapping.json>.');
    return 2;
  }
  const out = refuseInsideRepository(values.out, 'The mapping file');
  const snapshot = await readSnapshot(dir);
  const subjects = values.subjects ? await readSubjects(values.subjects) : noSubjects();
  // Named first, so an operator sees which database a .env or the shell pointed to.
  const database = describeDatabase(env.DATABASE_URL ?? '');
  io.err(`Target database: ${database}`);
  const target = await openTarget(env);
  try {
    const facts = await factsOf(target);
    const kpiFacts = await kpiFactsOf(target);
    const providers = await configuredProviders(target);
    const suggested = workaroundSuggestions(snapshot);
    const plans = buildPlans({
      snapshot,
      mapping: suggested.mapping,
      subjects,
      facts,
      kpiFacts,
      providers,
      now: now?.() ?? new Date(),
    });
    const mapping = firstMapping(snapshot, plans.findings, facts, suggested, providers);
    await writeNew(out, `${JSON.stringify(mapping, null, 2)}\n`, 'mapping file');
    io.out(`Mapping written to ${out}: ${mapping.open.length} open line(s) to decide.`);
    return 0;
  } finally {
    await target.stop();
  }
}

const countLine = (kind: string, c: Report['counts'][Kind], dry: boolean) =>
  `${kind}: ${c.read} read, ${c.created} ${dry ? 'would be created' : 'created'}, ${c.kept} kept, ` +
  `${c.changed} ${dry ? 'would change' : 'changed'}, ${c.merged} merged, ${c.dropped} dropped`;

export async function runCommand(args: string[], { env, io, now }: CliDeps): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      mapping: { type: 'string' },
      report: { type: 'string' },
      subjects: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      'keep-account': { type: 'boolean', default: false },
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
  const subjects = values.subjects ? await readSubjects(values.subjects) : noSubjects();

  // Named first, so an operator sees which database a .env or the shell pointed to.
  const database = describeDatabase(env.DATABASE_URL ?? '');
  io.err(`Target database: ${database}`);
  const target = await openTarget(env);
  try {
    const plans = buildPlans({
      snapshot,
      mapping,
      subjects,
      facts: await factsOf(target),
      kpiFacts: await kpiFactsOf(target),
      providers: await configuredProviders(target),
      now: clock(),
    });
    const { registry, kpis, people, measurements } = plans;
    const state = await targetState(target, {
      providers: registry.providers.map((p) => p.abbreviation),
      services: registry.services.map((s) => s.slug),
    });
    if (!dryRun && !values.yes) {
      io.err(
        `This run writes to ${database}, which is ${state.empty ? 'empty' : `not empty (${state.notes.join('; ')})`}. ` +
          'Records that exist are kept or updated by their abbreviation, slug and subject. Run it with --dry-run first; pass --yes to write.',
      );
      return 2;
    }
    if (!state.empty) io.err(`The target is not empty: ${state.notes.join('; ')}.`);
    if (!dryRun && plans.blocking.length > 0) {
      io.err(
        `Stopped before writing anything: ${plans.blocking.length} gap(s) in the mapping stop a run that writes:\n` +
          plans.blocking
            .slice(0, 20)
            .map((finding) => `  ${finding.gap ?? finding.legacy}: ${finding.detail}`)
            .join('\n') +
          (plans.blocking.length > 20 ? `\n  … and ${plans.blocking.length - 20} more` : '') +
          '\nFill them in the mapping (pnpm migrate-legacy plan writes the gaps) and run again.',
      );
      return 1;
    }

    const account = await migrationAccount(target, { create: !dryRun });
    const results: RecordResult[] = [];
    let findings: Finding[] = [...plans.findings];
    let stopped: string | undefined;
    const notes: string[] = [];
    // One stage: its results and findings join the run's, whether it finished or was stopped by a refusal of the account.
    async function stage<T extends { results: RecordResult[]; findings: Finding[] }>(
      work: () => Promise<T>,
    ): Promise<T | undefined> {
      try {
        const done = await work();
        results.push(...done.results);
        findings = [...findings, ...done.findings.filter((f) => !plans.findings.includes(f))];
        return done;
      } catch (error) {
        if (!(error instanceof RunStopped)) throw error;
        results.push(...error.results);
        findings = [...findings, ...error.findings];
        stopped = error.message;
        return undefined;
      }
    }

    const actor = account.actor;
    const registryLoad = await stage(() => loadRegistry(registry, target, { dryRun, actor }));
    const kpiLoad = registryLoad
      ? await stage(() => loadKpis(kpis, target, { dryRun, actor }))
      : undefined;
    const peopleLoad = kpiLoad
      ? await stage(() =>
          loadUsers(people, { ...target, db: target.kernel.db }, { dryRun }).then(
            (loaded) => loaded,
          ),
        )
      : undefined;
    const membershipLoad = peopleLoad
      ? await stage(() =>
          loadMemberships(people, target, {
            dryRun,
            actor,
            users: peopleLoad.users,
            refusedProviders: new Set(
              results
                .filter(
                  (r) => r.kind === 'provider' && r.outcome === 'dropped' && r.target !== null,
                )
                .map((r) => r.target!),
            ),
          }),
        )
      : undefined;
    if (membershipLoad) {
      const written = results.some(
        (r) => r.kind === 'membership' && r.outcome !== 'kept' && r.outcome !== 'dropped',
      );
      if (!dryRun && written) {
        notes.push(
          'Memberships were requested and decided through the services, which queue mails and inbox items (to the administrators and managers for a request, to the user for a decision). The tool starts no worker: they are sent when the instance runs. Keep the mail transport at "none" until the announcement (runbook).',
        );
      }
    }
    if (membershipLoad) {
      const migratedSlugs = new Map(
        registry.services
          .filter((op) =>
            results.some(
              (r) => r.kind === 'service' && r.legacy === op.legacy && r.outcome !== 'dropped',
            ),
          )
          .map((op) => [op.legacy, op.slug] as const),
      );
      await stage(() =>
        loadMeasurements(
          measurements,
          migratedSlugs,
          kpiLoad!.indicatorIds,
          kpis.unavailable,
          target,
          { dryRun, actor },
        ),
      );
    }

    let after: string;
    if (dryRun)
      after = account.state === 'found' ? 'found; a dry run leaves it as it is' : 'not created';
    else if (stopped) after = 'left as it is (the run stopped)';
    else if (values['keep-account']) after = 'kept (--keep-account)';
    else {
      after = await endAccount(target, actor!);
      if (after !== 'deactivated') notes.push(`The account ${account.username} is ${after}.`);
    }
    if (snapshot.users.length > 0 && !values.subjects) {
      notes.push(
        'No --subjects file: no user was migrated (decision 12), and so no role and no membership.',
      );
    }

    const records = buildRecords(results, findings);
    const read: Partial<Record<Kind, number>> = {
      ...registry.read,
      ...kpis.read,
      ...people.read,
      measurement: measurements.services.reduce((n, service) => n + service.points.read, 0),
    };
    const report: Report = {
      format: REPORT_FORMAT,
      mode: dryRun ? 'dry-run' : 'run',
      startedAt,
      finishedAt: clock().toISOString(),
      ...(stopped ? { stopped } : {}),
      snapshot: snapshotSummary(snapshot.manifest),
      mapping: { file: values.mapping, open: mapping.open.length },
      account: { username: account.username, state: account.state, after },
      notes,
      target: { database, ...state },
      counts: countRecords(read, records),
      records,
    };
    await writeReport(reportDir, report);
    for (const kind of KINDS) io.out(countLine(kind, report.counts[kind], dryRun));
    for (const note of notes) io.err(`Note: ${note}`);
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

/**
 * `users <snapshot> --mapping <file> --subjects <file> --out <file>`: the users the target holds from this snapshot, with the
 * address each has there, one `username<TAB>address` per line, for the mail that announces the move. A user is listed only
 * when the target has an account with their identity, so a user that was refused is not mailed about a login that cannot work.
 * The file holds personal data: mode 0600, outside the repository, never over an existing one. No address is printed.
 */
export async function usersCommand(args: string[], { env, io, now }: CliDeps): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      mapping: { type: 'string' },
      subjects: { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  });
  const [dir, ...extra] = positionals;
  if (!dir || !values.mapping || !values.subjects || !values.out || extra.length > 0) {
    io.err(
      'users needs one snapshot directory, --mapping <file>, --subjects <file> and --out <file>.',
    );
    return 2;
  }
  const out = refuseInsideRepository(values.out, 'The users file');
  const snapshot = await readSnapshot(dir);
  const mapping = await readMapping(values.mapping);
  const subjects = await readSubjects(values.subjects);
  io.err(`Target database: ${describeDatabase(env.DATABASE_URL ?? '')}`);
  const target = await openTarget(env);
  try {
    const providers = await configuredProviders(target);
    const plans = buildPlans({
      snapshot,
      mapping,
      subjects,
      facts: await factsOf(target),
      kpiFacts: await kpiFactsOf(target),
      providers,
      now: now?.() ?? new Date(),
    });
    const lines: string[] = [];
    let missing = 0;
    for (const op of plans.people.users) {
      const found = await target.identity.users.findByIdentityAsSystem(op.provider, op.subject);
      if (!found || found.email === null) {
        missing += 1;
        continue;
      }
      lines.push(`${found.username}\t${found.email}`);
    }
    await writeNew(out, `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`, 'users file');
    const notMigrated = plans.people.read.user - plans.people.users.length;
    io.out(
      `Users written to ${out}: ${lines.length} migrated user(s) with their address` +
        `${missing > 0 ? `; ${missing} planned user(s) are not in the target (run first)` : ''}` +
        `${notMigrated > 0 ? `; ${notMigrated} legacy user(s) are not migrated (see the report)` : ''}.`,
    );
    return 0;
  } finally {
    await target.stop();
  }
}
