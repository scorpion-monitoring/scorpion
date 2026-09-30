// `pnpm db:generate --filter <package> [--name <migration name>]`: writes a new Drizzle
// migration for one package from its schema file. A module keeps its tables in `db/schema.ts` and
// its migrations in `migrations/`; the kernel uses `src/db/schema.ts` and `migrations/`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { scanModulePackages } from '@scorpion/kernel';

const { values } = parseArgs({
  options: { filter: { type: 'string', short: 'F' }, name: { type: 'string' } },
});
if (!values.filter) {
  console.error('Usage: pnpm db:generate --filter <package name> [--name <migration name>]');
  process.exit(2);
}

const root = resolve(import.meta.dirname, '..');
const candidates = scanModulePackages(
  ['modules', 'packages', 'packages/kernel/test/fixtures/modules'].map((dir) => join(root, dir)),
);
const pkg = candidates.find((candidate) => candidate.name === values.filter);
if (!pkg) {
  console.error(`No package named "${values.filter}" under modules/ or packages/.`);
  process.exit(2);
}

const schema = ['db/schema.ts', 'src/db/schema.ts']
  .map((file) => join(pkg.dir, file))
  .find(existsSync);
if (!schema) {
  console.error(`${pkg.name} has no db/schema.ts (or src/db/schema.ts).`);
  process.exit(2);
}

const args = [
  'drizzle-kit',
  'generate',
  '--dialect',
  'postgresql',
  '--schema',
  schema,
  '--out',
  join(pkg.dir, 'migrations'),
];
if (values.name) args.push('--name', values.name);
const result = spawnSync('pnpm', ['exec', ...args], { stdio: 'inherit', cwd: root });
process.exit(result.status ?? 1);
