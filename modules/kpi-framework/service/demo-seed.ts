// The demo seed of kpi.framework (`scorpion seed --demo`, ADR-0046): five example indicators, one KPI set, and the set on
// every demo service. Written through the module's own services as the demo administrator. The indicators are generic
// metrics of any service; none is taken from a real instance.
import { DemoSeedRefused, type DemoSeedContext, type JobResult } from '@scorpion/kernel';
import type { Actor } from '@scorpion/contracts';
import type { ServicesPublic } from '@scorpion/registry-services/public';
import { DEMO_SERVICE_SLUGS } from '@scorpion/registry-services/public';
import type { CreateIndicatorInput } from './input.ts';
import type { IndicatorsService } from './indicators.ts';
import type { ServiceKpisService } from './service-kpis.ts';
import type { SetsService } from './sets.ts';

/** The slugs of the example indicators, so a seed of another module (the measurements) can name them (`public.ts`). */
export const DEMO_INDICATORS: readonly {
  input: CreateIndicatorInput & { slug: string };
  necessity: string;
}[] = [
  {
    input: {
      slug: 'demo-active-users',
      name: 'Active users',
      description: 'People who used the service at least once in the month.',
      valueType: 'integer',
      unit: 'user',
      min: 0,
      thematic: 'Usage',
    },
    necessity: 'mandatory',
  },
  {
    input: {
      slug: 'demo-requests',
      name: 'Requests',
      description: 'Requests the service answered in the month.',
      valueType: 'integer',
      unit: 'request',
      min: 0,
      thematic: 'Usage',
    },
    necessity: 'recommended',
  },
  {
    input: {
      slug: 'demo-publications',
      name: 'Publications citing the service',
      description: 'Publications that named the service in the month.',
      valueType: 'integer',
      unit: 'publication',
      min: 0,
      thematic: 'Bibliographic',
    },
    necessity: 'recommended',
  },
  {
    input: {
      slug: 'demo-uptime',
      name: 'Uptime',
      description: 'Share of the month in which the service was available.',
      valueType: 'percentage',
      unit: 'percent',
      thematic: 'Technical',
    },
    necessity: 'mandatory',
  },
  {
    input: {
      slug: 'demo-satisfaction',
      name: 'User satisfaction',
      description: 'Mean rating of a user survey, from 1 (poor) to 5 (excellent).',
      valueType: 'float',
      min: 1,
      max: 5,
      thematic: 'Satisfaction',
    },
    necessity: 'optional',
  },
];

export const DEMO_SET = { slug: 'demo-core-kpis', name: 'Demo core KPIs' } as const;

export interface FrameworkDemoDeps {
  indicators: Pick<IndicatorsService, 'create' | 'list'>;
  sets: Pick<SetsService, 'create' | 'list' | 'setIndicators'>;
  serviceKpis: Pick<ServiceKpisService, 'set'>;
  services: Pick<ServicesPublic, 'findBySlugAsSystem'>;
}

export function createDemoSeed(deps: () => FrameworkDemoDeps) {
  return async function demoSeed(_ctx: unknown, demo: DemoSeedContext): Promise<JobResult> {
    const admin = demo.actors.get('admin') as Actor | undefined;
    if (!admin)
      throw new DemoSeedRefused('kpi.framework needs the demo accounts of core.identity.');
    const { indicators, sets, serviceKpis, services } = deps();
    const page = { page: 0, pageSize: 100 };
    let created = 0;
    let existing = 0;

    const known = new Map(
      (await indicators.list(admin, {}, page)).indicators.map((row) => [row.slug, row.id]),
    );
    for (const { input } of DEMO_INDICATORS) {
      if (known.has(input.slug)) existing += 1;
      else {
        known.set(input.slug, (await indicators.create(admin, input)).id);
        created += 1;
      }
    }

    let set = (await sets.list(admin, {}, page)).sets.find((row) => row.slug === DEMO_SET.slug);
    if (set) existing += 1;
    else {
      set = await sets.create(admin, {
        slug: DEMO_SET.slug,
        name: DEMO_SET.name,
        description: 'Five example indicators for the demonstration instance.',
      });
      created += 1;
    }
    // Replacing the rows with the same rows changes nothing, so a second run is quiet.
    await sets.setIndicators(admin, set.id, {
      indicators: DEMO_INDICATORS.map((item) => ({
        indicatorId: known.get(item.input.slug)!,
        necessity: item.necessity,
      })),
    });

    let assigned = 0;
    for (const slug of DEMO_SERVICE_SLUGS) {
      const service = await services.findBySlugAsSystem(slug);
      if (!service) {
        throw new DemoSeedRefused(
          `kpi.framework needs the demo service ${slug}; seed registry.services first.`,
        );
      }
      await serviceKpis.set(admin, service.id, { setId: set.id, extras: [] });
      assigned += 1;
    }
    return { created, existing, 'services with the set': assigned };
  };
}
