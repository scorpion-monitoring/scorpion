// Checks the pictures `docShot()` took (CI job "Doc screenshots" and the docs export): every file is `jNN/NN-<slug>.light.png` or `.dark.png`,
// each picture has its pair in the other theme, each is a PNG of 1280 x 800, and there is at least one. Usage: node scripts/check-doc-shots.ts <dir>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const NAME = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.(light|dark)\.png$/;
const JOURNEY = /^j\d{2}$/;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const WIDTH = 1280;
export const HEIGHT = 800;

/** What is wrong with the pictures under `dir` (empty when all is well). */
export function checkDocShots(dir: string): string[] {
  const problems: string[] = [];
  const pairs = new Map<string, Set<string>>();
  let files = 0;
  for (const journey of readdirSync(dir, { withFileTypes: true })) {
    if (!journey.isDirectory() || !JOURNEY.test(journey.name)) {
      problems.push(`${journey.name}: not a journey folder like j06`);
      continue;
    }
    for (const file of readdirSync(join(dir, journey.name))) {
      const match = NAME.exec(file);
      if (!match) {
        problems.push(`${journey.name}/${file}: not named NN-<slug>.light.png or .dark.png`);
        continue;
      }
      files += 1;
      const bytes = readFileSync(join(dir, journey.name, file));
      if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG)) {
        problems.push(`${journey.name}/${file}: not a PNG`);
        continue;
      }
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      if (width !== WIDTH || height !== HEIGHT) {
        problems.push(`${journey.name}/${file}: ${width} x ${height}, not ${WIDTH} x ${HEIGHT}`);
      }
      const key = `${journey.name}/${match[1]}-${match[2]}`;
      pairs.set(key, (pairs.get(key) ?? new Set()).add(match[3]!));
    }
  }
  for (const [key, themes] of pairs) {
    for (const theme of ['light', 'dark']) {
      if (!themes.has(theme)) problems.push(`${key}: no ${theme} picture`);
    }
  }
  if (files === 0) problems.push('no pictures');
  return problems;
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node scripts/check-doc-shots.ts <dir>');
    process.exit(2);
  }
  const problems = checkDocShots(dir);
  if (problems.length > 0) {
    console.error(problems.map((problem) => `- ${problem}`).join('\n'));
    process.exit(1);
  }
  console.log(`The pictures in ${dir} are in order.`);
}
