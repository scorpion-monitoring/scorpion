import { writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scorpionVersion } from './version.ts';

describe('scorpionVersion', () => {
  it('reads the version of the root package of the repository', () => {
    expect(scorpionVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it.each([
    ['a file without a version', '{"name":"x"}'],
    ['a version that is no string', '{"version":3}'],
    ['a file that is no JSON', 'nope'],
  ])('says unknown for %s', async (_name, content) => {
    const file = join(await mkdtemp(join(tmpdir(), 'scorpion-version-')), 'package.json');
    writeFileSync(file, content);
    expect(scorpionVersion(pathToFileURL(file))).toBe('unknown');
  });

  it('says unknown for a file that is not there', () => {
    expect(scorpionVersion(new URL('file:///no/such/package.json'))).toBe('unknown');
  });
});
