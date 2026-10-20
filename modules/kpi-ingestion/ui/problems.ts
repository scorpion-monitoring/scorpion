// What the page says about a problem of a file or a form. The server sends a **code** (`PROBLEM_MESSAGES` is its English); the page has its own
// sentence for every code in every language (`submit.problem.<code>` in `messages.ts`), and a test fails when a code has none. A commit that finds
// anything wrong is a 422 that names the recorded run in its message, so the page reads the codes from that run. Pure.
import { ApiError } from '@scorpion/contracts/client';
import type { Problem, Verdict } from './types.ts';

/** The key of a problem's sentence; the generic one for a code this build has no words for (a newer server). */
export function problemKey(code: string, catalogue: Readonly<Record<string, string>>): string {
  const key = `submit.problem.${code}`;
  return key in catalogue ? key : 'submit.problem.unknown';
}

const RUN_ID = /\brun ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;

/** The id of the run a refused commit recorded, from the message of its 422; `undefined` for any other failure. */
export function refusedRunId(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || error.status !== 422) return undefined;
  const text = [error.problem?.detail, error.problem?.title, error.message].find(
    (candidate) => candidate && RUN_ID.test(candidate),
  );
  return text ? RUN_ID.exec(text)?.[1]?.toLowerCase() : undefined;
}

/** The paths of a 422 that name the request as a whole rather than a cell (`form`, `file`, `serviceId`, `adapter`, `mapping`, `body`). */
export type RequestProblem =
  'noValues' | 'form' | 'file' | 'serviceId' | 'adapter' | 'mapping' | 'other';

/** What a 422 that is not about a cell is about, by the path the server names; `other` when it is none of the known ones. */
export function requestProblemOf(error: unknown): RequestProblem | undefined {
  if (!(error instanceof ApiError) || error.status !== 422) return undefined;
  const first = error.problem?.errors?.[0];
  if (!first) return undefined;
  const path = first.path.replace(/^(body|query|path|header)\./, '');
  if (/^rows\[/.test(path)) return undefined;
  // A file or a form with nothing in it to record (every value blank, or only the template's example row).
  if ((path === 'form' || path === 'file') && /holds no values/.test(first.message))
    return 'noValues';
  if (path === 'form' || path.startsWith('form.')) return 'form';
  if (path === 'file') return 'file';
  if (path === 'serviceId') return 'serviceId';
  if (path === 'adapter') return 'adapter';
  if (path === 'mapping') return 'mapping';
  return 'other';
}

/** The counts of a dry run or a commit, by verdict, from the list of values. */
export function countVerdicts(rows: readonly { verdict: Verdict }[]): Record<Verdict, number> {
  const counts: Record<Verdict, number> = { insert: 0, update: 0, unchanged: 0, reject: 0 };
  for (const row of rows) counts[row.verdict] += 1;
  return counts;
}

/** The problems of one cell of the file (row and column, 1-based). */
export const problemsAt = (problems: readonly Problem[], row: number, column: number): Problem[] =>
  problems.filter((problem) => problem.row === row && problem.column === column);

/** The problems that belong to no cell of the preview table: the file as a whole (row 0), a row's own (column 0), or a row not shown. */
export function problemsOutside(
  problems: readonly Problem[],
  shownRows: readonly number[],
): Problem[] {
  const shown = new Set(shownRows);
  return problems.filter(
    (problem) => problem.row === 0 || problem.column === 0 || !shown.has(problem.row),
  );
}
