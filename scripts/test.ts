// `pnpm test [--filter <package>]... [vitest args]`
// Runs the root Vitest config and maps pnpm-style `--filter` to Vitest's `--project`.
import { spawnSync } from 'node:child_process';

const args: string[] = [];
const input = process.argv.slice(2);
for (let i = 0; i < input.length; i++) {
  const arg = input[i]!;
  if (arg === '--filter' || arg === '-F') {
    const value = input[++i];
    if (!value) {
      console.error(`${arg} needs a package name`);
      process.exit(2);
    }
    args.push('--project', value);
  } else if (arg.startsWith('--filter=')) {
    args.push('--project', arg.slice('--filter='.length));
  } else {
    args.push(arg);
  }
}

const result = spawnSync('vitest', ['run', ...args], { stdio: 'inherit', shell: false });
process.exit(result.status ?? 1);
