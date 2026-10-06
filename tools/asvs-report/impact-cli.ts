// `node tools/asvs-report/impact-cli.ts <base-ref>` in the `asvs-impact` workflow.
// The labels (a JSON array) and the description arrive in the environment, so they stay data.
import { execFileSync } from 'node:child_process';
import { checkImpact } from './impact.ts';

function labelsFrom(json: string | undefined): string[] {
  try {
    const value: unknown = JSON.parse(json || '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

if (import.meta.main) {
  const base = process.argv[2];
  if (!base || base.startsWith('-')) {
    console.error('usage: impact-cli.ts <base-ref>');
    process.exit(2);
  }
  const changedFiles = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  const result = checkImpact({
    changedFiles,
    labels: labelsFrom(process.env.PR_LABELS),
    description: process.env.PR_BODY ?? '',
  });
  console.log(result.message);
  process.exit(result.ok ? 0 : 1);
}
