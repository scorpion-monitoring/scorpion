// The version of the Scorpion product: the `version` of the root package, which `changeset version` bumps at a
// release. The image carries the root package.json beside `apps/` (scripts/image-tree.ts), so the same relative
// path works in the repository and in an image.
import { readFileSync } from 'node:fs';

const ROOT_PACKAGE = new URL('../../../package.json', import.meta.url);

/** The product version, or `unknown` when the file is not where a repository or an image keeps it. */
export function scorpionVersion(file: URL = ROOT_PACKAGE): string {
  try {
    const { version } = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown };
    return typeof version === 'string' && version.length > 0 ? version : 'unknown';
  } catch {
    return 'unknown';
  }
}
