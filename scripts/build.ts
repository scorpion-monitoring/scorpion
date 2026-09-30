// `pnpm build [--profile <name>]`: builds the container image for one deployment profile
// (default `full`) and tags it `scorpion:dev-<name>`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    profile: { type: 'string', default: 'full' },
    tag: { type: 'string' },
    // For the test fixtures: a profile file outside profiles/, and where its modules live.
    'profile-file': { type: 'string' },
    'modules-root': { type: 'string', multiple: true },
  },
});

const profile = values.profile;
const profileFile = values['profile-file'] ?? `profiles/${profile}.ts`;
if (!existsSync(profileFile)) {
  console.error(`Unknown profile '${profile}': ${profileFile} does not exist.`);
  process.exit(2);
}

const tag = values.tag ?? `scorpion:dev-${profile}`;
const args = [
  'build',
  '-f',
  'docker/Dockerfile',
  '--build-arg',
  `PROFILE=${profile}`,
  ...(values['profile-file'] ? ['--build-arg', `PROFILE_FILE=${values['profile-file']}`] : []),
  ...(values['modules-root']
    ? ['--build-arg', `MODULE_ROOTS=${values['modules-root'].join(' ')}`]
    : []),
  '-t',
  tag,
  '.',
];
console.log(`docker ${args.join(' ')}`);
const result = spawnSync('docker', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
