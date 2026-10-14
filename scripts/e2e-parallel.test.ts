import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GROUPS, runOf } from './e2e-parallel.ts';

// The stacks of the suite, read from their source: a root script cannot import the web app's test support (its own
// TypeScript project), and the point is that this list and the groups never drift apart.
const source = readFileSync(
  resolve(import.meta.dirname, '../apps/web/e2e/support/stack.ts'),
  'utf8',
);
const SPECS = [...source.matchAll(/\{ name: '([a-z-]+)', basePath: '([^']+)'/g)].map(
  ([, name, basePath]) => ({ name: name!, basePath: basePath! }),
);

describe('the parallel end-to-end runs', () => {
  it('sees the four stacks of the suite', () => {
    expect(SPECS.map((spec) => spec.name)).toEqual([
      'root',
      'nested',
      'fresh-root',
      'fresh-nested',
    ]);
  });

  it('cover every project of the suite exactly once', () => {
    const projects = GROUPS.flatMap((group) => group.projects).sort();
    expect(projects).toEqual([...SPECS.map((spec) => spec.name), 'components'].sort());
  });

  it('keep a base path to one run: the stacks of a run are the projects it runs', () => {
    for (const group of GROUPS) {
      const bases = new Set(
        group.projects
          .flatMap((name) => SPECS.filter((spec) => spec.name === name))
          .map((s) => s.basePath),
      );
      expect(bases.size, group.name).toBe(1);
    }
  });

  it('give each run its own output, JUnit file and report, so two runs never clean or overwrite each other', () => {
    const runs = GROUPS.map((group) => runOf(group, '/tmp/reports', []));
    for (const key of ['PLAYWRIGHT_JUNIT_OUTPUT_FILE', 'PLAYWRIGHT_HTML_OUTPUT_DIR'] as const) {
      expect(new Set(runs.map((run) => run.env[key])).size).toBe(runs.length);
    }
    const outputs = runs.map((run) => run.args[run.args.indexOf('--output') + 1]);
    expect(new Set(outputs).size).toBe(runs.length);
    // Inside test-results, never test-results itself: the stack logs live there.
    for (const output of outputs) expect(output).toMatch(/^test-results\/[a-z]+$/);
    for (const run of runs) expect(run.env.E2E_KEEP_BUILD).toBe('1');
  });

  it('start only the stacks of their own projects, and pass extra arguments on', () => {
    const run = runOf(GROUPS[1]!, '/tmp/reports', ['-g', 'reference']);
    expect(run.env.E2E_STACKS).toBe('nested,fresh-nested');
    expect(run.args).toContain('--pass-with-no-tests');
    expect(run.args.slice(-2)).toEqual(['-g', 'reference']);
  });
});
