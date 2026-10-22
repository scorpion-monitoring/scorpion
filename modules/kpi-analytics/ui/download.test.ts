import { describe, expect, it } from 'vitest';
import { fileNameOf } from './download.ts';

describe('fileNameOf', () => {
  it.each([
    ['attachment; filename="de-nbi-kpis-1y.xlsx"', 'de-nbi-kpis-1y.xlsx'],
    ['attachment; filename=plain.csv', 'plain.csv'],
    ["attachment; filename*=UTF-8''gr%C3%BC%C3%9Fe.csv", 'grüße.csv'],
    // never a path
    ['attachment; filename="../../etc/passwd"', 'passwd'],
    ['attachment; filename="C:\\temp\\x.csv"', 'x.csv'],
    // nothing usable: the fallback
    [null, 'fallback.csv'],
    ['attachment', 'fallback.csv'],
    ['attachment; filename=""', 'fallback.csv'],
    ['attachment; filename="%E0%A4%A"', 'fallback.csv'],
  ])('reads %j as %j', (header, expected) => {
    expect(fileNameOf(header, 'fallback.csv')).toBe(expected);
  });
});
