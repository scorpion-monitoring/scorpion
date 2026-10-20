// The guard in front of the XLSX reader: what it lets through and what it refuses, each without ever handing the bytes to the
// reader. The bomb is a real one (60 MB inside, a few kB on disk); the lying bomb has headers that say 1 000 bytes.
import { describe, expect, it } from 'vitest';
import {
  bomb,
  encryptedEntry,
  lyingBomb,
  manyEntries,
  oleFile,
  rawWorkbook,
  workbook,
} from '../test/xlsx-fixtures.ts';
import {
  describeGuardFailure,
  guardXlsx,
  MAX_INFLATED_BYTES,
  MAX_ZIP_ENTRIES,
  type GuardCode,
} from './xlsx-guard.ts';

const refused = (bytes: Uint8Array): GuardCode | 'ok' => {
  const result = guardXlsx(bytes);
  return result.ok ? 'ok' : result.code;
};

describe('guardXlsx', () => {
  it('lets a normal workbook through and reports what it inflates to', async () => {
    const file = await workbook([
      ['Period', 'Downloads'],
      ['2026-01', 12],
    ]);
    const result = guardXlsx(file);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.inflated).toBeGreaterThan(0);
    expect(refused(rawWorkbook(''))).toBe('ok');
  });

  it('refuses a zip bomb from its declared sizes, without inflating it', () => {
    const file = bomb();
    expect(file.length).toBeLessThan(100_000);
    const started = performance.now();
    expect(refused(file)).toBe('declared-too-large');
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('refuses a bomb whose headers lie, by counting what it really inflates to', () => {
    const file = lyingBomb();
    const started = performance.now();
    expect(refused(file)).toBe('inflated-too-large');
    // one slice of input inflates to a few MB; the count stops at the cap, never at the 60 MB inside
    expect(performance.now() - started).toBeLessThan(3000);
  });

  it('accepts a file just under the cap and refuses one just over it (the cap is a parameter for the test)', () => {
    const file = rawWorkbook(
      `<row r="1"><c r="A1" t="inlineStr"><is><t>${'x'.repeat(5000)}</t></is></c></row>`,
    );
    expect(guardXlsx(file, { maxInflatedBytes: 100_000 }).ok).toBe(true);
    expect(guardXlsx(file, { maxInflatedBytes: 1000 })).toEqual({
      ok: false,
      code: 'declared-too-large',
    });
  });

  it('refuses a truncated file, a text file, a CSV named .xlsx and an empty file', async () => {
    const file = await workbook([['a'], ['b']]);
    expect(refused(file.subarray(0, file.length - 40))).toBe('not-a-zip');
    expect(refused(file.subarray(0, 10))).toBe('not-a-zip');
    expect(refused(new TextEncoder().encode('Period,Downloads\n2026-01,12\n'))).toBe('not-a-zip');
    expect(refused(new Uint8Array(0))).toBe('not-a-zip');
  });

  it('refuses an encrypted entry and a password-protected workbook (an OLE2 file)', async () => {
    expect(refused(encryptedEntry(rawWorkbook('')))).toBe('encrypted');
    expect(refused(oleFile())).toBe('encrypted');
  });

  it('refuses a zip with too many entries', () => {
    expect(refused(manyEntries(MAX_ZIP_ENTRIES + 1))).toBe('too-many-entries');
    expect(refused(manyEntries(10))).toBe('ok');
  });

  it('refuses damage in the central directory, never throwing', async () => {
    const file = Uint8Array.from(await workbook([['a'], ['b']]));
    const view = new DataView(file.buffer);
    for (let i = file.length - 22; i >= 0; i--)
      if (view.getUint32(i, true) === 0x06054b50) {
        view.setUint32(i + 16, 0xfffffff0, true); // a directory offset far outside the file
        break;
      }
    expect(refused(file)).toBe('corrupt');
    // random garbage with a zip's end signature in it
    const noise = new Uint8Array(500).map((_, i) => (i * 7) % 251);
    noise.set([0x50, 0x4b, 0x05, 0x06], 400);
    expect(() => guardXlsx(noise)).not.toThrow();
    expect(refused(noise)).not.toBe('ok');
  });

  it('has a sentence for every code that repeats nothing of the file', () => {
    const codes: GuardCode[] = [
      'not-a-zip',
      'encrypted',
      'zip64',
      'corrupt',
      'too-many-entries',
      'declared-too-large',
      'inflated-too-large',
    ];
    for (const code of codes) expect(describeGuardFailure(code).length).toBeGreaterThan(10);
    expect(MAX_INFLATED_BYTES).toBe(20 * 1024 * 1024);
  });
});
