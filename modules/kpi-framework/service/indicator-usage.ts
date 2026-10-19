// The registry `kpi.indicatorUsage` (M10 sprint 1, ADR-0041 Decision 1): a module that keeps rows about an indicator
// (`kpi.ingestion`: its measurements) contributes one entry, and the delete of an indicator asks every entry before it
// deletes. An indicator that something uses is 409 naming each module and the count (`InUse`), never a bare database
// error. The foreign key of that module's table (`restrict`) stays as the last guard for a row that appears between
// the question and the delete. Nothing here knows which modules contribute (CLAUDE.md rule 7).
import { z } from '@scorpion/contracts';

export const INDICATOR_USAGE_REGISTRY = 'kpi.indicatorUsage';

const fn = <T>() =>
  z.custom<T>((value) => typeof value === 'function', { message: 'expected a function' });

/**
 * `module` is the id of the contributing module and `what` the plural noun of what it holds ("measurements"); both
 * are named in the 409. `count` answers how many rows of that module refer to the indicator, `0` for none, and reads
 * the module's own tables (it never throws for an unknown id).
 */
export const indicatorUsageEntrySchema = z.strictObject({
  module: z.string().min(1).max(64),
  what: z.string().min(1).max(32),
  count: fn<(indicatorId: string) => Promise<number>>(),
});
export type IndicatorUsageEntry = z.output<typeof indicatorUsageEntrySchema>;
