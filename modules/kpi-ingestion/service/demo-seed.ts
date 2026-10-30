// The demo seed of kpi.ingestion (`scorpion seed --demo`, ADR-0046): six months of measurements for every demo service and
// each indicator of its KPI set. The values come from a fixed formula, so every instance gets the same numbers and a
// second run changes nothing (`upsertBatch` keys a row by service, indicator and month, defect 6).
import { DemoSeedRefused, type DemoSeedContext, type JobResult } from '@scorpion/kernel';
import type { KpiFrameworkPublic, EffectiveIndicatorRow } from '@scorpion/kpi-framework/public';
import { DEMO_SERVICE_SLUGS, type ServicesPublic } from '@scorpion/registry-services/public';
import type { MeasurementsService } from './measurements.ts';

/** January to June 2026: the last day of each month is what is stored. Fixed, so the documentation shows the same chart. */
export const DEMO_MONTHS = [
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
] as const;

/**
 * A made-up value that the indicator's type and bounds accept. It grows a little with the month and differs by service
 * (`serviceIndex`), so the charts have something to show.
 */
export function demoValue(
  row: Pick<EffectiveIndicatorRow, 'valueType' | 'min' | 'max'>,
  serviceIndex: number,
  monthIndex: number,
): number | string {
  switch (row.valueType) {
    case 'integer':
      return 40 + 25 * serviceIndex + 12 * monthIndex;
    case 'percentage':
      return Math.round((97 + ((serviceIndex + monthIndex) % 4) * 0.8) * 10) / 10;
    case 'float': {
      const min = row.min ?? 0;
      const max = row.max ?? min + 10;
      const share = 0.6 + 0.05 * ((serviceIndex + monthIndex) % 5);
      return Math.round((min + (max - min) * share) * 10) / 10;
    }
    default:
      return 'demo';
  }
}

export interface IngestionDemoDeps {
  measurements: Pick<MeasurementsService, 'upsertBatch'>;
  services: Pick<ServicesPublic, 'findBySlugAsSystem'>;
  kpi: Pick<KpiFrameworkPublic, 'effectiveIndicatorsAsSystem'>;
}

export function createDemoSeed(deps: () => IngestionDemoDeps) {
  return async function demoSeed(_ctx: unknown, demo: DemoSeedContext): Promise<JobResult> {
    const admin = demo.actors.get('admin');
    if (!admin)
      throw new DemoSeedRefused('kpi.ingestion needs the demo accounts of core.identity.');
    const { measurements, services, kpi } = deps();
    let created = 0;
    let updated = 0;
    for (const [serviceIndex, slug] of DEMO_SERVICE_SLUGS.entries()) {
      const service = await services.findBySlugAsSystem(slug);
      if (!service) {
        throw new DemoSeedRefused(
          `kpi.ingestion needs the demo service ${slug}; seed registry.services first.`,
        );
      }
      const effective = await kpi.effectiveIndicatorsAsSystem(service.id);
      const rows = effective.flatMap((indicator) =>
        DEMO_MONTHS.map((period, monthIndex) => ({
          indicator: indicator.indicatorId,
          period,
          value: demoValue(indicator, serviceIndex, monthIndex),
        })),
      );
      if (rows.length === 0) continue;
      const result = await measurements.upsertBatch(admin, service.id, rows, {
        source: 'demo-seed',
      });
      created += result.inserted;
      updated += result.updated;
    }
    return { created, updated };
  };
}
