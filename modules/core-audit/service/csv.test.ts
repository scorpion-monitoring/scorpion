import { describe, expect, it } from 'vitest';
import { csvCell, csvRow } from './csv.ts';

describe('csvCell', () => {
  it.each([
    ['plain', 'plain'],
    ['', ''],
    [null, ''],
    [undefined, ''],
    [42, '42'],
    [true, 'true'],
    [new Date('2026-10-05T10:00:00.000Z'), '2026-10-05T10:00:00.000Z'],
    // quoting
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line\nbreak', '"line\nbreak"'],
    ['cr\rhere', '"cr\rhere"'],
    // objects are JSON
    [{ a: 1 }, '"{""a"":1}"'],
    [[1, 2], '"[1,2]"'],
  ])('%j → %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  describe('formula injection guard', () => {
    it.each([
      ['=1+1', "'=1+1"],
      ['+cmd|calc', "'+cmd|calc"],
      ['-2+3', "'-2+3"],
      ['@SUM(A1)', "'@SUM(A1)"],
      ['\t=1', "'\t=1"],
      ['\r=1', '"\'\r=1"'],
      ['=HYPERLINK("http://evil","x")', `"'=HYPERLINK(""http://evil"",""x"")"`],
      ['=a,b', `"'=a,b"`],
    ])('%j → %j', (input, expected) => {
      expect(csvCell(input)).toBe(expected);
    });

    it('does not touch a number or a sign inside the text', () => {
      expect(csvCell(-5)).toBe('-5');
      expect(csvCell('a=b')).toBe('a=b');
      expect(csvCell('x-y')).toBe('x-y');
      expect(csvCell('2026-10-05')).toBe('2026-10-05');
    });

    it('guards a path or action an attacker chose, not only the first column', () => {
      expect(csvRow(['id', '=cmd()', 3])).toBe("id,'=cmd(),3\r\n");
    });
  });
});

describe('csvRow', () => {
  it('ends with CRLF', () => {
    expect(csvRow(['a', 'b'])).toBe('a,b\r\n');
  });
});
