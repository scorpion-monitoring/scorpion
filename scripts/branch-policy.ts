// Branch policy (CONTRIBUTING.md, "Branches"): which branch may be merged into which.
//
// `node scripts/branch-policy.ts <head> <base>` exits 1 if a pull request from <head> into <base>
// breaks the policy. CI runs it on every pull request.

export type BranchKind = 'main' | 'dev' | 'feature' | 'release' | 'hotfix';

const PATTERNS: [BranchKind, RegExp][] = [
  ['main', /^main$/],
  ['dev', /^dev$/],
  ['feature', /^feature\/[a-z0-9][a-z0-9.-]*$/],
  ['release', /^release\/\d+\.\d+\.\d+$/],
  ['hotfix', /^hotfix\/\d+\.\d+\.\d+$/],
];

/** Target branch kind → branch kinds that may be merged into it. */
const ALLOWED_SOURCES: Record<BranchKind, BranchKind[]> = {
  main: ['release', 'hotfix'],
  // Feature work, plus merging releases and hotfixes back.
  dev: ['feature', 'release', 'hotfix', 'main'],
  // Fixes found while stabilising a release.
  release: ['feature'],
  feature: [],
  hotfix: [],
};

export function branchKind(branch: string): BranchKind | undefined {
  return PATTERNS.find(([, pattern]) => pattern.test(branch))?.[0];
}

/** Returns why a pull request from `head` into `base` is not allowed, or undefined if it is. */
export function checkPullRequest(head: string, base: string): string | undefined {
  const headKind = branchKind(head);
  if (!headKind) {
    return `Branch '${head}' does not follow the naming policy: use feature/<topic>, release/<x.y.z> or hotfix/<x.y.z>.`;
  }
  const baseKind = branchKind(base);
  if (!baseKind) return `Pull requests may not target '${base}'.`;
  if (!ALLOWED_SOURCES[baseKind].includes(headKind)) {
    const allowed = ALLOWED_SOURCES[baseKind];
    return allowed.length === 0
      ? `Pull requests may not target a ${baseKind} branch ('${base}').`
      : `'${head}' may not be merged into '${base}'. Allowed sources: ${allowed.join(', ')}.`;
  }
  return undefined;
}

if (import.meta.main) {
  const [head, base] = process.argv.slice(2);
  if (!head || !base) {
    console.error('usage: node scripts/branch-policy.ts <head> <base>');
    process.exit(2);
  }
  const error = checkPullRequest(head, base);
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log(`'${head}' → '${base}' follows the branch policy.`);
}
