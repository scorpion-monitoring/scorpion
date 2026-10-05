import { describe, expect, it } from 'vitest';
import { InvalidSvg, sanitizeSvg } from './index.ts';

const wrap = (inner: string, attributes = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"${attributes}>${inner}</svg>`;

describe('sanitizeSvg', () => {
  it('keeps a plain drawing, with the namespace', () => {
    const out = sanitizeSvg(
      '<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="red"/></svg>',
    );
    expect(out).toMatch(/^<svg\b/);
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('<rect');
  });

  it('keeps a gradient that refers to itself and nothing else', () => {
    const out = sanitizeSvg(
      wrap(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="5" height="5" fill="url(#g)"/>',
      ),
    );
    expect(out).toContain('url(#g)');
  });

  it.each([
    ['a script element', wrap('<script>alert(1)</script><rect width="1" height="1"/>'), '<script'],
    ['an event handler', wrap('<rect width="1" height="1" onclick="alert(1)"/>'), 'onclick'],
    ['an onload on the root', wrap('<rect width="1" height="1"/>', ' onload="alert(1)"'), 'onload'],
    [
      'a foreignObject with HTML',
      wrap(
        '<foreignObject><iframe src="https://evil.example"></iframe><div>x</div></foreignObject>',
      ),
      'foreignObject',
    ],
    ['an iframe', wrap('<iframe src="https://evil.example"></iframe>'), 'iframe'],
    [
      'a javascript: link',
      wrap('<a href="javascript:alert(1)"><rect width="1" height="1"/></a>'),
      'javascript',
    ],
    [
      'a style element',
      wrap('<style>rect{fill:url(https://evil.example/x)}</style>'),
      'evil.example',
    ],
    ['an external image', wrap('<image href="https://evil.example/x.png"/>'), 'evil.example'],
    ['a data: image', wrap('<image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/>'), 'data:'],
    [
      'an external fill',
      wrap('<rect width="1" height="1" fill="url(https://evil.example/f)"/>'),
      'evil.example',
    ],
    [
      'an animation that sets a handler',
      wrap('<rect id="r"/><set attributeName="onmouseover" to="alert(1)"/>'),
      '<set',
    ],
    [
      'a use of another document',
      wrap('<use href="https://evil.example/a.svg#x"/>'),
      'evil.example',
    ],
    [
      'a style attribute',
      wrap('<rect width="1" height="1" style="fill:url(https://evil.example)"/>'),
      'evil.example',
    ],
  ])('removes %s', (_name, input, forbidden) => {
    const out = sanitizeSvg(input);
    expect(out.toLowerCase()).not.toContain(forbidden.toLowerCase());
    expect(out).toMatch(/^<svg\b/);
  });

  it('drops the prolog, the doctype and its entities', () => {
    const out = sanitizeSvg(
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>',
    );
    expect(out).not.toContain('DOCTYPE');
    expect(out).not.toContain('passwd');
  });

  it.each([
    ['HTML', '<html><body><script>alert(1)</script></body></html>'],
    ['text', 'hello'],
    ['an SVG hidden behind HTML', '<div><svg onload="alert(1)"></svg></div>'],
    ['empty input', ''],
  ])('refuses %s', (_name, input) => {
    expect(() => sanitizeSvg(input)).toThrow(InvalidSvg);
  });
});
