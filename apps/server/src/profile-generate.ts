// `scorpion profile:generate <name>`: writes apps/server/src/generated/profile.ts and makes the
// server's module dependencies match the profile (ADR 0002). Runs at build time only.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  KernelStartupError,
  packagesForProfile,
  renderProfileModule,
  renderUiModule,
  scanModulePackages,
  type Profile,
} from '@scorpion/kernel';

export interface GenerateOptions {
  profileName: string;
  /** Repository root. */
  root: string;
  /** Profile file, relative to `root`. Default: `profiles/<name>.ts`. */
  profileFile?: string;
  /** Directories that hold module packages, relative to `root`. Default: `modules`. */
  moduleRoots?: string[];
  /** Report instead of write. */
  check?: boolean;
}

export interface GenerateResult {
  /** Files that were (or, with `check`, would be) changed. */
  changed: string[];
  packageNames: string[];
}

const GENERATED = 'apps/server/src/generated/profile.ts';
const SERVER_PACKAGE = 'apps/server/package.json';
const WEB_GENERATED = 'apps/web/src/generated/ui.ts';
const WEB_PACKAGE = 'apps/web/package.json';
const SHELL = 'core.ui-shell';

/** Whether a module package exports a `./ui` entry (the browser half of its pages). */
function exportsUi(dir: string): boolean {
  const { exports } = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>;
  };
  return exports !== undefined && './ui' in exports;
}

function writeIfChanged(
  root: string,
  file: string,
  content: string,
  check: boolean,
  changed: string[],
) {
  const path = resolve(root, file);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  if (current === content) return;
  changed.push(file);
  if (!check) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

export async function generateProfile(options: GenerateOptions): Promise<GenerateResult> {
  const { profileName, root, check = false } = options;
  const profilePath = resolve(root, options.profileFile ?? `profiles/${profileName}.ts`);
  if (!existsSync(profilePath)) {
    throw new KernelStartupError(`Unknown profile "${profileName}":`, [
      `${profilePath} does not exist`,
    ]);
  }
  const { default: profile } = (await import(pathToFileURL(profilePath).href)) as {
    default?: Profile;
  };
  if (!profile || profile.name !== profileName || !Array.isArray(profile.modules)) {
    throw new KernelStartupError(`Invalid profile file ${profilePath}:`, [
      `it must export default defineProfile({ name: "${profileName}", modules: [...] })`,
    ]);
  }

  const available = scanModulePackages(
    (options.moduleRoots ?? ['modules']).map((dir) => resolve(root, dir)),
  );
  const { packages, problems } = packagesForProfile(profileName, profile.modules, available);
  if (problems.length > 0) {
    throw new KernelStartupError(`Cannot generate profile "${profileName}":`, problems);
  }
  const packageNames = packages.map((pkg) => pkg.name);

  const changed: string[] = [];
  writeIfChanged(
    root,
    GENERATED,
    renderProfileModule({ profileName, moduleIds: profile.modules, packageNames }),
    check,
    changed,
  );

  // The server declares exactly the profile's modules, so an image built for the profile links
  // and installs nothing else.
  const serverPath = resolve(root, SERVER_PACKAGE);
  const server = JSON.parse(readFileSync(serverPath, 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const moduleNames = new Set(available.map((pkg) => pkg.name));
  const dependencies = Object.fromEntries(
    [
      ...Object.entries(server.dependencies ?? {}).filter(([name]) => !moduleNames.has(name)),
      ...packageNames.map((name) => [name, 'workspace:*'] as const),
    ].sort(([a], [b]) => a.localeCompare(b)),
  );
  writeIfChanged(
    root,
    SERVER_PACKAGE,
    `${JSON.stringify({ ...server, dependencies }, null, 2)}\n`,
    check,
    changed,
  );

  // The web app: the table of pages comes from the modules that export `./ui`, and the app depends on
  // exactly those modules (a development dependency: Vite bundles them). A profile without the shell
  // has no web app and an empty table.
  const hasShell = profile.modules.includes(SHELL);
  const uiPackages = hasShell
    ? packages.filter((pkg) => exportsUi(resolve(root, pkg.dir))).map((pkg) => pkg.name)
    : [];
  writeIfChanged(
    root,
    WEB_GENERATED,
    renderUiModule({ profileName, hasShell, uiPackages }),
    check,
    changed,
  );
  const webPath = resolve(root, WEB_PACKAGE);
  const web = JSON.parse(readFileSync(webPath, 'utf8')) as {
    devDependencies?: Record<string, string>;
  };
  const devDependencies = Object.fromEntries(
    [
      ...Object.entries(web.devDependencies ?? {}).filter(([name]) => !moduleNames.has(name)),
      ...uiPackages.map((name) => [name, 'workspace:*'] as const),
    ].sort(([a], [b]) => a.localeCompare(b)),
  );
  writeIfChanged(
    root,
    WEB_PACKAGE,
    `${JSON.stringify({ ...web, devDependencies }, null, 2)}\n`,
    check,
    changed,
  );

  return { changed, packageNames };
}
