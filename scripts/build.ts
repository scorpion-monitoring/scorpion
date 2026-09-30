// `pnpm build [--profile <name>]`: builds the container image for one deployment profile
// (default `full`) and tags it `scorpion:dev-<name>`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    profile: { type: 'string', default: 'full' },
    tag: { type: 'string' },
  },
});

const profile = values.profile;
if (!existsSync(`profiles/${profile}.ts`)) {
  console.error(`Unknown profile '${profile}': profiles/${profile}.ts does not exist.`);
  process.exit(2);
}

const tag = values.tag ?? `scorpion:dev-${profile}`;
const args = [
  'build',
  '-f',
  'docker/Dockerfile',
  '--build-arg',
  `PROFILE=${profile}`,
  '-t',
  tag,
  '.',
];
console.log(`docker ${args.join(' ')}`);
const result = spawnSync('docker', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
