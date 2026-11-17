// What the impact page needs before it renders. It runs on the server, after the permission check, and **throws** when it cannot get its data
// (defect 12). It reads the consortia of the picker and the words of the unit vocabulary, and nothing else: the figures are read by the page when a
// consortium is chosen (two reads, the tiles and the table), when the year or the switch changes, and when the page of the table does. The years the
// select offers come from the server's clock, as the table route's do; the first answer of the table replaces them.
import type { UiLoadContext } from '@scorpion/contracts';
import { unwrap } from '@scorpion/contracts/client';
import { parseEvaluateQuery } from './query.ts';

/** How many years the select offers (the table route's `YEARS_OFFERED`; a test checks that the two agree). */
export const YEARS_SHOWN = 10;

export async function loadEvaluate({ api, url }: UiLoadContext) {
  const query = parseEvaluateQuery(url.searchParams);
  const [consortia, units] = await Promise.all([
    unwrap(api.GET('/kpi/impact/consortia')),
    unwrap(
      api.GET('/vocabularies/{vocabulary}/terms', {
        params: { path: { vocabulary: 'kpi.unit' }, query: { page: '0', pageSize: '500' } },
      }),
    ),
  ]);
  const current = new Date().getUTCFullYear();
  return {
    query,
    consortia: consortia.result,
    units: units.result,
    years: Array.from({ length: YEARS_SHOWN }, (_, index) => current - index),
  };
}
export type EvaluateData = Awaited<ReturnType<typeof loadEvaluate>>;
