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
