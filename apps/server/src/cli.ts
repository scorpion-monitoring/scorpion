// The `scorpion` command line. Run it as `pnpm scorpion <command>`.
import { parseArgs } from 'node:util';
import { KernelStartupError } from '@scorpion/kernel';
import { generateProfile } from './profile-generate.ts';

const USAGE = `Usage: scorpion <command>

Commands:
  profile:generate <name> [--check] [--profile-file <path>] [--modules-root <dir>]...
      Write apps/server/src/generated/profile.ts for a profile (build time).
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
  const [profileName, ...extra] = positionals;
  if (!profileName || extra.length > 0) {
    console.error('profile:generate needs exactly one profile name');
    return 2;
  }
  const result = await generateProfile({
    profileName,
    root: process.cwd(),
    profileFile: values['profile-file'],
    moduleRoots: values['modules-root'],
    check: values.check,
  });
  if (values.check) {
    if (result.changed.length > 0) {
      console.error(
        `Out of date: ${result.changed.join(', ')}. Run: pnpm scorpion profile:generate ${profileName}`,
      );
      return 1;
    }
    return 0;
  }
  console.log(
    `profile ${profileName}: ${result.packageNames.length} module(s)` +
      (result.changed.length > 0 ? `; wrote ${result.changed.join(', ')}` : '; up to date'),
  );
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  switch (command) {
    case 'profile:generate':
      return profileGenerate(args);
    default:
      console.error(command ? `Unknown command "${command}"\n\n${USAGE}` : USAGE);
      return 2;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof KernelStartupError) console.error(error.message);
  else console.error(error);
  process.exitCode = 1;
}
