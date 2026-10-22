// The settings of kpi.analytics: the two limits of the volatility bands. Nothing secret, no wording.
import { z } from '@scorpion/contracts';

export const DEFAULT_LOW = 0.4;
export const DEFAULT_HIGH = 0.8;
/** The largest threshold (500 %); a MAPE above it is "high" whatever the setting. */
export const MAX_THRESHOLD = 5;

const thresholds = z
  .strictObject({
    low: z.number().gt(0).max(MAX_THRESHOLD).default(DEFAULT_LOW).meta({
      title: 'Low volatility below',
      description:
        'A KPI whose values deviate from their mean by less than this fraction (0.4 is 40 %) is shown as low volatility. Greater than 0, at most 5 and below the high limit; a value outside is refused, not corrected.',
    }),
    high: z.number().gt(0).max(MAX_THRESHOLD).default(DEFAULT_HIGH).meta({
      title: 'High volatility from',
      description:
        'A KPI whose values deviate from their mean by this fraction or more is shown as high volatility; between the two limits it is medium. Greater than the low limit and at most 5.',
    }),
  })
  .superRefine((value, ctx) => {
    if (!(value.low < value.high))
      ctx.addIssue({ code: 'custom', path: ['high'], message: 'must be greater than low' });
  });

export const settingsSchema = z.strictObject({
  volatility: z
    .strictObject({
      thresholds: thresholds
        .default(() => thresholds.parse({}))
        .meta({
          title: 'Volatility bands',
          description:
            'Where the bands of the volatility bars change. The volatility of a KPI is the mean absolute percentage deviation of its values from their mean.',
        }),
    })
    .default(() => ({ thresholds: thresholds.parse({}) }))
    .meta({ title: 'Volatility' }),
});

export type AnalyticsSettings = z.output<typeof settingsSchema>;
