// A factory for `kpii_measurement` (kpi.ingestion). It inserts a row directly, so a test can set up data of any shape
// without the service layer and can build the cases the service refuses. It knows the column names: a change to the
// schema breaks the integration tests, which is the point. It needs the module's migrations to have run, it does not
// check that the service or the indicator is allowed, and the table's own rules still apply.
import { randomUUID } from 'node:crypto';
import type { Queryable } from './identity.ts';

export interface MakeMeasurement {
  id?: string;
  serviceId: string;
  indicatorId: string;
  /** The last day of a month, `YYYY-MM-DD` (the table checks it). Default `2026-01-31`. */
  period?: string;
  /** Exactly one of the two is stored: a number, or text when `valueText` is given. */
  valueNumeric?: number | string | null;
  valueText?: string | null;
  source?: string;
  runId?: string | null;
  createdBy?: string | null;
}

export interface MeasurementRow {
  id: string;
  service_id: string;
  indicator_id: string;
  /** `YYYY-MM-DD` (the factory formats the `date`, so no time zone gets into it). */
  period: string;
  value_numeric: string | null;
  value_text: string | null;
  source: string;
  run_id: string | null;
  created_by: string | null;
}

export async function makeMeasurement(
  db: Queryable,
  input: MakeMeasurement,
): Promise<MeasurementRow> {
  const text = input.valueText ?? null;
  const numeric = text === null ? (input.valueNumeric ?? 1) : (input.valueNumeric ?? null);
  const { rows } = await db.query<MeasurementRow>(
    `insert into kpii_measurement
       (id, service_id, indicator_id, period, value_numeric, value_text, source, run_id, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
     returning id, service_id, indicator_id, to_char(period, 'YYYY-MM-DD') as period, value_numeric::text, value_text,
       source, run_id, created_by`,
    [
      input.id ?? randomUUID(),
      input.serviceId,
      input.indicatorId,
      input.period ?? '2026-01-31',
      numeric,
      text,
      input.source ?? 'test',
      input.runId ?? null,
      input.createdBy ?? null,
    ],
  );
  return rows[0]!;
}
