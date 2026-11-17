// The command line of the migration tool: `pnpm migrate-legacy <command>`. Tests call `runCli` with their own
// environment, output and `fetch`; `cli.ts` at the package root wires it to the process.
import { parseArgs } from 'node:util';
import { discover, discoveryMarkdown } from './discover.ts';
import { fetchSnapshot } from './fetch.ts';
import { RefusedPath, refuseInsideRepository } from './files.ts';
import { createLegacyClient, LegacyApiError } from './http.ts';
import { readSnapshot, SnapshotError } from './snapshot.ts';

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

The snapshot holds personal data: it is written with mode 0600, never inside the repository.
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
      error instanceof RefusedPath
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
