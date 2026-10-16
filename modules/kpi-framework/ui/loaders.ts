// What the pages of kpi.framework need before they render. They run on the server, after the permission check,
// and **throw** when they cannot get their data (defect 12). The terms of the vocabularies and the value types
// come from the API; no list of them is written here.
import type { UiLoadContext } from '@scorpion/contracts';
import { unwrap } from '@scorpion/contracts/client';
import { indicatorsApiQuery, parseIndicatorsQuery, parseSetsQuery, setsApiQuery } from './query.ts';

type Api = UiLoadContext['api'];

const terms = async (api: Api, vocabulary: string) =>
  (
    await unwrap(
      api.GET('/vocabularies/{vocabulary}/terms', {
        params: { path: { vocabulary }, query: { page: '0', pageSize: '500' } },
      }),
    )
  ).result;

const valueTypes = async (api: Api) => (await unwrap(api.GET('/kpi/value-types'))).result;

/** The vocabularies an indicator names. */
async function indicatorVocabularies(api: Api) {
  const [thematic, units, means, tools, types] = await Promise.all([
    terms(api, 'thematic-category'),
    terms(api, 'kpi.unit'),
    terms(api, 'kpi.measured-by'),
    terms(api, 'kpi.automation-tool'),
    valueTypes(api),
  ]);
  return { thematic, units, means, tools, types };
}

export async function loadIndicators({ api, url }: UiLoadContext) {
  const query = parseIndicatorsQuery(url.searchParams);
  const [answer, thematic, units, types] = await Promise.all([
    unwrap(api.GET('/kpi/indicators', { params: { query: indicatorsApiQuery(query) } })),
    terms(api, 'thematic-category'),
    terms(api, 'kpi.unit'),
    valueTypes(api),
  ]);
  return {
    query,
    indicators: answer.result,
    total: answer.metadata.totalCount,
    thematic,
    units,
    types,
  };
}
export type IndicatorsData = Awaited<ReturnType<typeof loadIndicators>>;

export async function loadIndicator({ api, params }: UiLoadContext) {
  const [indicator, vocabularies] = await Promise.all([
    unwrap(api.GET('/kpi/indicators/{id}', { params: { path: { id: params.id! } } })),
    indicatorVocabularies(api),
  ]);
  return { indicator, ...vocabularies };
}
export type IndicatorData = Awaited<ReturnType<typeof loadIndicator>>;

export async function loadNewIndicator({ api }: UiLoadContext) {
  return { indicator: undefined, ...(await indicatorVocabularies(api)) };
}

export async function loadSets({ api, url }: UiLoadContext) {
  const query = parseSetsQuery(url.searchParams);
  const [answer, categories, necessity] = await Promise.all([
    unwrap(api.GET('/kpi/sets', { params: { query: setsApiQuery(query) } })),
    terms(api, 'kpi.service-category'),
    terms(api, 'necessity'),
  ]);
  return { query, sets: answer.result, total: answer.metadata.totalCount, categories, necessity };
}
export type SetsData = Awaited<ReturnType<typeof loadSets>>;

async function setVocabularies(api: Api) {
  const [categories, necessity, aggregates, types, thematic] = await Promise.all([
    terms(api, 'kpi.service-category'),
    terms(api, 'necessity'),
    terms(api, 'aggregate'),
    valueTypes(api),
    terms(api, 'thematic-category'),
  ]);
  return { categories, necessity, aggregates, types, thematic };
}

export async function loadSet({ api, params }: UiLoadContext) {
  const [set, vocabularies] = await Promise.all([
    unwrap(api.GET('/kpi/sets/{id}', { params: { path: { id: params.id! } } })),
    setVocabularies(api),
  ]);
  return { set, ...vocabularies };
}
export type SetData = Awaited<ReturnType<typeof loadSet>>;

export async function loadNewSet({ api }: UiLoadContext) {
  return { set: undefined, ...(await setVocabularies(api)) };
}
