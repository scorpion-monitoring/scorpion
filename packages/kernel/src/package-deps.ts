// The one place that turns a module's package.json into its module dependencies (ADR 0002).
// The loader and the ESLint boundaries rule both call this function, so an import the rule
// accepts is exactly a dependency the loader wires. No imports: the ESLint plugin loads this file.

/** The parts of a package.json that declare dependencies. */
export interface PackageDeps {
  name?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

export interface ModuleDependencyNames {
  /** Package names in `dependencies` that are module packages. Sorted. */
  required: string[];
  /** Package names in `peerDependencies` marked optional in `peerDependenciesMeta`. Sorted. */
  optional: string[];
}

/**
 * Required dependencies are the module packages in `dependencies`. Optional dependencies are
 * module packages in `peerDependencies` that `peerDependenciesMeta` marks `optional`. A package
 * in both lists is required. Everything else (dev dependencies, other peers) is not a module
 * dependency.
 *
 * @param isModulePackage tells module packages (`modules/*`) from other workspace packages.
 */
export function computeModuleDependencies(
  pkg: PackageDeps,
  isModulePackage: (packageName: string) => boolean,
): ModuleDependencyNames {
  const required = Object.keys(pkg.dependencies ?? {}).filter(isModulePackage);
  const optional = Object.keys(pkg.peerDependencies ?? {}).filter(
    (name) =>
      isModulePackage(name) &&
      pkg.peerDependenciesMeta?.[name]?.optional === true &&
      !required.includes(name),
  );
  return { required: required.sort(), optional: optional.sort() };
}

/** `kpi.ingestion` → `@scorpion/kpi-ingestion`. */
export function packageNameForModule(id: string): string {
  return `@scorpion/${id.replaceAll('.', '-')}`;
}
