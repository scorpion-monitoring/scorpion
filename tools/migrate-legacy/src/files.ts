// Where the tool may write, and how. A snapshot and a report hold personal data (names, addresses), so they are written
// with mode 0600 in a directory of mode 0700, never inside the repository, and never over a directory that has content.
import { createHash } from 'node:crypto';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** The repository this tool is part of: `tools/migrate-legacy/src/` is three levels down. */
export const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..', '..');

export class RefusedPath extends Error {}

/** Throws `RefusedPath` when `path` is inside the repository (where it could be committed). */
export function refuseInsideRepository(path: string, what: string): string {
  const target = resolve(path);
  const rel = relative(REPOSITORY_ROOT, target);
  if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) {
    throw new RefusedPath(
      `${what} ${target} is inside the repository. It holds data that must never be committed; choose a directory outside ${REPOSITORY_ROOT}.`,
    );
  }
  return target;
}

/** Creates `dir` (mode 0700) or accepts an existing empty one; refuses one with content. */
export async function emptyPrivateDirectory(dir: string, what: string): Promise<void> {
  const existing = await stat(dir).catch(() => undefined);
  if (existing) {
    if (!existing.isDirectory()) throw new RefusedPath(`${what} ${dir} is not a directory.`);
    if ((await readdir(dir)).length > 0) {
      throw new RefusedPath(`${what} ${dir} is not empty; give a new or an empty directory.`);
    }
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

/** Writes a file readable by its owner only, creating its directory (0700) first. */
export async function writePrivateFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, content, { mode: 0o600 });
}

export const sha256 = (content: string | Uint8Array) =>
  createHash('sha256').update(content).digest('hex');
