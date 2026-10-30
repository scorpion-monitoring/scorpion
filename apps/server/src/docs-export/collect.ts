// What the export reads from a repository checkout: the module packages of `modules/`, the profile files, the planned profiles of
// `docs/architecture.md`, the first release of each module (from git) and the journey specs. Everything here does input and output; the
// shaping of it into files is `build.ts`.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  computeModuleDependencies,
  scanModulePackages,
  type ModuleManifest,
} from '@scorpion/kernel';

export interface LoadedModule {
  id: string;
  /** The folder under `modules/`. */
  dirName: string;
  packageName: string;
  version: string;
  manifest: ModuleManifest;
  dependencies: string[];
  optionalDependencies: string[];
}

/** `@scorpion/kpi-ingestion` to the module id of its manifest, for the dependency lists. */
export async function loadWorkspaceModules(root: string): Promise<LoadedModule[]> {
  const packages = scanModulePackages([join(root, 'modules')]);
  const names = new Set(packages.map((pkg) => pkg.name));
  const loaded = await Promise.all(
    packages.map(async (pkg) => {
      const file = join(pkg.dir, 'module.ts');
      const { default: manifest } = (await import(pathToFileURL(file).href)) as {
        default?: ModuleManifest;
      };
      if (!manifest || typeof manifest.id !== 'string') {
        throw new Error(`${file} does not export a module manifest as its default`);
      }
      return { pkg, manifest };
    }),
  );
  const idOf = new Map(loaded.map(({ pkg, manifest }) => [pkg.name, manifest.id]));
  return loaded
    .map(({ pkg, manifest }) => {
      const deps = computeModuleDependencies(pkg.packageJson, (name) => names.has(name));
      return {
        id: manifest.id,
        dirName: pkg.dir.slice(pkg.dir.lastIndexOf('/') + 1),
        packageName: pkg.name,
        version: manifest.version,
        manifest,
        dependencies: deps.required.map((name) => idOf.get(name)!),
        optionalDependencies: deps.optional.map((name) => idOf.get(name)!),
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

export interface DefinedProfile {
  name: string;
  modules: string[];
}

/** The profiles of `profiles/*.ts`. */
export async function loadProfiles(root: string): Promise<DefinedProfile[]> {
  const dir = join(root, 'profiles');
  const files = readdirSync(dir).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
  );
  const profiles = await Promise.all(
    files.map(async (file) => {
      const { default: profile } = (await import(pathToFileURL(join(dir, file)).href)) as {
        default?: DefinedProfile;
      };
      if (
        !profile ||
        profile.name !== file.replace(/\.ts$/, '') ||
        !Array.isArray(profile.modules)
      ) {
        throw new Error(
          `profiles/${file} does not export defineProfile({ name: "${file.replace(/\.ts$/, '')}", modules })`,
        );
      }
      return { name: profile.name, modules: [...profile.modules] };
    }),
  );
  return profiles.sort((a, b) => (a.name < b.name ? -1 : 1));
}

export interface PlannedProfile {
  name: string;
  modules: { id: string; inclusion: 'included' | 'optional' }[];
}

/**
 * The profiles of the matrix in `docs/architecture.md` ("Deployment profiles and operations") that have no file in `profiles/` yet. A row names a
 * module, a list of modules, or "Core (all seven)"; ● is included and ○ optional. The table is the plan, so a planned profile may name a module that
 * does not exist yet.
 */
export function parsePlannedProfiles(
  markdown: string,
  defined: readonly string[],
  coreIds: readonly string[],
): PlannedProfile[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => /^\|\s*Module\s*\|.*`full`/.test(line));
  if (start < 0) return [];
  const cells = (line: string) =>
    line
      .replace(/^\||\|\s*$/g, '')
      .split('|')
      .map((cell) => cell.trim());
  const names = cells(lines[start]!)
    .slice(1)
    .map((cell) => cell.replaceAll('`', ''));
  const planned = new Map<string, PlannedProfile>();
  names.forEach((name, index) => {
    if (!defined.includes(name)) planned.set(name, { name, modules: [] });
    void index;
  });
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const [label, ...marks] = cells(line);
    const ids = /^Core\b/.test(label!)
      ? [...coreIds]
      : label!
          .split(',')
          .map((part) => part.trim().replaceAll('`', ''))
          .filter(Boolean);
    marks.forEach((mark, index) => {
      const profile = planned.get(names[index]!);
      if (!profile || mark === '') return;
      const inclusion = mark === '●' ? 'included' : mark === '○' ? 'optional' : undefined;
      if (inclusion) for (const id of ids) profile.modules.push({ id, inclusion });
    });
  }
  return [...planned.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
}

/**
 * The first release tag that has a module: the first tag (by version) that contains the commit that added `modules/<dir>/module.ts`. `null`
 * without git, without that history or without a tag after it.
 */
export function firstReleaseOf(root: string, dirName: string): string | null {
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  try {
    const added = git('log', '--diff-filter=A', '--format=%H', '--', `modules/${dirName}/module.ts`)
      .trim()
      .split('\n')
      .filter(Boolean)
      .at(-1);
    if (!added) return null;
    const tag = git('tag', '--contains', added, '--list', 'v[0-9]*', '--sort=version:refname')
      .trim()
      .split('\n')
      .find(Boolean);
    return tag ? tag.replace(/^v/, '') : null;
  } catch {
    return null;
  }
}

/** The pictures of a folder written by `docShot()`: `jNN/NN-<slug>.light.png` with its `.dark.png`. */
export function listScreenshots(
  dir: string,
): { path: string; journey: string; number: number; slug: string; theme: 'light' | 'dark' }[] {
  if (!existsSync(dir)) return [];
  const found: ReturnType<typeof listScreenshots> = [];
  for (const journey of readdirSync(dir, { withFileTypes: true })) {
    if (!journey.isDirectory() || !/^j\d{2}$/.test(journey.name)) continue;
    for (const file of readdirSync(join(dir, journey.name))) {
      const match = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.(light|dark)\.png$/.exec(file);
      if (match) {
        found.push({
          path: `${journey.name}/${file}`,
          journey: journey.name,
          number: Number(match[1]),
          slug: match[2]!,
          theme: match[3] as 'light' | 'dark',
        });
      }
    }
  }
  return found.sort((a, b) => (a.path < b.path ? -1 : 1));
}

export const readText = (path: string) => readFileSync(path, 'utf8');
