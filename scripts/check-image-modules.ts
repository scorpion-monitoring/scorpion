// `node scripts/check-image-modules.ts <image> --profile <name> [--profile-file <path>] [--modules-root <dir>]...`
//
// Proves that an image holds only its profile's modules: it lists every `@scorpion/*` package in the
// image (as a link in some node_modules, and as a package directory) and compares the module
// packages among them with what the profile lists. A module that is in the image but not in the
// profile fails the check, and so does a module of the profile that is missing.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { packagesForProfile, scanModulePackages, type Profile } from '@scorpion/kernel';

export interface Comparison {
  /** Module packages in the image that the profile does not list. */
  extra: string[];
  /** Module packages the profile lists that the image lacks. */
  missing: string[];
}

/**
 * @param found every `@scorpion/*` name seen in the image
 * @param known the module packages of the workspace (only these count; kernel, contracts and so on do not)
 * @param expected the module packages of the profile
 */
export function compareModules(
  found: Iterable<string>,
  known: Iterable<string>,
  expected: Iterable<string>,
): Comparison {
  const knownSet = new Set(known);
  const present = new Set([...found].filter((name) => knownSet.has(name)));
  const wanted = new Set(expected);
  return {
    extra: [...present].filter((name) => !wanted.has(name)).sort(),
    missing: [...wanted].filter((name) => !present.has(name)).sort(),
  };
}

/** Names from `find` output of `…/node_modules/@scorpion/<name>` paths and `grep '"name"'` lines. */
export function parseListing(listing: string): string[] {
  const names = new Set<string>();
  for (const line of listing.split('\n')) {
    const link = /\/node_modules\/(@scorpion\/[^/\s]+)$/.exec(line.trim());
    if (link) names.add(link[1]!);
    const declared = /"name"\s*:\s*"(@scorpion\/[^"]+)"/.exec(line);
    if (declared) names.add(declared[1]!);
  }
  return [...names].sort();
}

const LIST_LINKS = String.raw`find /app -path '*/node_modules/@scorpion/*' -prune -print`;
const LIST_PACKAGES = String.raw`find /app -name package.json -not -path '*/node_modules/*' -exec grep -m1 '"name"' {} +`;

function listImage(image: string): string {
  const run = (script: string) =>
    execFileSync('docker', ['run', '--rm', '--entrypoint', 'sh', image, '-c', script], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  return `${run(LIST_LINKS)}\n${run(LIST_PACKAGES)}`;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      profile: { type: 'string' },
      'profile-file': { type: 'string' },
      'modules-root': { type: 'string', multiple: true },
    },
  });
  const [image] = positionals;
  if (!image || !values.profile) {
    console.error(
      'Usage: node scripts/check-image-modules.ts <image> --profile <name> [--profile-file <path>] [--modules-root <dir>]...',
    );
    process.exit(2);
  }

  const cwd = process.cwd();
  const file = resolve(cwd, values['profile-file'] ?? `profiles/${values.profile}.ts`);
  const { default: profile } = (await import(pathToFileURL(file).href)) as { default: Profile };
  const known = scanModulePackages(
    (values['modules-root'] ?? ['modules']).map((dir) => resolve(cwd, dir)),
  );
  const { packages, problems } = packagesForProfile(profile.name, profile.modules, known);
  if (problems.length > 0) {
    console.error(`The profile is not consistent:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }

  const found = parseListing(listImage(image));
  const { extra, missing } = compareModules(
    found,
    known.map((pkg) => pkg.name),
    packages.map((pkg) => pkg.name),
  );

  console.log(
    `profile ${profile.name}: expects ${packages.length} module(s): ${packages.map((p) => p.name).join(', ') || '(none)'}`,
  );
  console.log(`image ${image}: @scorpion packages found: ${found.join(', ') || '(none)'}`);
  if (extra.length > 0)
    console.error(
      `FAIL: modules in the image that are not in profile ${profile.name}: ${extra.join(', ')}`,
    );
  if (missing.length > 0)
    console.error(
      `FAIL: modules of profile ${profile.name} missing from the image: ${missing.join(', ')}`,
    );
  if (extra.length > 0 || missing.length > 0) process.exit(1);
  console.log('ok: the image holds exactly the modules of its profile');
}
