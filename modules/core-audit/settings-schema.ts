// The settings of core.audit. Nothing secret lives here.
import { z } from '@scorpion/contracts';

export const DEFAULT_RETENTION_DAYS = 365;
export const DEFAULT_API_RETENTION_DAYS = 90;
export const DEFAULT_IP_TRUNCATE_AFTER_DAYS = 30;
export const DEFAULT_CSV_MAX_ROWS = 50_000;
export const DEFAULT_OUTBOX_RETENTION_DAYS = 14;
export const DEFAULT_JOB_RUN_RETENTION_DAYS = 90;

const days = (fallback: number) => z.number().int().min(1).max(3650).default(fallback);

const channels = z.strictObject({
  /**
   * Administrative actions: events of the modules that are not security-critical, `ctx.audit` entries
   * and calls of routes on the internal API. Role, approval, token, settings and secret events are
   * logged whatever this says.
   */
  admin: z.boolean().default(true),
  /** Calls of routes on the public API (`/api/v1`). */
  api: z.boolean().default(true),
});

export const settingsSchema = z.strictObject({
  /** Which channels are logged (FEATURES §3.17). */
  channels: channels.default(() => channels.parse({})),
  /** How long rows from events and `ctx.audit` are kept. */
  retentionDays: days(DEFAULT_RETENTION_DAYS),
  /** How long the request log (rows with source `api`) is kept; it grows faster. */
  apiRetentionDays: days(DEFAULT_API_RETENTION_DAYS),
  /** After this many days the client address of a row is cut to a network prefix (/24 for IPv4, /48 for IPv6). */
  ipTruncateAfterDays: days(DEFAULT_IP_TRUNCATE_AFTER_DAYS),
  /** The most rows one CSV export writes. */
  csvMaxRows: z.number().int().min(1).max(1_000_000).default(DEFAULT_CSV_MAX_ROWS),
  /** Kernel maintenance (M4 decision 9): events with every delivery done are deleted from the outbox after this many days. */
  outboxRetentionDays: days(DEFAULT_OUTBOX_RETENTION_DAYS),
  /** Kernel maintenance: finished job runs are deleted after this many days. */
  jobRunRetentionDays: days(DEFAULT_JOB_RUN_RETENTION_DAYS),
});

export type AuditSettings = z.output<typeof settingsSchema>;
