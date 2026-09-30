// `pnpm dev`: everything you need for local work, in one command.
//
//   1. .env is created from .env.example when it is missing.
//   2. The server is generated for PROFILE (default `full`); if that changed which modules it
//      depends on, `pnpm install` links them.
//   3. Postgres and Mailpit start (docker compose), and the server and the web app run. The
//      server applies pending migrations when it starts.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const run = (command: string, args: string[]) =>
  spawnSync(command, args, { cwd: root, stdio: 'inherit', encoding: 'utf8' });

if (!existsSync(resolve(root, '.env'))) {
  copyFileSync(resolve(root, '.env.example'), resolve(root, '.env'));
  console.log('Created .env from .env.example');
}

const profile = process.env.PROFILE || 'full';
const generated = spawnSync('node', ['apps/server/src/cli.ts', 'profile:generate', profile], {
  cwd: root,
  encoding: 'utf8',
});
process.stdout.write(generated.stdout);
process.stderr.write(generated.stderr);
if (generated.status !== 0) process.exit(generated.status ?? 1);
if (generated.stdout.includes('wrote')) {
  console.log('The modules of the server changed; installing…');
  if (run('pnpm', ['install']).status !== 0) process.exit(1);
}

if (run('docker', ['compose', '-f', 'docker-compose.dev.yml', 'up', '-d', '--wait']).status !== 0) {
  process.exit(1);
}

const dev = spawn(
  'pnpm',
  ['--parallel', '--filter', '@scorpion/server', '--filter', '@scorpion/web', 'dev'],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PROFILE: profile },
  },
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => dev.kill(signal));
dev.on('exit', (code) => process.exit(code ?? 0));
