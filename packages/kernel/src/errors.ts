/**
 * Startup cannot continue. Carries every problem found, so an operator fixes them in one go
 * instead of restarting once per problem.
 */
export class KernelStartupError extends Error {
  readonly problems: readonly string[];

  constructor(headline: string, problems: readonly string[]) {
    super(`${headline}\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'KernelStartupError';
    this.problems = problems;
  }
}

/**
 * A demo seed (`scorpion seed --demo`) refused to run, before it wrote anything: the database looks like a real
 * instance, or a module it needs is not in the profile. The message says why and is safe to show.
 */
export class DemoSeedRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoSeedRefused';
  }
}
