// `pnpm test:e2e:parallel [playwright args]`: the end-to-end suite in two runs at once, one per base path.
//
// `pnpm test:e2e` runs one Playwright process with one worker, so the two base paths (`/` and `/a/b`) and the
// fresh-install stacks run one after the other: about 20 minutes. The stacks of the two base paths share nothing (each
// has its own ports, its own processes and, in its own run, its own database), so this starts one run for `/` (with the
// fresh install and the component harness) and one for `/a/b`, builds the web app once, and joins the JUnit files the way CI
// does. Every run keeps one worker, so no two specs share a stack. CI shards instead (`--shard`); this is for a machine
// with the cores to spare.
//
// Extra arguments go to both runs (`pnpm test:e2e:parallel -g "reference"`).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');

interface Group {
  name: string;
  /** The Playwright projects of the run, which are also the stacks it starts (`E2E_STACKS`). */
  projects: string[];
}

export const GROUPS: Group[] = [
  { name: 'root', projects: ['root', 'fresh-root', 'components'] },
  { name: 'nested', projects: ['nested', 'fresh-nested'] },
];

/** The environment and arguments of one run: its own output folders, so two runs never clean each other's files. */
export function runOf(group: Group, report: string, extra: string[]) {
  return {
    args: [
      '--filter',
      '@scorpion/web',
      'exec',
      'playwright',
      'test',
      ...group.projects.flatMap((project) => ['--project', project]),
      // Inside test-results, where the stack logs are written; Playwright empties only this folder.
      '--output',
      `test-results/${group.name}`,
      ...(extra.length > 0 ? ['--pass-with-no-tests'] : []),
      ...extra,
    ],
    env: {
      E2E_KEEP_BUILD: '1',
      E2E_STACKS: group.projects.join(','),
      PLAYWRIGHT_JUNIT_OUTPUT_FILE: `../../reports/playwright-junit-${group.name}.xml`,
      PLAYWRIGHT_HTML_OUTPUT_DIR: resolve(report, group.name),
    },
  };
}

function prefixed(label: string, stream: NodeJS.ReadableStream) {
  let rest = '';
  stream.on('data', (chunk: Buffer) => {
    const lines = (rest + chunk.toString()).split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) console.log(`[${label}] ${line}`);
  });
  stream.on('end', () => rest && console.log(`[${label}] ${rest}`));
}

function main() {
  const extra = process.argv.slice(2);
  const started = Date.now();
  const build = spawnSync('pnpm', ['--filter', '@scorpion/web', 'exec', 'vite', 'build'], {
    cwd: repo,
    stdio: 'inherit',
  });
  if (build.status !== 0) process.exit(build.status ?? 1);

  // The HTML reports are for a failure someone wants to open; they stay out of the repository.
  const report = mkdtempSync(resolve(tmpdir(), 'scorpion-e2e-report-'));
  mkdirSync(resolve(repo, 'reports'), { recursive: true });
  let failed = 0;
  let open = GROUPS.length;
  for (const group of GROUPS) {
    const run = runOf(group, report, extra);
    const child = spawn('pnpm', run.args, {
      cwd: repo,
      env: { ...process.env, CI: process.env.CI ?? 'true', ...run.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    prefixed(group.name, child.stdout);
    prefixed(group.name, child.stderr);
    child.on('close', (code) => {
      console.log(`[${group.name}] exit ${code}`);
      if (code !== 0) failed += 1;
      if (--open > 0) return;
      // `pnpm security:asvs` reads one file; CI joins its shards' files the same way.
      const joined = GROUPS.map((entry) => {
        try {
          return readFileSync(resolve(repo, `reports/playwright-junit-${entry.name}.xml`), 'utf8');
        } catch {
          return '';
        }
      }).join('');
      writeFileSync(resolve(repo, 'reports/playwright-junit.xml'), joined);
      console.log(
        `e2e: ${failed === 0 ? 'passed' : `${failed} of ${GROUPS.length} runs failed`} in ${Math.round((Date.now() - started) / 1000)} s; HTML reports in ${report}`,
      );
      process.exit(failed === 0 ? 0 : 1);
    });
  }
}

if (import.meta.main) main();
