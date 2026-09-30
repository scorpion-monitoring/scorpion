// `pnpm changeset:check [<base-ref>]`: fails unless the branch adds a changeset.
//
// Every pull request needs one: `pnpm changeset` for a change that belongs in CHANGELOG.md,
// `pnpm changeset --empty` for one that does not. A release branch (it updates CHANGELOG.md
// through `changeset version`) is exempt, and so is a pull request that changes only
// documentation (see `isDocsFile`). Changesets may name only the root package `scorpion`,
// because the internal packages are ignored and would never reach the changelog.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** `docs/**`, `**\/*.md` (except `CHANGELOG.md`) and `.github/ISSUE_TEMPLATE/**`. */
export function isDocsFile(file: string): boolean {
  if (file.startsWith('docs/') || file.startsWith('.github/ISSUE_TEMPLATE/')) return true;
  return file.endsWith('.md') && file.split('/').at(-1) !== 'CHANGELOG.md';
}

/** True unless every changed file is documentation. An empty diff needs none either. */
export function needsChangeset(changed: string[]): boolean {
  return !changed.every(isDocsFile);
}

if (import.meta.main) main();

function main() {
  const base =
    process.argv[2] ??
    (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/dev');

  const git = (...args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean);

  const changed = git('diff', '--name-only', `${base}...HEAD`);
  if (changed.includes('CHANGELOG.md')) {
    console.log('Release branch (CHANGELOG.md changed): no changeset needed.');
    process.exit(0);
  }
  if (!needsChangeset(changed)) {
    console.log('Documentation only (docs/**, *.md, issue templates): no changeset needed.');
    process.exit(0);
  }

  const added = git(
    'diff',
    '--name-only',
    '--diff-filter=A',
    `${base}...HEAD`,
    '--',
    '.changeset/*.md',
  ).filter((file) => file !== '.changeset/README.md');
  if (added.length === 0) {
    console.error(
      `No changeset added since ${base}. Run \`pnpm changeset\` (or \`pnpm changeset --empty\` for a change that does not belong in the changelog).`,
    );
    process.exit(1);
  }

  const wrongPackage = added.flatMap((file) => {
    const frontMatter = /^---\n([\s\S]*?)\n?---/.exec(readFileSync(file, 'utf8'))?.[1] ?? '';
    const names = [...frontMatter.matchAll(/^\s*['"]?([^'":]+)['"]?\s*:/gm)].map((m) => m[1]);
    return names.filter((name) => name !== 'scorpion').map((name) => `${file}: ${name}`);
  });
  if (wrongPackage.length > 0) {
    console.error(
      `Changesets may only name the package 'scorpion':\n  ${wrongPackage.join('\n  ')}`,
    );
    process.exit(1);
  }

  console.log(`Changesets added: ${added.join(', ')}`);
}
