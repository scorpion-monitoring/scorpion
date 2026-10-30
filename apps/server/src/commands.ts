// The commands of the `scorpion` CLI that the server itself has (a module adds its own through `commands` in its manifest).
// One table feeds the usage text and `scorpion docs:export`, so the two cannot differ.
import { SEED_USAGE } from './seed.ts';

export interface ServerCommand {
  name: string;
  /** The command as it is typed, with its flags: `seed --demo [--profile <name>]`. */
  usage: string;
  /** What it does, one or two sentences; a line break starts a new line of the usage text. */
  description: string;
}

export const DOCS_EXPORT_USAGE = 'docs:export [--out <dir>] [--zip <file>] [--screenshots <dir>]';

export const SERVER_COMMANDS: readonly ServerCommand[] = [
  {
    name: 'start',
    usage: 'start',
    description: 'Run the web server (and, with WORKER_MODE=inline, the workers).',
  },
  {
    name: 'worker',
    usage: 'worker',
    description: 'Run jobs and the event dispatcher only, without HTTP.',
  },
  {
    name: 'migrate',
    usage: 'migrate',
    description: 'Apply pending migrations of every module and exit.',
  },
  {
    name: 'seed',
    usage: SEED_USAGE,
    description:
      'Fill the modules of this build with fictional demo data. Idempotent; refuses an instance with real accounts.\nDemo passwords: SCORPION_DEMO_PASSWORD, or a random one is shown once.',
  },
  {
    name: 'docs:export',
    usage: DOCS_EXPORT_USAGE,
    description:
      'Build time, in a repository checkout: write the reference data of every module, the env variables, the CLI, the public API and the journeys as JSON (ADR-0047).',
  },
  {
    name: 'profile:generate',
    usage: 'profile:generate <name> [--check] [--profile-file <path>] [--modules-root <dir>]...',
    description: 'Write apps/server/src/generated/profile.ts for a profile (build time).',
  },
];

export interface CliFlag {
  /** `--username` */
  name: string;
  /** The placeholder of its value (`name` of `--username <name>`), or `null` for a switch. */
  value: string | null;
  required: boolean;
}

/**
 * The flags a usage line names: `--out <dir>` is a flag with a value, `--check` a switch; one in square brackets is optional, the others are
 * required. Read from the usage text, so a flag cannot be documented and missing from the help.
 */
export function flagsOf(usage: string): CliFlag[] {
  const flags: CliFlag[] = [];
  for (const match of usage.matchAll(/(\[)?--([a-z][a-z-]*)(?:\s+<([^>]+)>)?/g)) {
    flags.push({
      name: `--${match[2]}`,
      value: match[3] ?? null,
      required: match[1] === undefined,
    });
  }
  return flags;
}

/** The lines of one command in the usage text. */
export function usageLines(command: Pick<ServerCommand, 'usage' | 'description'>): string {
  const [first, ...more] = command.description.split('\n');
  const head =
    command.usage.length < 26
      ? `  ${command.usage.padEnd(26)} ${first}`
      : `  ${command.usage}\n  ${' '.repeat(26)} ${first}`;
  return [head, ...more.map((line) => `  ${' '.repeat(26)} ${line}`)].join('\n');
}
