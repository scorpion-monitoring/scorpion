// Factories for the tables of `kpi.framework`. They insert rows directly (an indicator, its means and tools, a
// KPI set, its rows and its evaluation), so a test can set up data of any shape without the service layer. They
// know the column names: a change to the schema breaks the integration tests, which is the point. They need the
// module's migrations to have run, and they do not check a term against its vocabulary (the service does).
import { randomUUID } from 'node:crypto';
import type { Queryable } from './identity.ts';

let sequence = 0;
const next = () => ++sequence;

export interface MakeIndicator {
  id?: string;
  /** Default `ind-<n>-<id prefix>`: unique across a run, so specs that share a database do not clash. */
  slug?: string;
  name?: string;
  description?: string | null;
  example?: string | null;
  qualitative?: boolean;
  /** A key of the registry `kpi.valueType`; default `integer` (`text` when `qualitative`). */
  valueType?: string;
  unit?: string | null;
  min?: number | null;
  max?: number | null;
  /** A term of `thematic-category`; default `Usage`. */
  thematic?: string;
  /** Terms of `kpi.measured-by`. */
  measuredBy?: readonly string[];
  /** Terms of `kpi.automation-tool`. */
  canBeAutomatedBy?: readonly string[];
  createdBy?: string | null;
}

export interface IndicatorRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  example: string | null;
  qualitative: boolean;
  value_type: string;
  unit: string | null;
  min_value: string | null;
  max_value: string | null;
  thematic: string;
  created_by: string | null;
}

export async function makeIndicator(
  db: Queryable,
  overrides: MakeIndicator = {},
): Promise<IndicatorRow> {
  const n = next();
  const id = overrides.id ?? randomUUID();
  const qualitative = overrides.qualitative ?? false;
  const { rows } = await db.query<IndicatorRow>(
    `insert into kpif_indicator
       (id, slug, name, description, example, qualitative, value_type, unit, min_value, max_value,
        thematic, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
     returning *`,
    [
      id,
      overrides.slug ?? `ind-${n}-${id.slice(0, 8)}`,
      overrides.name ?? `Indicator ${n} ${id.slice(0, 8)}`,
      overrides.description ?? null,
      overrides.example ?? null,
      qualitative,
      overrides.valueType ?? (qualitative ? 'text' : 'integer'),
      overrides.unit ?? null,
      overrides.min ?? null,
      overrides.max ?? null,
      overrides.thematic ?? 'Usage',
      overrides.createdBy ?? null,
    ],
  );
  for (const key of overrides.measuredBy ?? [])
    await db.query('insert into kpif_indicator_means (indicator_id, term_key) values ($1, $2)', [
      id,
      key,
    ]);
  for (const key of overrides.canBeAutomatedBy ?? [])
    await db.query('insert into kpif_indicator_tool (indicator_id, term_key) values ($1, $2)', [
      id,
      key,
    ]);
  return rows[0]!;
}

export interface MakeKpiSet {
  id?: string;
  slug?: string;
  name?: string;
  description?: string | null;
  /** A key of `kpi.service-category`. */
  rimoCategory?: string | null;
  /** The rows of the set: an indicator id and a term of `necessity`. */
  indicators?: readonly { indicatorId: string; necessity: string }[];
  /** The headline: one of the set's indicators and a term of `aggregate`. */
  evaluation?: { indicatorId: string; aggregate: string };
  createdBy?: string | null;
}

export interface KpiSetRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  rimo_category: string | null;
  created_by: string | null;
}

export async function makeKpiSet(db: Queryable, overrides: MakeKpiSet = {}): Promise<KpiSetRow> {
  const n = next();
  const id = overrides.id ?? randomUUID();
  const { rows } = await db.query<KpiSetRow>(
    `insert into kpif_kpi_set (id, slug, name, description, rimo_category, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $6)
     returning *`,
    [
      id,
      overrides.slug ?? `set-${n}-${id.slice(0, 8)}`,
      overrides.name ?? `KPI set ${n} ${id.slice(0, 8)}`,
      overrides.description ?? null,
      overrides.rimoCategory ?? null,
      overrides.createdBy ?? null,
    ],
  );
  for (const row of overrides.indicators ?? [])
    await db.query(
      'insert into kpif_kpi_set_indicator (set_id, indicator_id, necessity) values ($1, $2, $3)',
      [id, row.indicatorId, row.necessity],
    );
  if (overrides.evaluation)
    await db.query(
      'insert into kpif_evaluation (set_id, indicator_id, aggregate) values ($1, $2, $3)',
      [id, overrides.evaluation.indicatorId, overrides.evaluation.aggregate],
    );
  return rows[0]!;
}

export interface MakeServiceKpis {
  serviceId: string;
  /** The KPI set of the service; none when absent. */
  setId?: string | null;
  /** Indicator ids the service opted into beyond its set. */
  extras?: readonly string[];
  updatedBy?: string | null;
}

/**
 * The link of a service to its KPI set and extra indicators (`kpif_service_set`, `kpif_service_extra_indicator`),
 * inserted directly. It does not check that the service exists (the table holds a plain column) and it does not
 * drop an extra that the set already contains: that is the service layer's rule, so a test can build the odd cases.
 */
export async function makeServiceKpis(db: Queryable, input: MakeServiceKpis): Promise<void> {
  if (input.setId)
    await db.query(
      'insert into kpif_service_set (service_id, set_id, updated_by) values ($1, $2, $3)',
      [input.serviceId, input.setId, input.updatedBy ?? null],
    );
  for (const indicatorId of input.extras ?? [])
    await db.query(
      'insert into kpif_service_extra_indicator (service_id, indicator_id) values ($1, $2)',
      [input.serviceId, indicatorId],
    );
}
