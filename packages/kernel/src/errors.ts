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
