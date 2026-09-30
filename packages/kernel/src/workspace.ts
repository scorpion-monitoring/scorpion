// Build-time helpers that read the module packages on disk. Used by the CLI and the scripts,
// never by the running server.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeModuleDependencies,
  packageNameForModule,
  type PackageDeps,
} from './package-deps.ts';

export interface ModulePackage {
  name: string;
  /** Directory of the package, as given by the root it was found under. */
  dir: string;
  packageJson: PackageDeps & { name: string };
}

/** Packages that sit directly below one of `roots` (default: `modules/`), sorted by name. */
export function scanModulePackages(roots: readonly string[] = ['modules']): ModulePackage[] {
  const found: ModulePackage[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const file = join(root, entry.name, 'package.json');
      if (!entry.isDirectory() || !existsSync(file)) continue;
      const packageJson = JSON.parse(readFileSync(file, 'utf8')) as ModulePackage['packageJson'];
      if (packageJson.name)
        found.push({ name: packageJson.name, dir: join(root, entry.name), packageJson });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

export interface ProfilePackages {
  /** The profile's module packages, in profile order. */
  packages: ModulePackage[];
  problems: string[];
}

/**
 * Finds the package of each module in a profile and checks that the profile lists every
 * required dependency. The loader repeats the check on the manifests at startup; doing it here
 * fails the image build early.
 */
export function packagesForProfile(
  profileName: string,
  moduleIds: readonly string[],
  available: readonly ModulePackage[],
): ProfilePackages {
  const byName = new Map(available.map((pkg) => [pkg.name, pkg]));
  const problems: string[] = [];
  const packages: ModulePackage[] = [];
  const wanted = new Set(moduleIds.map(packageNameForModule));

  for (const id of moduleIds) {
    const pkg = byName.get(packageNameForModule(id));
    if (pkg) packages.push(pkg);
    else problems.push(`module "${id}" has no package "${packageNameForModule(id)}"`);
  }
  for (const pkg of packages) {
    const { required } = computeModuleDependencies(pkg.packageJson, (name) => byName.has(name));
    for (const dependency of required.filter((name) => !wanted.has(name))) {
      problems.push(`${pkg.name} → ${dependency} (not in profile "${profileName}")`);
    }
  }
  return { packages, problems };
}
