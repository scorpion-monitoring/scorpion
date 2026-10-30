// `scorpion seed --demo [--profile <name>] [--allow-production]` (ADR-0046): fictional, non-personal data for a
// demonstration, documentation or test instance. The data itself belongs to the modules (`demoSeed` in their manifests);
// this file parses the command line, refuses an instance that looks real, and prints what each module did.
import { parseArgs } from 'node:util';
import { Invalid } from '@scorpion/contracts';
import { DemoSeedRefused, type CommandIo, type Config } from '@scorpion/kernel';
import type { RuntimeOptions } from './runtime.ts';
import { runDemoSeed } from './runtime.ts';

export const SEED_USAGE = 'seed --demo [--profile <name>] [--allow-production]';

/** Names that cannot be a real public instance: this machine, and the reserved test domains (RFC 2606, RFC 6761). */
const NON_PUBLIC_HOST =
  /^(localhost|127\.0\.0\.1|\[::1\]|.*\.(localhost|test|invalid|example|local)|(.*\.)?example\.(org|com|net))$/;

/**
 * Why the origin looks like a real instance, or `undefined`. A production build (`NODE_ENV=production`) on a public
 * host is where a demo seed would add fictional organisations to real data; a person who means it passes the flag.
 */
export function productionOriginProblem(
  config: Pick<Config, 'ORIGIN'>,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (env.NODE_ENV !== 'production') return undefined;
  const host = new URL(config.ORIGIN).hostname.toLowerCase();
  if (NON_PUBLIC_HOST.test(host)) return undefined;
  return `NODE_ENV is "production" and ORIGIN ${config.ORIGIN} is a public address`;
}

export interface SeedDeps {
  options: RuntimeOptions & { config: Config };
  args: readonly string[];
  io: CommandIo;
  env?: Readonly<Record<string, string | undefined>>;
  /** For tests: replaces the kernel run. */
  run?: typeof runDemoSeed;
}

export async function seedCommand({
  options,
  args,
  io,
  env = process.env,
  run = runDemoSeed,
}: SeedDeps): Promise<number> {
  let values: { demo?: boolean; profile?: string; 'allow-production'?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...args],
      options: {
        demo: { type: 'boolean', default: false },
        profile: { type: 'string' },
        'allow-production': { type: 'boolean', default: false },
      },
      strict: true,
    }));
  } catch (error) {
    io.err(`${(error as Error).message}\nUsage: scorpion ${SEED_USAGE}`);
    return 2;
  }
  if (!values.demo) {
    // There is no other kind of seed: nothing here creates an account with a password a person did not choose.
    io.err(`Only demo data exists. Usage: scorpion ${SEED_USAGE}`);
    return 2;
  }
  const profile = options.profile.name;
  if (values.profile !== undefined && values.profile !== profile) {
    io.err(
      `This build is the profile "${profile}", not "${values.profile}". A build holds the modules of one profile; build the image for "${values.profile}".`,
    );
    return 2;
  }
  const allowProduction = values['allow-production'] === true;
  const origin = productionOriginProblem(options.config, env);
  if (origin && !allowProduction) {
    io.err(
      `Refused: ${origin}. A demo seed is for a demonstration or test instance. Pass --allow-production if you mean it.`,
    );
    return 1;
  }
  const password = env.SCORPION_DEMO_PASSWORD === '' ? undefined : env.SCORPION_DEMO_PASSWORD;
  try {
    const reported = await run(options, { password, allowProduction }, io);
    io.out(`Demo data for the profile "${profile}":`);
    for (const [module, counts] of Object.entries(reported)) {
      io.out(
        `  ${module}: ${
          Object.entries(counts)
            .map(([key, value]) => `${value} ${key}`)
            .join(', ') || 'nothing to add'
        }`,
      );
    }
    return 0;
  } catch (error) {
    if (error instanceof DemoSeedRefused) {
      io.err(`Refused: ${error.message}`);
      return 1;
    }
    // The password of the operator broke the rules of core.identity: the fields are named, the value never.
    if (error instanceof Invalid) {
      const problems = error.errors?.map((e) => `  ${e.path}: ${e.message}`).join('\n');
      io.err(
        `Not seeded: SCORPION_DEMO_PASSWORD or an account is not valid.${problems ? `\n${problems}` : ''}`,
      );
      return 1;
    }
    throw error;
  }
}
