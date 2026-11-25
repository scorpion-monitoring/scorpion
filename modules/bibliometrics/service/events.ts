// The event of bibliometrics. Ids and counts only, never a DOI, a title or a URL: a test walks the schema, so a field that
// could carry one cannot be added without that test failing.
import { z } from '@scorpion/contracts';
import { SLICE_SIZE } from './citations.ts';

/**
 * `bibliometrics.citations.updated@1`: one run of one citation source finished. `serviceIds` are the services whose
 * publications it asked about (at most 2,000; the schedule sends one event per slice and source); `found` DOIs got a
 * count, `failed` DOIs could not be asked. Nothing listens yet (sprint 3's KPI write reads the run itself).
 */
export const citationsUpdatedSchema = z.strictObject({
  runId: z.uuid(),
  serviceIds: z.array(z.uuid()).max(SLICE_SIZE),
  found: z.number().int().min(0),
  failed: z.number().int().min(0),
});

export type CitationsUpdated = z.output<typeof citationsUpdatedSchema>;
