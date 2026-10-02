export { buildComposition, tablePrefixOf } from './composition.ts';
export type {
  Composition,
  RegisteredEvent,
  RegisteredPermission,
  RegisteredRegistry,
  RegistryEntry,
} from './composition.ts';
export type { ModuleContext, ModuleServices } from './context.ts';
export { KernelStartupError } from './errors.ts';
export { resolveOrder, type GraphNode } from './graph.ts';
export {
  defineModule,
  EVENT_NAME,
  MODULE_ID,
  SYSTEM_READY,
  validateManifest,
  type DomainEvent,
  type EventHandler,
  type JobDef,
  type JobRun,
  type ModuleManifest,
  type PermissionDef,
  type RouteRegistrar,
} from './manifest.ts';
export { renderProfileModule, type ProfileModuleInput } from './codegen.ts';
export { computeModuleDependencies, packageNameForModule } from './package-deps.ts';
export type { ModuleDependencyNames, PackageDeps } from './package-deps.ts';
export {
  packagesForProfile,
  scanModulePackages,
  type ModulePackage,
  type ProfilePackages,
} from './workspace.ts';
export { defineProfile, type Profile } from './profile.ts';
export {
  resolveProfile,
  type ModuleSource,
  type ResolvedModule,
  type ResolvedProfile,
  type ResolveOptions,
} from './resolve.ts';
export { WORKSPACE_MODULES, type ModuleId } from './workspace-modules.ts';
export { loadConfig, mountPath, type Config } from './config.ts';
export {
  activeTransaction,
  createDb,
  createPool,
  openDatabase,
  type Db,
  type DbTx,
  type DatabaseHandle,
} from './db.ts';
export { ids } from './ids.ts';
export { createKernel, type Kernel, type KernelOptions } from './kernel.ts';
export {
  childLogger,
  createLogger,
  type LogBindings,
  type Logger,
  type LoggerOptions,
} from './logger.ts';
export {
  journalTable,
  MIGRATION_LOCK,
  pendingMigrations,
  runMigrations,
  type MigrationReport,
  type MigrationTarget,
} from './migrate.ts';
export { maskSecrets, maskString, REDACTED } from './redact.ts';
export {
  createDispatcher,
  createEvents,
  defaultBackoffMs,
  EventError,
  NOTIFY_CHANNEL,
} from './outbox.ts';
export type { Dispatcher, DispatcherOptions, EventsApi, Subscription } from './outbox.ts';
export { listDeadDeliveries, outboxStats, type DeadDelivery, type OutboxStats } from './queries.ts';
export {
  createJobs,
  JobError,
  type Jobs,
  type JobsApi,
  type JobsOptions,
  type JobRunReport,
} from './jobs.ts';
export { listJobRuns, type JobRunFilter, type JobRunRow } from './queries.ts';
export {
  AUTHORIZER_REGISTRY,
  denyByDefault,
  type AuthorizationRequest,
  type Authorizer,
} from './authz.ts';
export { collectRoutes, type RegisteredRoute, type RouteSurface } from './routes.ts';
export {
  anonymousOnly,
  AUTHENTICATOR_REGISTRY,
  type AuthenticationRequest,
  type Authenticator,
} from './authn.ts';
