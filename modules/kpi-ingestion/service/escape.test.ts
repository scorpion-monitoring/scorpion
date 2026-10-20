// Formula injection: every cell a spreadsheet would read as a formula gets a leading quote, and the reader takes it off again.
import { describe, expect, it } from 'vitest';
import { escapeCell, unescapeCell } from './escape.ts';

describe('escapeCell', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+SUM(A1)', "'+SUM(A1)"],
    ['-2+3', "'-2+3"],
    ['@cmd', "'@cmd"],
    ['\tx', "'\tx"],
    ['\rx', "'\rx"],
    ['=HYPERLINK("http://evil","x")', '\'=HYPERLINK("http://evil","x")'],
    ['Downloads', 'Downloads'],
    ['', ''],
    ['a=b', 'a=b'],
    [' =x', ' =x'],
    ["'quoted", "'quoted"],
    ['2026-05', '2026-05'],
  ])('writes %j as %j', (input, expected) => {
    expect(escapeCell(input)).toBe(expected);
  });

  it.each(['=1+1', '+1', '-1', '@x', '\tx', '\rx', 'plain', '', "'"])(
    'is undone for %j',
    (input) => {
      expect(unescapeCell(escapeCell(input))).toBe(input);
    },
  );

  it('leaves a text that starts with a quote and then something harmless', () => {
    expect(unescapeCell("'hello")).toBe("'hello");
    expect(unescapeCell("'")).toBe("'");
  });
});
