// The `scorpion` command line. Run it as `pnpm scorpion <command>`, or as
// `node apps/server/src/cli.ts <command>` in the image.
import { parseArgs } from 'node:util';
import {
  createLogger,
  KernelStartupError,
  loadConfig,
  type Config,
  type Logger,
} from '@scorpion/kernel';
import { terminalIo } from './cli-io.ts';
import { moduleIds, profileName, sources } from './generated/profile.ts';
import { generateProfile } from './profile-generate.ts';
import {
  migrate,
  profileMismatch,
  runModuleCommand,
  startServer,
  startWorker,
  type RuntimeOptions,
} from './runtime.ts';

/** The commands the modules of this build contribute, for the usage text. */
function moduleCommandLines(): string {
  const lines = sources.flatMap(({ manifest }) =>
    (manifest.commands ?? []).map((command) => ({
      usage: command.usage ?? command.name,
      description: command.description,
    })),
  );
  return lines.map(({ usage, description }) => `  ${usage}\n      ${description}\n`).join('');
}

const USAGE = () => `Usage: scorpion <command>

Commands:
  start                      Run the web server (and, with WORKER_MODE=inline, the workers).
  worker                     Run jobs and the event dispatcher only, without HTTP.
  migrate                    Apply pending migrations of every module and exit.
  profile:generate <name> [--check] [--profile-file <path>] [--modules-root <dir>]...
                             Write apps/server/src/generated/profile.ts for a profile (build time).

${moduleCommandLines()}
Environment: DATABASE_URL (required), SECRETS_KEY (required by profiles with core.settings; generate with
openssl rand -base64 32), SECRETS_KEY_NEXT (only while rotating secrets), PROFILE, PORT, BASE_PATH,
LOG_LEVEL, WORKER_MODE (inline | separate), ORIGIN. See .env.example.
`;

async function profileGenerate(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      check: { type: 'boolean', default: false },
      'profile-file': { type: 'string' },
      'modules-root': { type: 'string', multiple: true },
    },
  });
  const [name, ...extra] = positionals;
  if (!name || extra.length > 0) {
    console.error('profile:generate needs exactly one profile name');
    return 2;
  }
  const result = await generateProfile({
    profileName: name,
    root: process.cwd(),
    profileFile: values['profile-file'],
    moduleRoots: values['modules-root'],
    check: values.check,
  });
  if (values.check) {
    if (result.changed.length > 0) {
      console.error(
        `Out of date: ${result.changed.join(', ')}. Run: pnpm scorpion profile:generate ${name}`,
      );
      return 1;
    }
    return 0;
  }
  console.log(
    `profile ${name}: ${result.packageNames.length} module(s)` +
      (result.changed.length > 0 ? `; wrote ${result.changed.join(', ')}` : '; up to date'),
  );
  return 0;
}

/** Config from the environment; PROFILE defaults to the profile this build was made for. */
function runtimeOptions(): RuntimeOptions & { config: Config; log: Logger } {
  const config = loadConfig({ PROFILE: profileName, ...process.env });
  const profile = { name: profileName, modules: moduleIds };
  const mismatch = profileMismatch(config, profile);
  if (mismatch) throw new KernelStartupError('Wrong profile:', [mismatch]);
  return { config, log: createLogger({ level: config.LOG_LEVEL }), profile, sources };
}

/** Runs until SIGINT or SIGTERM, then shuts down gracefully. Returns the exit code. */
async function untilSignal(
  running: { ready: Promise<void>; stop(): Promise<void> },
  log: Logger,
): Promise<number> {
  let code = 0;
  const stopped = new Promise<void>((resolve) => {
    const shutdown = (signal: string) => {
      log.info({ signal }, 'signal received');
      resolve();
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
    running.ready.catch((error: unknown) => {
      log.fatal({ err: error }, 'start-up failed');
      // A start-up error carries the complete list of what to fix; show it as plain text too.
      if (error instanceof KernelStartupError) console.error(error.message);
      code = 1;
      resolve();
    });
  });
  await stopped;
  await running.stop();
  return code;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  switch (command) {
    case 'profile:generate':
      return profileGenerate(args);
    case 'start': {
      const options = runtimeOptions();
      return untilSignal(startServer(options), options.log);
    }
    case 'worker': {
      const options = runtimeOptions();
      return untilSignal(startWorker(options), options.log);
    }
    case 'migrate': {
      const options = runtimeOptions();
      const report = await migrate(options);
      const applied = Object.entries(report.applied);
      console.log(
        applied.length === 0
          ? 'Nothing to migrate: the database is up to date.'
          : applied.map(([module, count]) => `${module}: ${count} migration(s) applied`).join('\n'),
      );
      return 0;
    }
    default: {
      // A command a module of this build contributes, if there is one by that name.
      const contributed = sources.some(({ manifest }) =>
        (manifest.commands ?? []).some((candidate) => candidate.name === command),
      );
      if (command && contributed) {
        const options = runtimeOptions();
        const io = terminalIo({
          stdin: process.stdin,
          stdout: process.stdout,
          stderr: process.stderr,
        });
        return runModuleCommand(options, command, args, io);
      }
      console.error(command ? `Unknown command "${command}"\n\n${USAGE()}` : USAGE());
      return 2;
    }
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof KernelStartupError) console.error(error.message);
  else console.error(error);
  process.exitCode = 1;
}
