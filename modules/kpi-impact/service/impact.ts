// The service of kpi.impact (M12 sprint 1): the consortia a Reviewer can pick and the live tiles of one. Everything is read through the public
// surface of other modules; the module owns no table yet. The plain permission is checked here as well as on the route.
import { Invalid, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import type { AggregateEntry } from '@scorpion/kpi-analytics/public';
import { AGGREGATE_VOCABULARY, type KpiFrameworkPublic } from '@scorpion/kpi-framework/public';
import type { KpiIngestionPublic } from '@scorpion/kpi-ingestion/public';
import { CONSORTIUM_TYPE, type OrganisationsPublic } from '@scorpion/registry-organisations/public';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { z } from 'zod';
import { PERMISSION_READ } from './permissions.ts';
import { computeRow, type ImpactRow } from './rows.ts';
import { countTiles, STAGE_VOCABULARY, type Tiles } from './tiles.ts';

export interface ConsortiumView {
  id: string;
  name: string;
  abbreviation: string;
}

export interface SummaryQuery {
  consortium: string;
  /** Count the unpublished services too. Default `false`. */
  includeUnpublished?: boolean | undefined;
  /** The language of the stage labels. Default `en`. */
  locale?: string | undefined;
}

export interface TableQuery {
  consortium: string;
  /** A calendar year, one of `YEARS_OFFERED` ending with the current one. */
  year: string;
  includeUnpublished?: boolean | undefined;
  /** 0-based; default 0. */
  page?: number | undefined;
  /** Default `DEFAULT_TABLE_PAGE_SIZE`, at most `MAX_TABLE_PAGE_SIZE`. */
  pageSize?: number | undefined;
  /** The language of the aggregate labels. Default `en`. */
  locale?: string | undefined;
}

export interface TableView {
  year: number;
  /** The years the page offers: the current year and the nine before it, newest first. */
  years: number[];
  /** The services counted (the filter applied, before paging). */
  totalCount: number;
  page: number;
  pageSize: number;
  rows: ImpactRow[];
}

/** The years offered: the current one and the nine before it. */
export const YEARS_OFFERED = 10;
export const DEFAULT_TABLE_PAGE_SIZE = 50;
export const MAX_TABLE_PAGE_SIZE = 200;
/** Services whose rows are computed at once (each is an evaluation read and a series read). */
const ROW_CONCURRENCY = 8;

export interface ImpactDeps {
  authz: Pick<AuthzService, 'require'>;
  settings: Pick<SettingsService, 'listTerms'>;
  organisations: Pick<OrganisationsPublic, 'findByIdsAsSystem' | 'listConsortiaAsSystem'>;
  services: Pick<ServicesPublic, 'listImpactRowsAsSystem' | 'findLicencesAsSystem'>;
  kpi: Pick<KpiFrameworkPublic, 'evaluationOfServiceAsSystem' | 'findValueType'>;
  reads: Pick<KpiIngestionPublic['reads'], 'seriesAsSystem'>;
  /** The entries of the registry `analytics.aggregate` by id. */
  aggregates: ReadonlyMap<string, Pick<AggregateEntry, 'apply'>>;
  /** "Now", for the current year. Tests inject a fixed one. */
  clock: () => Date;
  /** Told when the row of one service could not be computed (its error, for the log; never shown). */
  onRowError?: ((error: unknown, serviceId: string) => void) | undefined;
}

export interface ImpactService {
  /** Needs `kpi.impact.read`. The consortia the picker offers, by name then id. */
  consortia(actor: Actor): Promise<ConsortiumView[]>;
  /**
   * Needs `kpi.impact.read`. The tiles of one consortium, counted live. `Invalid` (422) naming `consortium` for an id that is no id, names no
   * organisation or names one that is not a consortium (and for a consortium of more than 2,000 services).
   */
  summary(actor: Actor, query: SummaryQuery): Promise<Tiles>;
  /**
   * Needs `kpi.impact.read`. The yearly table of one consortium for one calendar year, computed live: a page of services (by name without case,
   * then id), each with its state and twelve months of the headline KPI. `Invalid` (422) naming `consortium` or `year`. The current evaluation
   * applies to every year. A failure of one service is its `error` row; it never fails the page.
   */
  table(actor: Actor, query: TableQuery): Promise<TableView>;
}

export function createImpactService(deps: ImpactDeps): ImpactService {
  const uuid = z.uuid();

  /** The consortium or the 422 naming `consortium`, then its rows (the read names its own parameter; this caller's is `consortium`). */
  async function consortiumRows(consortium: string) {
    const notAConsortium = new Invalid('The request is not valid.', [
      { in: 'query', path: 'consortium', message: 'This is not a known consortium.' },
    ]);
    if (!uuid.safeParse(consortium).success) throw notAConsortium;
    const [found] = await deps.organisations.findByIdsAsSystem([consortium]);
    if (found?.type !== CONSORTIUM_TYPE) throw notAConsortium;
    return deps.services.listImpactRowsAsSystem(consortium).catch((error: unknown) => {
      if (error instanceof Invalid) throw new Invalid(error.message, notAConsortium.errors);
      throw error;
    });
  }

  return {
    async consortia(actor) {
      await deps.authz.require(actor, PERMISSION_READ);
      return deps.organisations.listConsortiaAsSystem();
    },

    async summary(actor, { consortium, includeUnpublished = false, locale = 'en' }) {
      await deps.authz.require(actor, PERMISSION_READ);
      const rows = await consortiumRows(consortium);
      const terms = await deps.settings.listTerms(STAGE_VOCABULARY, {
        includeInactive: true,
        locale,
      });
      const licences = await deps.services.findLicencesAsSystem(
        rows.flatMap((row) => (row.license === null ? [] : [row.license])),
      );
      return countTiles({
        rows,
        terms: terms.map(({ key, label, active }) => ({ key, label, active })),
        licences,
        includeUnpublished,
      });
    },

    async table(
      actor,
      {
        consortium,
        year: yearText,
        includeUnpublished = false,
        page = 0,
        pageSize = DEFAULT_TABLE_PAGE_SIZE,
        locale = 'en',
      },
    ) {
      await deps.authz.require(actor, PERMISSION_READ);
      const rows = await consortiumRows(consortium);
      const current = deps.clock().getUTCFullYear();
      const years = Array.from({ length: YEARS_OFFERED }, (_, index) => current - index);
      const year = /^\d{4}$/.test(yearText) ? Number(yearText) : NaN;
      if (!years.includes(year))
        throw new Invalid('The request is not valid.', [
          {
            in: 'query',
            path: 'year',
            message: `The year must be one of ${years[years.length - 1]} to ${current}.`,
          },
        ]);
      const size = Math.min(Math.max(Math.trunc(pageSize), 1), MAX_TABLE_PAGE_SIZE);
      const first = Math.max(Math.trunc(page), 0) * size;

      // The rows come in the order of the read: name without case, then id. A service of the consortium counts once, however many consortia it has.
      const counted = rows.filter((row) => row.published || includeUnpublished);
      const slice = counted.slice(first, first + size);
      const terms = await deps.settings.listTerms(AGGREGATE_VOCABULARY, {
        includeInactive: true,
        locale,
      });
      const labels = new Map(terms.map((term) => [term.key, term.label]));
      const rowDeps = {
        evaluationOf: (serviceId: string) => deps.kpi.evaluationOfServiceAsSystem(serviceId),
        valueType: (id: string) => deps.kpi.findValueType(id),
        aggregate: (id: string) => deps.aggregates.get(id)?.apply,
        aggregateLabel: (id: string) => labels.get(id) ?? id,
        locale,
        series: deps.reads.seriesAsSystem,
        onError: deps.onRowError,
      };
      const computed: ImpactRow[] = [];
      for (let at = 0; at < slice.length; at += ROW_CONCURRENCY)
        computed.push(
          ...(await Promise.all(
            slice.slice(at, at + ROW_CONCURRENCY).map((row) => computeRow(rowDeps, row, year)),
          )),
        );
      return {
        year,
        years,
        totalCount: counted.length,
        page: first / size,
        pageSize: size,
        rows: computed,
      };
    },
  };
}
