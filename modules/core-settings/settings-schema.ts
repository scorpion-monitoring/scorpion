// The settings of core.settings itself: the numbers of the server's rate limit (pipeline step 2).
// The pipeline is not a module, so the module that stores settings owns them; the server reads them
// through `kernel.settingsOf('core.settings')`.
import { z } from '@scorpion/contracts';

/** One token bucket: a burst, then a steady rate per minute. */
const bucket = z.strictObject({
  /** Most requests a client can make at once; the bucket's size. */
  burst: z.number().int().min(1).max(100_000),
  /** Requests that come back per minute. */
  perMinute: z.number().min(0.1).max(1_000_000),
});

/** Today's limits (M1): a burst of 120 then 120 a minute; a burst of 10 then 10 a minute. */
export const DEFAULT_RATE_LIMITS = {
  default: { burst: 120, perMinute: 120 },
  strict: { burst: 10, perMinute: 10 },
} as const;

export const settingsSchema = z.strictObject({
  /**
   * Limits per client address (and per credential) for each route group. `strict` is for routes an
   * attacker gains from by repeating them: login, register, token use and creation.
   */
  rateLimits: z
    .strictObject({
      default: bucket.default({ ...DEFAULT_RATE_LIMITS.default }),
      strict: bucket.default({ ...DEFAULT_RATE_LIMITS.strict }),
    })
    .default({
      default: { ...DEFAULT_RATE_LIMITS.default },
      strict: { ...DEFAULT_RATE_LIMITS.strict },
    }),
});

export type CoreSettings = z.output<typeof settingsSchema>;
