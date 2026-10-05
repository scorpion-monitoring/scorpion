import type { AuthzService } from '@scorpion/core-authz/public';
import type { IdentityService } from '@scorpion/core-identity/public';
import type { NotificationsService } from '@scorpion/core-notifications/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import { defineModule, type AuditEntry, type EventHandler, type JobResult } from '@scorpion/kernel';
import { registerAuditRoutes } from './routes.ts';
import { createAuditService, type AuditInternals } from './service/audit.ts';
import { EVENT_DECISIONS } from './service/decisions.ts';
import { PERMISSION_EXPORT, PERMISSION_READ } from './service/viewer.ts';
import { PERMISSION_SYSTEM_MANAGE, PERMISSION_SYSTEM_READ } from './service/system.ts';
import { settingsSchema, type AuditSettings } from './settings-schema.ts';

export { settingsSchema, type AuditSettings } from './settings-schema.ts';
export type { AuditInternals } from './service/audit.ts';
export { EVENT_DECISIONS, type EventDecision } from './service/decisions.ts';

/** The daily job that deletes old rows and cuts old client addresses (the plan calls it `audit.retention`; a job name carries the module id). */
export const RETENTION_JOB = 'core.audit.retention';
/** Kernel maintenance hosted here (M4 decision 9). The plan's `system.outbox-retention` and `system.job-run-retention`, with the module id in front. */
export const OUTBOX_RETENTION_JOB = 'core.audit.system.outbox-retention';
export const JOB_RUN_RETENTION_JOB = 'core.audit.system.job-run-retention';

/**
 * Builds the manifest. The default export is the one a profile uses. The sink entry and the event
 * handlers are fixed in the manifest and reach the service through a closure (as in core.authz).
 */
// The service types of the dependencies shape `ctx.deps`; the trail itself needs only core.authz.
export type AuditDependencies = [
  AuthzService,
  SettingsService,
  IdentityService,
  NotificationsService,
];

export function createAuditModule() {
  let current: AuditInternals | undefined;
  const serviceOrThrow = (): AuditInternals => {
    if (!current) throw new Error('core.audit: the service is not ready');
    return current;
  };

  // One subscription per event that has a "log" decision. An event of a module that is not in the
  // profile (notifications, as an optional peer) is skipped by the loader, not an error.
  const subscriptions: Record<string, EventHandler> = Object.fromEntries(
    Object.entries(EVENT_DECISIONS)
      .filter(([, decision]) => decision.decision === 'log')
      .map(([name]) => [name, (event) => serviceOrThrow().store.recordEvent(event)] as const),
  );

  return defineModule<
    AuditInternals,
    'core.authz' | 'core.settings' | 'core.identity',
    'core.notifications',
    AuditSettings
  >({
    id: 'core.audit',
    version: '0.1.0',
    // `audit_event`, not `core_audit_event` (ADR 0004).
    tablePrefix: 'audit_',

    permissions: {
      [PERMISSION_READ]: { description: 'Read the audit trail: list entries, filter, open one' },
      [PERMISSION_EXPORT]: { description: 'Export the audit trail as CSV' },
      [PERMISSION_SYSTEM_READ]: {
        description: 'See the state of the event outbox and its dead deliveries',
      },
      [PERMISSION_SYSTEM_MANAGE]: {
        description: 'Put a dead event delivery back in the queue',
      },
    },
    settings: settingsSchema,

    schema: () => import('./db/schema.ts'),
    migrations: new URL('./migrations', import.meta.url),

    jobs: [
      {
        name: RETENTION_JOB,
        schedule: '37 3 * * *', // daily, UTC
        retry: { limit: 2, delaySeconds: 300 },
        timeoutSeconds: 1800,
        handler: async (job, ctx): Promise<JobResult> => {
          const report = await serviceOrThrow().retention.run({ signal: job.signal });
          // Counts only. The same object goes to the job-run history.
          ctx.log.info(report, 'audit retention finished');
          return report;
        },
      },
      {
        name: OUTBOX_RETENTION_JOB,
        schedule: '47 3 * * *',
        retry: { limit: 2, delaySeconds: 300 },
        timeoutSeconds: 1800,
        handler: async (job, ctx): Promise<JobResult> => {
          const report = await serviceOrThrow().retention.runOutbox({ signal: job.signal });
          ctx.log.info(report, 'outbox retention finished');
          return report;
        },
      },
      {
        name: JOB_RUN_RETENTION_JOB,
        schedule: '57 3 * * *',
        retry: { limit: 2, delaySeconds: 300 },
        timeoutSeconds: 1800,
        handler: async (job, ctx): Promise<JobResult> => {
          const report = await serviceOrThrow().retention.runJobRuns({ signal: job.signal });
          ctx.log.info(report, 'job-run retention finished');
          return report;
        },
      },
    ],

    // Emits nothing: the trail is the end of the line. It subscribes to the events of its dependencies
    // and, when the profile has it, of core.notifications.
    events: { on: subscriptions },

    contributes: {
      // ADR 0021: the pipeline's entry for a route with `audit`, and `ctx.audit(entry)`.
      'kernel.auditSink': [{ record: (entry: AuditEntry) => serviceOrThrow().store.record(entry) }],
    },

    services: (ctx) => {
      current = createAuditService(ctx, { authz: ctx.deps['core.authz'] });
      return current;
    },

    routes: (r) => {
      registerAuditRoutes(r, r.service<AuditInternals>());
    },
  });
}

export default createAuditModule();
