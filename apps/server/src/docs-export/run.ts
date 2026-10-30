// `scorpion docs:export [--out <dir>] [--zip <file>] [--screenshots <dir>]` (ADR-0047): the reference data of a repository checkout as JSON
// files, for the knowledge base. The command reads the modules, the profiles, the journey specs and the git history of the checkout it runs in,
// so it is a build-time tool: an image holds none of that.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { scorpionVersion } from '../version.ts';
import { buildExport, type ExportInput } from './build.ts';
import {
  firstReleaseOf,
  listScreenshots,
  loadProfiles,
  loadWorkspaceModules,
  parsePlannedProfiles,
} from './collect.ts';
import { zip, type ZipEntry } from './zip.ts';

export interface ExportOptions {
  root: string;
  /** Where the pictures of `docShot()` are; none when the folder does not exist. */
  screenshots?: string;
  /** Looks up the first release of a module; default: the git history of `root`. */
  firstRelease?: ExportInput['firstRelease'];
}

/** The files of the export as bytes, by path (JSON as UTF-8, pictures as they are). Throws when the export is not valid. */
export async function exportFiles(options: ExportOptions): Promise<Map<string, Buffer>> {
  const { root } = options;
  const modules = await loadWorkspaceModules(root);
  const profiles = await loadProfiles(root);
  const architecture = join(root, 'docs/architecture.md');
  const planned = existsSync(architecture)
    ? parsePlannedProfiles(
        readFileSync(architecture, 'utf8'),
        profiles.map((profile) => profile.name),
        modules.filter((module) => module.id.startsWith('core.')).map((module) => module.id),
      )
    : [];
  // The reader of the journey specs belongs to the test support package, which an image does not install.
  const { readJourneys } = await import('@scorpion/testing/journeys');
  const journeys = readJourneys(join(root, 'apps/web/e2e/journeys'));
  const screenshotsDir = options.screenshots ? resolve(options.screenshots) : undefined;
  const screenshots = screenshotsDir ? listScreenshots(screenshotsDir) : [];

  const built = buildExport({
    scorpionVersion: scorpionVersion(new URL(`file://${join(root, 'package.json')}`)),
    modules,
    profiles,
    planned,
    journeys,
    screenshots,
    firstRelease: options.firstRelease ?? ((dirName) => firstReleaseOf(root, dirName)),
  });
  const files = new Map<string, Buffer>();
  for (const [path, content] of built) {
    files.set(
      path,
      typeof content === 'string'
        ? Buffer.from(content, 'utf8')
        : readFileSync(join(screenshotsDir!, content.screenshot)),
    );
  }
  return files;
}

const USAGE = 'Usage: scorpion docs:export [--out <dir>] [--zip <file>] [--screenshots <dir>]';

export async function docsExportCommand(args: readonly string[], cwd: string): Promise<number> {
  let values: { out?: string; zip?: string; screenshots?: string };
  try {
    ({ values } = parseArgs({
      args: [...args],
      options: {
        out: { type: 'string' },
        zip: { type: 'string' },
        screenshots: { type: 'string' },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    return 2;
  }
  const root = resolve(cwd);
  if (!existsSync(join(root, 'modules')) || !existsSync(join(root, 'profiles'))) {
    console.error(
      'docs:export reads the modules and the profiles of a repository checkout; run it at the root of one (an image does not hold them).',
    );
    return 1;
  }
  const defaultPictures = join(root, 'reports/doc-shots');
  const screenshots =
    values.screenshots ?? (existsSync(defaultPictures) ? defaultPictures : undefined);
  if (values.screenshots && !existsSync(values.screenshots)) {
    console.error(`${values.screenshots} does not exist.`);
    return 1;
  }
  let files: Map<string, Buffer>;
  try {
    files = await exportFiles({ root, screenshots });
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  const out = resolve(root, values.out ?? 'docs-export');
  // Replace an earlier export, and only an earlier export: the folder must hold the marker file or nothing.
  if (existsSync(out)) {
    if (!existsSync(join(out, 'docs-export.json'))) {
      console.error(`${out} exists and is not a docs export; choose another --out or remove it.`);
      return 1;
    }
    rmSync(out, { recursive: true });
  }
  for (const [path, bytes] of files) {
    const target = join(out, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  console.log(`docs:export: ${files.size} file(s) in ${out}`);
  if (values.zip) {
    const entries: ZipEntry[] = [...files].map(([path, data]) => ({ path, data }));
    const target = resolve(root, values.zip);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, zip(entries));
    console.log(`docs:export: ${target}`);
  }
  return 0;
}
