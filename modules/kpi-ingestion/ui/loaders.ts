// What the Data Submission page needs before it renders. It runs on the server, after the permission check, and **throws** when it cannot get
// its data (defect 12): a person with no right to the service in the address, or a service that does not exist, gets the error page of the
// shell, not a half page. The browser sends nothing itself on arrival: the picker's list, the months with their coverage, the grid of the
// chosen month, the history, the adapters and the words of the vocabularies are all read here. The month list comes from the coverage, whose
// last month is the current one by the server's clock.
import type { UiLoadContext } from '@scorpion/contracts';
import { unwrap } from '@scorpion/contracts/client';
import { chooseMonth, offeredMonths } from './months.ts';
import { parseSubmitQuery } from './query.ts';
import type { CoverageMonth } from './types.ts';

type Api = UiLoadContext['api'];

/** How many months the month list reaches back (the coverage read's maximum); the history shows the last twelve of them. */
export const MONTHS_OFFERED = 36;
export const COVERAGE_SHOWN = 12;

const terms = async (api: Api, vocabulary: string) =>
  (
    await unwrap(
      api.GET('/vocabularies/{vocabulary}/terms', {
        params: { path: { vocabulary }, query: { page: '0', pageSize: '500' } },
      }),
    )
  ).result;

export async function loadSubmit({ api, url }: UiLoadContext) {
  const query = parseSubmitQuery(url.searchParams);
  const picker = unwrap(
    api.GET('/kpi/ingestion/services', { params: { query: query.q ? { q: query.q } : {} } }),
  );
  if (!query.service) return { query, services: (await picker).result, selected: undefined };

  const service = query.service;
  const [services, record, coverage, runs, adapters, necessity, units, types] = await Promise.all([
    picker,
    unwrap(api.GET('/services/{id}', { params: { path: { id: service } } })),
    unwrap(
      api.GET('/kpi/measurements/coverage', {
        params: { query: { service, months: String(MONTHS_OFFERED) } },
      }),
    ),
    unwrap(api.GET('/kpi/ingestion/runs', { params: { query: { service } } })),
    unwrap(api.GET('/kpi/ingestion/adapters')),
    terms(api, 'necessity'),
    terms(api, 'kpi.unit'),
    unwrap(api.GET('/kpi/value-types')),
  ]);
  const months = offeredMonths(coverage.result);
  const period = chooseMonth(query.period, months);
  const grid = period
    ? (
        await unwrap(
          api.GET('/kpi/measurements', {
            params: { query: { service, period, page: '0', pageSize: '500' } },
          }),
        )
      ).result
    : [];
  const recent: CoverageMonth[] = coverage.result.slice(-COVERAGE_SHOWN);
  return {
    query,
    services: services.result,
    selected: {
      service: { id: record.id, slug: record.slug, name: record.name },
      months,
      period: period ?? '',
      grid,
      coverage: recent,
      runs: runs.result,
      adapters: adapters.result,
      necessity,
      units,
      types: types.result,
    },
  };
}
export type SubmitData = Awaited<ReturnType<typeof loadSubmit>>;
export type SelectedData = NonNullable<SubmitData['selected']>;
