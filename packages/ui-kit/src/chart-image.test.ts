import { describe, expect, it } from 'vitest';
import { standaloneSvg } from './chart-image.ts';

describe('standaloneSvg', () => {
  const cases: [string, string, string[]][] = [
    [
      'a viewBox only: size and namespace are added',
      '<svg viewBox="0 0 10 5"><g/></svg>',
      [
        'width="300"',
        'height="150"',
        'xmlns="http://www.w3.org/2000/svg"',
        '<rect width="100%" height="100%" fill="#fff"/><g/>',
      ],
    ],
    [
      'a size and a namespace already there are kept once',
      '<svg width="10" height="5" xmlns="http://www.w3.org/2000/svg"><g/></svg>',
      ['<rect width="100%" height="100%" fill="#fff"/><g/>'],
    ],
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    const out = standaloneSvg(input, 300, 150, '#fff');
    for (const part of expected) expect(out).toContain(part);
    expect(out.match(/xmlns=/g)?.length).toBe(1);
    expect(out.match(/\swidth=/g)?.length).toBe(
      expected.some((e) => e.startsWith('width')) ? 2 : 2,
    );
  });

  it('leaves a text that is no svg alone', () => {
    expect(standaloneSvg('nope', 1, 1, '#000')).toBe('nope');
  });
});
