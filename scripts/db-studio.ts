// `pnpm db:studio`: Drizzle Studio on the development database, bound to 127.0.0.1 and nowhere else.
// Studio can WRITE to the database; it is a development tool (CONTRIBUTING.md, "Drizzle Studio").
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envFile = resolve(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (process.env.NODE_ENV === 'production') {
  console.error('Drizzle Studio is a development tool and does not start with NODE_ENV=production.');
  process.exit(2);
}

const port = process.env.STUDIO_PORT ?? '4983';
const result = spawnSync(
  'pnpm',
  ['exec', 'drizzle-kit', 'studio', '--config', 'drizzle.config.ts', '--host', '127.0.0.1', '--port', port],
  { stdio: 'inherit', cwd: root },
);
process.exit(result.status ?? 1);
