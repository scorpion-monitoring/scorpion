// Load for the measurements: each service's batches through `upsertBatch` of kpi.ingestion (the one writer, ADR-0041) with
// the source `legacy-migration`, as the migration account. A batch is all or nothing in the service, so each one is first
// checked with `dryRun` (a bad row is a verdict, not a 422): the rejected rows are reported and left out, and the rest is
// written. `upsertBatch` is idempotent by `(service, indicator, period)`: a second run reports every value as unchanged.
//
// A dry run reads the target. A value it cannot check (the service, the indicator or the migration account does not exist
// yet) is counted as "unchecked" and as one that would be inserted: the rules of the transform (month, 1900, future) were
// applied, the rules of the indicator's value type were not.
import type { UserActor } from '@scorpion/contracts';
import type { KpiFrameworkPublic } from '@scorpion/kpi-framework/public';
import type { KpiIngestionPublic } from '@scorpion/kpi-ingestion/public';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { attemptWith, type RecordResult } from './load.ts';
import type { MeasurementPlan, MeasurementRow } from './measurements.ts';
import type { Finding } from './transform.ts';

/** The `source` of every value this tool writes. */
export const MEASUREMENT_SOURCE = 'legacy-migration';
const LISTED_REJECTIONS = 20;

export interface MeasurementPorts {
  services: Pick<ServicesPublic, 'findBySlugAsSystem'>;
  kpi: Pick<KpiFrameworkPublic, 'effectiveIndicatorsAsSystem'>;
  ingestion: { measurements: Pick<KpiIngestionPublic['measurements'], 'upsertBatch'> };
}

const quote = (value: string) => JSON.stringify(value);

export async function loadMeasurements(
  plan: MeasurementPlan,
  /** Legacy service abbreviation → slug, for the services that are migrated. */
  slugs: ReadonlyMap<string, string>,
  /** Legacy KPI name → id of the indicator in the target (those that exist or were created). */
  indicatorIds: ReadonlyMap<string, string>,
  /** Legacy KPI names that are not migrated. */
  unavailable: ReadonlySet<string>,
  ports: MeasurementPorts,
  options: { dryRun: boolean; actor: UserActor | undefined },
): Promise<{ results: RecordResult[]; findings: Finding[] }> {
  const { dryRun, actor } = options;
  const results: RecordResult[] = [];
  const findings: Finding[] = [];
  const attempt = attemptWith(results, findings);

  for (const service of plan.services) {
    const read = service.points.read;
    const values = {
      read,
      merged: service.points.merged,
      dropped: service.points.dropped,
      filled: service.points.filled,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      rejected: 0,
      unchecked: 0,
    };
    const finish = (outcome: RecordResult['outcome'], target: string | null) =>
      results.push({ kind: 'measurement', legacy: service.service, target, outcome, values });

    const slug = slugs.get(service.service);
    if (slug === undefined) {
      findings.push({
        kind: 'measurement',
        legacy: service.service,
        rule: 'measurement.service-not-migrated',
        effect: 'dropped',
        detail: `the service is not migrated; its ${service.rows} value(s) are dropped`,
      });
      values.dropped += service.rows;
      finish('dropped', null);
      continue;
    }

    // The KPIs this tool could not migrate: their values are dropped.
    const lost = new Map<string, number>();
    const batches = service.batches.map((batch) =>
      batch.filter((row) => {
        if (!unavailable.has(row.kpi)) return true;
        lost.set(row.kpi, (lost.get(row.kpi) ?? 0) + 1);
        return false;
      }),
    );
    for (const [kpi, n] of [...lost].sort(([a], [b]) => (a < b ? -1 : 1))) {
      findings.push({
        kind: 'measurement',
        legacy: service.service,
        rule: 'measurement.indicator-unavailable',
        effect: 'dropped',
        detail: `${n} value(s) of ${quote(kpi)}: the KPI is not migrated`,
      });
      values.dropped += n;
    }

    const record = await ports.services.findBySlugAsSystem(slug);
    const effective =
      record && actor ? await ports.kpi.effectiveIndicatorsAsSystem(record.id) : undefined;
    const inSet = new Set(effective?.map((row) => row.indicatorId) ?? []);
    const rejections: string[] = [];

    for (const batch of batches) {
      if (batch.length === 0) continue;
      // What can be sent to the service: the indicator exists, and (in a dry run) is in the service's effective set.
      const sendable: { row: MeasurementRow; indicator: string }[] = [];
      for (const row of batch) {
        const indicator = indicatorIds.get(row.kpi);
        if (record && actor && indicator !== undefined && (!dryRun || inSet.has(indicator))) {
          sendable.push({ row, indicator });
        } else {
          values.unchecked += 1;
          values.inserted += 1;
        }
      }
      if (sendable.length === 0 || !record || !actor) continue;
      const input = (items: typeof sendable) =>
        items.map(({ row, indicator }) => ({ indicator, period: row.period, value: row.value }));
      const checked = await attempt('measurement', service.service, slug, () =>
        ports.ingestion.measurements.upsertBatch(actor, record.id, input(sendable), {
          source: MEASUREMENT_SOURCE,
          dryRun: true,
        }),
      );
      if (!checked.ok) {
        values.dropped += sendable.length;
        continue;
      }
      const good = sendable.filter((_, index) => checked.value.rows[index]?.verdict !== 'reject');
      checked.value.rows.forEach((verdict, index) => {
        if (verdict.verdict !== 'reject') return;
        const { row } = sendable[index]!;
        values.rejected += 1;
        if (rejections.length < LISTED_REJECTIONS) {
          rejections.push(
            `${quote(row.kpi)} ${row.period}: ${(verdict.problems ?? []).map((p) => p.message).join('; ') || 'refused'}`,
          );
        }
      });
      if (dryRun || good.length === 0) {
        values.inserted += dryRun ? checked.value.inserted : 0;
        values.updated += dryRun ? checked.value.updated : 0;
        values.unchanged += dryRun ? checked.value.unchanged : 0;
        continue;
      }
      const written = await attempt('measurement', service.service, slug, () =>
        ports.ingestion.measurements.upsertBatch(actor, record.id, input(good), {
          source: MEASUREMENT_SOURCE,
        }),
      );
      if (!written.ok) {
        values.dropped += good.length;
        continue;
      }
      values.inserted += written.value.inserted;
      values.updated += written.value.updated;
      values.unchanged += written.value.unchanged;
    }
    if (values.rejected > 0) {
      findings.push({
        kind: 'measurement',
        legacy: service.service,
        rule: 'measurement.rejected',
        effect: 'dropped',
        detail: `${values.rejected} value(s) refused by the service${rejections.length < values.rejected ? ` (first ${rejections.length} listed)` : ''}: ${rejections.join('; ')}`,
      });
    }
    // `attempt` already recorded a dropped result when a batch was refused as a whole; one summary per service otherwise.
    finish(values.inserted > 0 ? 'created' : values.updated > 0 ? 'changed' : 'kept', slug);
  }
  return { results, findings };
}
