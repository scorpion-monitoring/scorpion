// `pnpm dev`: everything you need for local work, in one command.
//
//   1. .env is created from .env.example when it is missing, and gets a SECRETS_KEY of its own
//      when it has none (core.settings will not start without one).
//   2. The server is generated for PROFILE (default `full`); if that changed which modules it
//      depends on, `pnpm install` links them.
//   3. Postgres and Mailpit start (docker compose). A profile with core.notifications gets its mail
//      settings pointed at that Mailpit (`scorpion seed-dev-mail`, development only, never over
//      settings that are already stored).
//   4. The server and the web app run, as in an image (ADR-0027): the web app is the public origin on PORT
//      and proxies `/api`, `/healthz` and `/readyz` to the API, which listens on API_PORT (default PORT + 1)
//      and applies pending migrations when it starts.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const run = (command: string, args: string[]) =>
  spawnSync(command, args, { cwd: root, stdio: 'inherit', encoding: 'utf8' });

const envFile = resolve(root, '.env');
if (!existsSync(envFile)) {
  copyFileSync(resolve(root, '.env.example'), envFile);
  console.log('Created .env from .env.example');
}
// A development key, generated here and never printed. An existing key is left alone.
if (!/^SECRETS_KEY=\S/m.test(readFileSync(envFile, 'utf8'))) {
  const key = randomBytes(32).toString('base64');
  const text = readFileSync(envFile, 'utf8');
  if (/^SECRETS_KEY=\s*$/m.test(text)) {
    writeFileSync(envFile, text.replace(/^SECRETS_KEY=\s*$/m, `SECRETS_KEY=${key}`));
  } else {
    appendFileSync(envFile, `${text.endsWith('\n') ? '' : '\n'}SECRETS_KEY=${key}\n`);
  }
  console.log('Generated a SECRETS_KEY in .env (development only; keep it with the database)');
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

// Local mail goes to Mailpit. Only a profile with core.notifications has the command; for the others
// there is nothing to seed. A failure here must not stop development: the seed is a convenience.
const seed = spawnSync('node', ['apps/server/src/cli.ts', 'seed-dev-mail'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, PROFILE: profile, NODE_ENV: process.env.NODE_ENV ?? 'development' },
});
if (seed.status === 0) process.stdout.write(seed.stdout);
else if (!seed.stderr.includes('Unknown command')) {
  process.stderr.write(seed.stderr);
  console.warn('Could not point the mail settings at Mailpit; set them in the settings instead.');
}

// The web app is what you open; the API sits behind it, on its own port, as in an image.
const env = readFileSync(envFile, 'utf8');
const fromEnvFile = (name: string) => new RegExp(`^${name}=(\\S+)`, 'm').exec(env)?.[1];
const port = process.env.PORT ?? fromEnvFile('PORT') ?? '3000';
const apiPort = process.env.API_PORT ?? String(Number(port) + 1);
const dev = spawn(
  'pnpm',
  ['--parallel', '--filter', '@scorpion/server', '--filter', '@scorpion/web', 'dev'],
  {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      PROFILE: profile,
      PORT: port,
      // The server reads PORT as the port to listen on; the web app reads it as its own.
      API_PORT: apiPort,
      API_ORIGIN: `http://127.0.0.1:${apiPort}`,
    },
  },
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => dev.kill(signal));
dev.on('exit', (code) => process.exit(code ?? 0));
