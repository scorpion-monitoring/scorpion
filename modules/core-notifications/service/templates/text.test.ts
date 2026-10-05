import { describe, expect, it } from 'vitest';
import { escapeHtml, multiLine, oneLine, safeUrl } from './text.ts';

describe('oneLine', () => {
  it.each([
    ['plain text', 'Reset your password', 'Reset your password'],
    ['a line feed', 'a\nb', 'a b'],
    ['CR LF (header injection)', 'Hello\r\nBcc: x@example.org', 'Hello Bcc: x@example.org'],
    ['a line separator and a paragraph separator', 'a\u2028b\u2029c', 'a b c'],
    ['a NUL and other controls', 'a\u0000b\u001Fc\u007Fd', 'a b c d'],
    ['a right-to-left override', 'evil\u202Egnp.exe', 'evilgnp.exe'],
    ['an isolate and a mark', 'a\u2066b\u200Fc', 'abc'],
    ['runs of spaces and tabs', '  a \t\t b  ', 'a b'],
  ])('%s', (_name, input, expected) => {
    expect(oneLine(input)).toBe(expected);
  });

  it('cuts to the maximum length', () => {
    expect(oneLine('x'.repeat(500), 10)).toBe('xxxxxxxxxx');
  });
});

describe('multiLine', () => {
  it.each([
    ['keeps a line feed', 'a\nb', 'a\nb'],
    ['turns CR LF and CR into line feeds', 'a\r\nb\rc', 'a\nb\nc'],
    ['removes a bidirectional override', 'a\u202Eb', 'ab'],
    ['removes other controls and separators', 'a\u0000b\u2028c', 'abc'],
  ])('%s', (_name, input, expected) => {
    expect(multiLine(input)).toBe(expected);
  });
});

describe('escapeHtml', () => {
  it.each([
    ['<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
    ['"quoted" & \'single\'', '&quot;quoted&quot; &amp; &#39;single&#39;'],
    ['already &amp; escaped', 'already &amp;amp; escaped'],
    ['plain', 'plain'],
  ])('%s', (input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
  });
});

describe('safeUrl', () => {
  it.each([
    ['https://example.org/a?b=1#c', 'https://example.org/a?b=1#c'],
    ['http://localhost:3000/x', 'http://localhost:3000/x'],
    ['mailto:help@example.org', 'mailto:help@example.org'],
    ['javascript:alert(1)', undefined],
    ['JAVASCRIPT:alert(1)', undefined],
    ['data:text/html,<script>', undefined],
    ['/relative/path', undefined],
    ['https://example.org/a b', undefined],
    ['https://example.org/\n', 'https://example.org/'],
    ['', undefined],
    ['https://example.org/' + 'a'.repeat(3000), undefined],
  ])('%s', (input, expected) => {
    expect(safeUrl(input)).toBe(expected);
  });
});
