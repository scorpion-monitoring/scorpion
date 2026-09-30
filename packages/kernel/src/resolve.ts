import { KernelStartupError } from './errors.ts';
import { resolveOrder } from './graph.ts';
import { validateManifest, type ModuleManifest } from './manifest.ts';
import {
  computeModuleDependencies,
  packageNameForModule,
  type PackageDeps,
} from './package-deps.ts';
import type { Profile } from './profile.ts';
import { WORKSPACE_MODULES } from './workspace-modules.ts';

/** A module as the generated profile file supplies it: its manifest and its package.json. */
export interface ModuleSource {
  manifest: ModuleManifest;
  packageJson: PackageDeps & { name: string };
}

export interface ResolvedModule {
  id: string;
  manifest: ModuleManifest;
  packageName: string;
  /** Required dependencies (module ids), from `dependencies` in package.json. */
  dependsOn: readonly string[];
  /** Optional dependencies (module ids), from optional `peerDependencies`. Present or not. */
  optionalDependsOn: readonly string[];
  /** The optional dependencies that are in the profile. */
  presentOptional: readonly string[];
}

export interface ResolvedProfile {
  name: string;
  /** Dependencies first. */
  modules: readonly ResolvedModule[];
}

export interface ResolveOptions {
  profile: Profile;
  /** The pool the profile draws from: every module the build made available. */
  sources: readonly ModuleSource[];
  /** Module id → package name for all modules of the workspace. Default: `WORKSPACE_MODULES`. */
  modulePackages?: Readonly<Record<string, string>>;
}

/**
 * Loader step 1: picks the profile's modules, derives their dependencies from package.json,
 * checks them and puts them in dependency order.
 */
export function resolveProfile({
  profile,
  sources,
  modulePackages = WORKSPACE_MODULES,
}: ResolveOptions): ResolvedProfile {
  const problems: string[] = [];
  const idByPackage = new Map(Object.entries(modulePackages).map(([id, name]) => [name, id]));
  const isModulePackage = (name: string) => idByPackage.has(name);

  const listed = new Set<string>();
  for (const id of profile.modules) {
    if (listed.has(id))
      problems.push(`module "${id}" is listed twice in profile "${profile.name}"`);
    listed.add(id);
  }

  const resolved = new Map<string, ResolvedModule>();
  for (const source of sources) {
    const declaredId = (source.manifest as { id?: unknown } | null)?.id;
    if (typeof declaredId !== 'string' || !listed.has(declaredId)) continue;
    let manifest: ModuleManifest;
    try {
      manifest = validateManifest(source.manifest, source.packageJson.name);
    } catch (error) {
      if (error instanceof KernelStartupError)
        problems.push(...error.problems.map((p) => `${declaredId}: ${p}`));
      else throw error;
      continue;
    }
    const expectedPackage = packageNameForModule(manifest.id);
    if (source.packageJson.name !== expectedPackage) {
      problems.push(
        `${manifest.id}: package is named "${source.packageJson.name}", expected "${expectedPackage}"`,
      );
    }
    if (resolved.has(manifest.id)) {
      problems.push(`module "${manifest.id}" is supplied twice`);
      continue;
    }
    const names = computeModuleDependencies(source.packageJson, isModulePackage);
    resolved.set(manifest.id, {
      id: manifest.id,
      manifest,
      packageName: source.packageJson.name,
      dependsOn: names.required.map((name) => idByPackage.get(name)!),
      optionalDependsOn: names.optional.map((name) => idByPackage.get(name)!),
      presentOptional: [],
    });
  }

  for (const id of profile.modules) {
    if (!resolved.has(id) && !problems.some((problem) => problem.startsWith(`${id}:`))) {
      problems.push(
        `module "${id}" is in profile "${profile.name}" but this build does not include it`,
      );
    }
  }
  if (problems.length > 0) {
    throw new KernelStartupError(`Cannot load profile "${profile.name}":`, problems);
  }

  const order = resolveOrder(
    profile.name,
    [...resolved.values()].map((module) => ({
      id: module.id,
      required: module.dependsOn,
      optional: module.optionalDependsOn,
    })),
  );
  return {
    name: profile.name,
    modules: order.map((id) => {
      const module = resolved.get(id)!;
      return {
        ...module,
        presentOptional: module.optionalDependsOn.filter((dep) => resolved.has(dep)),
      };
    }),
  };
}
