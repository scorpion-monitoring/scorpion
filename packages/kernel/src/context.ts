// The context a module receives (`ctx`). See the kernel README for the full API.
import type { AuditEntry } from './audit.ts';
import type { Config } from './config.ts';
import type { RegisteredPermission } from './composition.ts';
import type { Db } from './db.ts';
import type { Logger } from './logger.ts';
import type { JobsApi } from './jobs.ts';
import type { EventsApi } from './outbox.ts';
import type { SettingsPort } from './settings.ts';
import type { z } from 'zod';

/**
 * Public service objects by module id. Each module's `public.ts` adds its own entry:
 *
 *     declare module '@scorpion/kernel' {
 *       interface ModuleServices { 'kpi.ingestion': IngestionService }
 *     }
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ModuleServices {}

export interface ModuleContext<
  Required extends keyof ModuleServices = never,
  Optional extends keyof ModuleServices = never,
  Settings = unknown,
> {
  /** The id of the module this context belongs to. */
  readonly moduleId: string;
  /** One shared connection pool. `ctx.db.tx(fn)` runs `fn` in a transaction. */
  readonly db: Db;
  /** A logger that carries `module`, and `requestId` or `jobId` when there is one. */
  readonly log: Logger;
  /** Emit domain events into the transactional outbox. */
  readonly events: EventsApi;
  /** Queue runs of declared jobs. */
  readonly jobs: JobsApi;
  /**
   * Writes an audit entry for an administrative or permission-relevant action that has no domain
   * event (ADR 0021). Call it inside `ctx.db.tx()` and it commits or rolls back with the change; a
   * failure rejects, so the change does not happen without its trail. It does nothing in a profile
   * without `core.audit`. Put names and ids in `payload`, never a secret or a mail body.
   */
  readonly audit: (entry: AuditEntry) => Promise<void>;
  /** The validated environment configuration. Contains no secrets other than `DATABASE_URL`. */
  readonly config: Config;
  /**
   * Public services of the required dependencies, and of optional ones that are present (else
   * `undefined`). Any other module id throws: nothing else is reachable.
   */
  readonly deps: { readonly [K in Required]: ModuleServices[K] } & {
    readonly [K in Optional]?: ModuleServices[K];
  };
  /** Validated entries of a registry declared by this module or one of its dependencies. */
  registry(name: string): readonly unknown[];
  /**
   * Every permission the manifests of the loaded profile declare, in module order. Read-only and
   * open to any module; `core.authz` uses it to know which permissions can exist.
   */
  readonly permissions: readonly RegisteredPermission[];
  /**
   * The module's own settings: validated by its manifest `settings` schema, defaults applied. Backed
   * by `core.settings` when the profile has it, else the schema's defaults (ADR 0017).
   */
  readonly settings: SettingsPort<Settings>;
  /**
   * The `settings` schema of every loaded module that declares one, by module id. Read-only and open
   * to any module; `core.settings` validates what an administrator writes against it.
   */
  readonly settingsSchemas: ReadonlyMap<string, z.ZodType>;
}
