import { describe, expect, it } from 'vitest';
import { miniSource } from './fixtures.ts';
import { CHAPTERS } from './config.ts';
import { assessed, checkSourceHash, readChapter, recordedHash, sha256 } from './source.ts';

const v6 = CHAPTERS[0]!;

describe('readChapter', () => {
  it('reads ids, levels and sections from the source', () => {
    const chapter = readChapter(miniSource(), v6);
    expect(chapter.requirements.map((r) => [r.id, r.number, r.level])).toEqual([
      ['v5.0.0-6.1.1', '6.1.1', 1],
      ['v5.0.0-6.1.2', '6.1.2', 2],
      ['v5.0.0-6.1.3', '6.1.3', 3],
    ]);
    expect(chapter.requirements[0]?.section).toBe('V6.1 Section');
  });

  it('assesses Level 1 and Level 2 only', () => {
    expect(assessed(readChapter(miniSource(), v6)).map((r) => r.number)).toEqual([
      '6.1.1',
      '6.1.2',
    ]);
  });

  it('refuses another ASVS version', () => {
    const other = miniSource().replace('"5.0.0"', '"4.0.3"');
    expect(() => readChapter(other, v6)).toThrow(/expected 5.0.0/);
  });

  it('refuses a chapter whose name is not the one config.ts assumes', () => {
    expect(() =>
      readChapter(miniSource().replace('"Authentication"', '"Something else"'), v6),
    ).toThrow(/not "Authentication"/);
  });

  it('refuses a source without the chapter', () => {
    expect(() => readChapter(JSON.stringify({ Version: '5.0.0', Requirements: [] }), v6)).toThrow(
      /no chapter V6/,
    );
  });
});

describe('the pinned hash', () => {
  const raw = miniSource();
  const readme = `Licence text\n\nSHA-256: \`${sha256(raw)}\`\n`;

  it('accepts the recorded hash', () => {
    expect(checkSourceHash(Buffer.from(raw), readme)).toEqual([]);
  });

  it('fails when the file differs from the record', () => {
    const problems = checkSourceHash(Buffer.from(raw + ' '), readme);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/does not match its recorded SHA-256/);
  });

  it.each([[undefined], ['no hash here'], ['SHA-256: `abc`']])(
    'fails when the README records no usable hash (%s)',
    (text) => {
      expect(checkSourceHash(Buffer.from(raw), text)[0]).toMatch(/does not record the SHA-256/);
    },
  );

  it('reads the hash from the README', () => {
    expect(recordedHash(readme)).toBe(sha256(raw));
  });
});
