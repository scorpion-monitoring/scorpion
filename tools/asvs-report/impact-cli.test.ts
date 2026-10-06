import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const cli = new URL('./impact-cli.ts', import.meta.url).pathname;

/** A repository whose `main` is the base and whose branch changes the given files. */
function pullRequest(changed: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'asvs-impact-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.org');
  git('config', 'user.name', 't');
  writeFileSync(join(root, 'base.txt'), 'base');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', '-b', 'feature/x');
  for (const [file, content] of Object.entries(changed)) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'change');
  return root;
}

function run(root: string, env: Record<string, string>) {
  const result = spawnSync('node', [cli, 'origin/main'], {
    cwd: root,
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe('impact-cli', () => {
  it('passes a pull request that changes no scoped path', () => {
    expect(run(pullRequest({ 'docs/other.md': 'x' }), {}).status).toBe(0);
  });

  it('fails a scoped change with no label and no description', () => {
    const result = run(pullRequest({ 'modules/core-authz/a.ts': 'x' }), {});
    expect(result.status).toBe(1);
    expect(result.output).toContain('v8-authorization.yaml');
  });

  it('passes a scoped change that carries its chapter file', () => {
    const root = pullRequest({
      'modules/core-authz/a.ts': 'x',
      'docs/security/asvs/v8-authorization.yaml': 'x',
    });
    expect(run(root, {}).status).toBe(0);
  });

  it('passes a scoped change with the label and a reason', () => {
    const root = pullRequest({ 'modules/core-authz/a.ts': 'x' });
    const env = {
      PR_LABELS: '["asvs-no-impact"]',
      PR_BODY: 'Text\n\nASVS impact: none because only a comment changed',
    };
    expect(run(root, env).status).toBe(0);
  });

  it('fails with the label but no reason', () => {
    const root = pullRequest({ 'modules/core-authz/a.ts': 'x' });
    expect(run(root, { PR_LABELS: '["asvs-no-impact"]', PR_BODY: 'No reason' }).status).toBe(1);
  });

  it('treats malformed labels as no labels', () => {
    const root = pullRequest({ 'modules/core-authz/a.ts': 'x' });
    expect(
      run(root, { PR_LABELS: 'not json', PR_BODY: 'ASVS impact: none because a rename' }).status,
    ).toBe(1);
  });

  it('never runs text from the description or the labels', () => {
    const root = pullRequest({ 'modules/core-authz/a.ts': 'x' });
    const marker = join(root, 'pwned');
    const payload = `$(touch ${marker}); \`touch ${marker}\`; touch ${marker}`;
    const env = {
      PR_LABELS: JSON.stringify(['asvs-no-impact', payload]),
      PR_BODY: `ASVS impact: none because ${payload}`,
    };
    const result = run(root, env);
    expect(existsSync(marker)).toBe(false);
    expect(result.status).toBe(0);
    expect(result.output).toContain(payload);
  });

  it('refuses a base ref that looks like an option', () => {
    const result = spawnSync('node', [cli, '--output=x'], { encoding: 'utf8' });
    expect(result.status).toBe(2);
  });
});

describe('the asvs-impact workflow', () => {
  const text = readFileSync(
    new URL('../../.github/workflows/asvs-impact.yml', import.meta.url),
    'utf8',
  );
  const workflow = parse(text) as {
    on: Record<string, { types: string[] }>;
    permissions: Record<string, string>;
    jobs: Record<
      string,
      {
        permissions: Record<string, string>;
        steps: { run?: string; env?: Record<string, string> }[];
      }
    >;
  };

  it('runs on pull_request, never pull_request_target, and again when a label or the description changes', () => {
    expect(Object.keys(workflow.on)).toEqual(['pull_request']);
    expect(workflow.on.pull_request?.types).toEqual(
      expect.arrayContaining(['labeled', 'unlabeled', 'edited']),
    );
  });

  it('asks for read access only, and pull-requests: read on the job only', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs.impact?.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'read',
    });
  });

  it('puts no expression inside a run script', () => {
    for (const step of workflow.jobs.impact?.steps ?? [])
      expect(step.run ?? '').not.toContain('${{');
  });

  it('passes the labels and the description through env', () => {
    const env = workflow.jobs.impact?.steps.find((step) => step.run)?.env;
    expect(env).toMatchObject({
      PR_LABELS: expect.stringContaining('github.event.pull_request.labels') as unknown,
      PR_BODY: expect.stringContaining('github.event.pull_request.body') as unknown,
    });
  });
});
