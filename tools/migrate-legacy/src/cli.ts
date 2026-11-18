// The command line of the migration tool: `pnpm migrate-legacy <command>`. Tests call `runCli` with their own
// environment, output and `fetch`; `cli.ts` at the package root wires it to the process.
import { parseArgs } from 'node:util';
import { discover, discoveryMarkdown } from './discover.ts';
import { fetchSnapshot } from './fetch.ts';
import { RefusedPath, refuseInsideRepository } from './files.ts';
import { createLegacyClient, LegacyApiError } from './http.ts';
import { KernelStartupError } from '@scorpion/kernel';
import { MappingError } from './mapping.ts';
import { compareCommand, planCommand, runCommand, usersCommand } from './commands.ts';
import { readSnapshot, SnapshotError } from './snapshot.ts';
import { TargetError } from './target.ts';

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export interface CliDeps {
  env: Readonly<Record<string, string | undefined>>;
  io: CliIo;
  /** For tests: the HTTP client's fetch and the wait between attempts. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export const KEY_VARIABLE = 'LEGACY_API_KEY';

export const USAGE = `Usage: pnpm migrate-legacy <command>

Commands:
  fetch --from <legacy base URL> --out <dir>
      Read the legacy REST API into a new snapshot directory (GET requests only). The API key of a legacy
      administrator comes from the environment variable ${KEY_VARIABLE}, never from an argument.
  discover <snapshot> [--measurements <S3 backup dir>] [--json]
      Summarise a snapshot: counts, spellings, and what the new rules refuse. Names no person.
  plan <snapshot> --out <mapping.json>
      Write a first mapping file with every gap marked (null, and a line in "open"). Reads the target's vocabularies.
  run <snapshot> --mapping <file> --report <dir> [--dry-run] [--yes] [--keep-account] [--skip-users]
      Providers, consortia, services, KPIs and KPI sets, users and roles, memberships and measurements, through the
      services as the account legacy-migration. --dry-run writes nothing to the database; a run that writes needs --yes.
      A user becomes an account its owner claims at their first sign-in at the OIDC provider (same verified address,
      the legacy username); everyone gets the role user. The account legacy-migration is deactivated at the end of a
      run; --keep-account leaves it for a rehearsal. --skip-users leaves out users, roles and memberships. Repeating a
      run is safe.
  compare <snapshot> --mapping <file> --report <dir>
      Every value the run writes, per service, KPI and month, against what the target stores; and the records (counts,
      KPI set rows and necessities, each service's set and extras, users and claims, memberships). Reads only. A
      difference is expected (a rule of the transform), reported (a person may have made it after the run) or
      unexplained; exit code 1 when any is unexplained.
  users <snapshot> --mapping <file> --out <file>
      The migrated users (username<TAB>address<TAB>claim<TAB>legacy-admin), for the announcement mail and for granting
      Admin by hand.

plan, run, compare and users need DATABASE_URL (and SECRETS_KEY) of the new instance, migrated (pnpm scorpion migrate); the tool
never migrates. The snapshot and the report hold personal data: mode 0600, never inside the repository.

`;

type Command = (args: string[], deps: CliDeps) => Promise<number>;

const fetchCommand: Command = async (args, { env, io, ...deps }) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { from: { type: 'string' }, out: { type: 'string' } },
    strict: true,
  });
  if (!values.from || !values.out || positionals.length > 0) {
    io.err(`fetch needs --from and --out.\n\n${USAGE}`);
    return 2;
  }
  const key = env[KEY_VARIABLE];
  if (!key) {
    io.err(
      `Set ${KEY_VARIABLE} to the API key of a legacy administrator (it is never an argument).`,
    );
    return 2;
  }
  const out = refuseInsideRepository(values.out, 'The snapshot directory');
  const client = createLegacyClient({
    baseUrl: values.from,
    key,
    fetch: deps.fetch,
    sleep: deps.sleep,
    log: (line) => io.err(line),
  });
  const { counts } = await fetchSnapshot({
    client,
    out,
    now: deps.now,
    progress: (line) => io.err(line),
  });
  io.out(
    `Snapshot written to ${out}: ${counts.providers} providers, ${counts.categories} categories, ` +
      `${counts.services} services (${counts.serviceRows} rows), ${counts.users} users, ` +
      `${counts.membershipRequests} pending requests, ${counts.measurementPoints} measurement points.`,
  );
  return 0;
};

const discoverCommand: Command = async (args, { io, now }) => {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { measurements: { type: 'string' }, json: { type: 'boolean', default: false } },
    strict: true,
  });
  const [dir, ...extra] = positionals;
  if (!dir || extra.length > 0) {
    io.err(`discover needs one snapshot directory.\n\n${USAGE}`);
    return 2;
  }
  const snapshot = await readSnapshot(dir, { measurements: values.measurements });
  const found = discover(snapshot, now?.() ?? new Date());
  io.out(values.json ? JSON.stringify(found, null, 2) : discoveryMarkdown(found));
  return 0;
};

const COMMANDS: Record<string, Command> = {
  fetch: fetchCommand,
  discover: discoverCommand,
  plan: planCommand,
  run: runCommand,
  compare: compareCommand,
  users: usersCommand,
};

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const [name, ...args] = argv;
  const command = name ? COMMANDS[name] : undefined;
  if (!command) {
    const asked = name === undefined || name === '--help' || name === 'help';
    if (asked) deps.io.out(USAGE);
    else deps.io.err(`Unknown command "${name}".\n\n${USAGE}`);
    return asked ? 0 : 2;
  }
  try {
    return await command(args, deps);
  } catch (error) {
    if (
      error instanceof LegacyApiError ||
      error instanceof SnapshotError ||
      error instanceof RefusedPath ||
      error instanceof MappingError ||
      error instanceof TargetError ||
      error instanceof KernelStartupError
    ) {
      deps.io.err(`Stopped: ${error.message}`);
      return 1;
    }
    if (
      error instanceof TypeError &&
      (error as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')
    ) {
      deps.io.err(`${error.message}\n\n${USAGE}`);
      return 2;
    }
    throw error;
  }
}
