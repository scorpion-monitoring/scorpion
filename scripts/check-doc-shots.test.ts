import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkDocShots } from './check-doc-shots.ts';

/** The first 24 bytes of a PNG: the signature, the length and name of the header, and the size. */
function png(width = 1280, height = 800): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12);
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

function folder(files: Record<string, Buffer | string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'doc-shots-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

describe('checkDocShots', () => {
  it('accepts a pair of 1280 x 800 pictures', () => {
    const dir = folder({ 'j06/01-wizard.light.png': png(), 'j06/01-wizard.dark.png': png() });
    expect(checkDocShots(dir)).toEqual([]);
  });

  it.each([
    ['a folder of pictures with none', {}, /no pictures/],
    ['a picture with no pair', { 'j06/01-a.light.png': png() }, /01-a: no dark picture/],
    [
      'a picture of the wrong size',
      { 'j06/01-a.light.png': png(800, 600), 'j06/01-a.dark.png': png() },
      /800 x 600/,
    ],
    [
      'a file that is no PNG',
      {
        'j06/01-a.light.png': 'text, not a picture, long enough to hold a header',
        'j06/01-a.dark.png': png(),
      },
      /not a PNG/,
    ],
    [
      'a name that does not follow the rule',
      { 'j06/wizard.light.png': png() },
      /not named NN-<slug>/,
    ],
    ['a folder that is no journey', { 'misc/01-a.light.png': png() }, /not a journey folder/],
  ])('refuses %s', (_name, files, problem) => {
    expect(checkDocShots(folder(files)).join('\n')).toMatch(problem);
  });
});
