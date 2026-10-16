// What the pages read from a failure beyond the shell's generic words: a delete that something still uses
// (`kpi-in-use`): the module and what it holds, with the count. Pure, so it is unit tested.
import { ApiError } from '@scorpion/contracts/client';

export const KPI_IN_USE = 'kpi-in-use';

export interface UseCount {
  module: string;
  what: string;
  count: number;
}

/** The uses a `kpi-in-use` problem names (`errors`: `usage` / `<module>.<what>` / count); `undefined` for any other failure. */
export function usesOf(error: unknown): UseCount[] | undefined {
  if (!(error instanceof ApiError) || error.status !== 409 || !error.type?.endsWith(KPI_IN_USE))
    return undefined;
  const uses: UseCount[] = [];
  for (const problem of error.problem?.errors ?? []) {
    const dot = problem.path.lastIndexOf('.');
    const count = Number(problem.message);
    if (dot > 0 && Number.isInteger(count) && count >= 0)
      uses.push({ module: problem.path.slice(0, dot), what: problem.path.slice(dot + 1), count });
  }
  return uses;
}
