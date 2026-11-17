// The shapes of the legacy application's REST API (`ipk-bit/scorpion` at 5a92c31, `api/app/utils/schemas.py` and
// `routers/aai/utils/schemas.py`), and of the snapshot files that hold them. Zod-checked when fetched and again when read,
// so a snapshot that was edited by hand or cut short is refused with the file and the place.
import { z } from 'zod';

/** At most this many characters per text field: the legacy app has no limits, the snapshot does. */
const TEXT = 2000;
const text = z.string().max(TEXT);

/** The envelope of every list route of `/api/v1` (`utils/responses.py`). `currentPage` is `skip / limit`, a float. */
export const envelope = <T extends z.ZodType>(item: T) =>
  z.object({
    metadata: z.object({
      currentPage: z.number(),
      pageSize: z.number(),
      totalCount: z.number().int().min(0),
      totalPages: z.number(),
    }),
    result: z.array(item),
  });

/** `schemas.ServiceProvider`: `providerAbbr` and `providerName` of the node `ServiceProvider`. */
export const legacyProvider = z.object({ abbreviation: text, name: text });
export type LegacyProvider = z.infer<typeof legacyProvider>;

/** `schemas.ServiceCategory`. */
export const legacyCategory = z.object({ name: text });
export type LegacyCategory = z.infer<typeof legacyCategory>;

/**
 * `schemas.Service`, one row per service **and provider** (`get_all_services` matches
 * `(CATEGORY)<-[:OF_CATEGORY]-(SERVICE)<-[:HAS_SERVICES]-(ServiceProvider)`): a service with two providers is two rows, a
 * service without a provider or a category is not listed at all. `consortia` are the consortia's `name`s.
 */
export const legacyService = z.object({
  abbreviation: text,
  name: text,
  category: text,
  provider: text.nullable(),
  license: text.nullable(),
  consortia: z.array(text).max(200),
  stage: text.nullable(),
});
export type LegacyService = z.infer<typeof legacyService>;

/** `schemas.KPI` with `categories` (`CategoryNecessity`): the necessity is `null` where the category does not define it. */
export const legacyIndicator = z.object({
  name: text,
  description: text.nullable(),
  categories: z.array(z.object({ name: text, necessity: text.nullable() })).max(1000),
  selected: z.boolean().nullable(),
});
export type LegacyIndicator = z.infer<typeof legacyIndicator>;

/**
 * A measurement as the API answers it and as the maintainer's S3 backups hold it: `date` is Python's `str()` of the
 * InfluxDB time (`2023-01-01 00:00:00+00:00`). A value of 0 is never in the API's answer (`if record[label]`).
 */
export const legacyMeasurement = z.object({
  kpi: text,
  date: z.string().max(64),
  value: z.number().int(),
});
export type LegacyMeasurement = z.infer<typeof legacyMeasurement>;

/** `GET /aai/users` (`UserDetail`): no id. Personal data. */
export const legacyUser = z.object({
  user_name: text,
  email: text,
  is_admin: z.boolean(),
  providers: z.array(text).max(1000),
});
export type LegacyUser = z.infer<typeof legacyUser>;

/** `GET /aai/requests/membership` (`Request`): the pending `IS_MEMBER {approved: 0}`. Personal data. */
export const legacyMembershipRequest = z.object({
  id: text,
  mail: text,
  username: text,
  provider: text,
});
export type LegacyMembershipRequest = z.infer<typeof legacyMembershipRequest>;
