import { describe, expect, it } from 'vitest';
import { renderMarkdown, sanitizeHtml } from './index.ts';

describe('renderMarkdown', () => {
  it.each([
    ['a heading', '# Terms', '<h1>Terms</h1>'],
    ['a paragraph of two lines', 'one\ntwo', '<p>one two</p>'],
    ['bold and italic', '**a** and *b*', '<p><strong>a</strong> and <em>b</em></p>'],
    ['inline code', 'use `x < y`', '<p>use <code>x &lt; y</code></p>'],
    ['a bullet list', '- a\n- b', '<ul><li>a</li><li>b</li></ul>'],
    ['a numbered list', '1. a\n2. b', '<ol><li>a</li><li>b</li></ol>'],
    ['a rule', '---', '<hr>'],
    ['a quote', '> hi', '<blockquote><p>hi</p></blockquote>'],
    ['fenced code', '```\n<b>x</b>\n```', '<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>'],
  ])('renders %s', (_name, input, expected) => {
    expect(renderMarkdown(input)).toBe(expected);
  });

  it('links to https, mailto and relative targets, with rel set', () => {
    const out = renderMarkdown(
      '[a](https://example.org/x?a=1&b=2) [m](mailto:a@example.org) [r](/legal/terms)',
    );
    expect(out).toContain('href="https://example.org/x?a=1&amp;b=2"');
    expect(out).toContain('href="mailto:a@example.org"');
    expect(out).toContain('href="/legal/terms"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it.each([
    ['raw script', '<script>alert(1)</script>'],
    ['raw image with a handler', '<img src=x onerror=alert(1)>'],
    ['a javascript link', '[x](javascript:alert(1))'],
    ['a data link', '[x](data:text/html;base64,PHNjcmlwdD4=)'],
    ['a protocol-relative link', '[x](//evil.example)'],
    ['an attribute break-out', '[x](https://a.example/"onmouseover="alert(1))'],
    ['a handler in a heading', '# <svg onload=alert(1)>'],
  ])('does not let %s through', (_name, input) => {
    const out = renderMarkdown(input);
    // Text such as `&lt;svg onload=…&gt;` is inert; what must not exist is a tag or an attribute.
    expect(out).not.toMatch(/<(script|img|svg|iframe)\b/i);
    expect(out).not.toMatch(/<[^>]*\son\w+=/i);
    expect(out).not.toMatch(/href="(javascript|data|\/\/)/i);
    expect(out).not.toMatch(/<[^>]*"onmouseover/i);
  });

  it('shows raw HTML as text', () => {
    expect(renderMarkdown('<b>x</b>')).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>');
  });
});

describe('sanitizeHtml', () => {
  it('keeps formatting and drops everything that executes', () => {
    const out = sanitizeHtml(
      '<p onclick="x()">hi <b>there</b> <a href="javascript:x()">l</a><script>x()</script><img src=x></p>',
    );
    expect(out).toBe('<p>hi there <a rel="noopener noreferrer" target="_blank">l</a></p>');
  });
});
