// The shapes of what the page reads, taken from the generated types of the typed client, so a change of a route shows up here.
import type { paths } from '@scorpion/contracts/client';

type Answer<Path extends keyof paths> = paths[Path] extends {
  get: { responses: { 200: { content: { 'application/json': infer Body } } } };
}
  ? Body
  : never;

export type Consortium = Answer<'/kpi/impact/consortia'>['result'][number];
export type Summary = Answer<'/kpi/impact/summary'>;
export type StageLine = Summary['stages'][number];
export type TableAnswer = Answer<'/kpi/impact/table'>;
export type TableRow = TableAnswer['result'][number];
