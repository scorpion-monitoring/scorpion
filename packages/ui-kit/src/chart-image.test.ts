import { describe, expect, it } from 'vitest';
import { legendLayout, standaloneSvg, withLegend } from './chart-image.ts';

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

describe('withLegend', () => {
  const entries = [
    { name: 'Visits <all>', color: '#2a78d6', marker: 'circle' as const, line: 'solid' as const },
    { name: 'Users', color: '#eb6834', marker: 'rect' as const, line: 'dashed' as const },
  ];

  it('puts the legend under the chart, escaped, and grows the picture by its height', () => {
    const out = withLegend('<svg viewBox="0 0 10 5"><g/></svg>', 300, 150, '#fff', '#111', entries);
    expect(out.height).toBeGreaterThan(150);
    expect(out.svg).toContain(`height="${out.height}"`);
    expect(out.svg).toContain('Visits &#60;all&#62;');
    expect(out.svg).not.toContain('<all>');
    expect(out.svg).toContain('stroke-dasharray="5 3"');
    expect(out.svg.match(/xmlns=/g)?.length).toBe(2);
  });

  it('draws no legend for one series', () => {
    const out = withLegend('<svg viewBox="0 0 10 5"><g/></svg>', 300, 150, '#fff', '#111', [
      entries[0]!,
    ]);
    expect(out).toEqual({
      svg: standaloneSvg('<svg viewBox="0 0 10 5"><g/></svg>', 300, 150, '#fff'),
      height: 150,
    });
  });
});

describe('legendLayout', () => {
  it('wraps entries that do not fit the width, and never starts a row with a gap', () => {
    const { positions, height } = legendLayout(
      ['A long series name', 'Another long name', 'C'],
      200,
    );
    expect(positions[0]).toEqual({ x: 8, y: 8 });
    expect(positions[1]!.x).toBe(8);
    expect(positions[1]!.y).toBe(28);
    expect(height).toBeGreaterThan(28);
  });

  it('is empty without entries', () => {
    expect(legendLayout([], 200)).toEqual({ positions: [], height: 0 });
  });
});
