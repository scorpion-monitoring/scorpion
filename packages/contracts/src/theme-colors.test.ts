import { describe, expect, it } from 'vitest';
import {
  AA_NON_TEXT,
  AA_TEXT,
  BUILT_IN_THEME_COLORS,
  CONTRAST_PAIRS,
  COLOR_TOKENS,
  THEME_MODES,
  cleanThemeColors,
  contrastFailures,
  contrastRatio,
  deriveContent,
  describeFailure,
  formatRatio,
  isHexColor,
  relativeLuminance,
  resolveTheme,
  themeOverrides,
  themeStylesheet,
} from './theme-colors.ts';

/** What an attacker or a mistake could put where a colour belongs. None may reach the stylesheet. */
const HOSTILE = [
  'red;}body{display:none',
  '</style><script>alert(1)</script>',
  'url(https://evil.example/x.png)',
  '#fff',
  '#ffffff;',
  '#ffffff }',
  ' #ffffff',
  '#fffffff',
  '#gggggg',
  'rgb(0,0,0)',
  'var(--color-primary)',
  'expression(alert(1))',
  '',
  12345678,
  null,
  ['#ffffff'],
  { toString: () => '#ffffff' },
];

describe('isHexColor', () => {
  it.each(['#000000', '#ffffff', '#FFFFFF', '#00e5Ff'])('accepts %s', (value) => {
    expect(isHexColor(value)).toBe(true);
  });
  it.each(HOSTILE)('refuses %j', (value) => {
    expect(isHexColor(value)).toBe(false);
  });
});

describe('relativeLuminance', () => {
  it.each([
    ['#000000', 0],
    ['#ffffff', 1],
    ['#ff0000', 0.2126],
    ['#00ff00', 0.7152],
    ['#0000ff', 0.0722],
    ['#808080', 0.2158605],
    // Below the 0.04045 knee the channel is linear (value / 12.92).
    ['#0a0a0a', 0.0030353],
  ])('%s → %f', (hex, expected) => {
    expect(relativeLuminance(hex)).toBeCloseTo(expected, 6);
  });

  it('refuses what is not #rrggbb', () => {
    expect(() => relativeLuminance('red')).toThrow(TypeError);
  });
});

describe('contrastRatio', () => {
  it.each([
    ['#000000', '#ffffff', 21],
    ['#ffffff', '#000000', 21],
    ['#ffffff', '#ffffff', 1],
    // The classic AA boundary on white: #767676 passes 4.5, #777777 does not.
    ['#767676', '#ffffff', 4.54],
    ['#777777', '#ffffff', 4.48],
    // 3:1 boundary on white.
    ['#949494', '#ffffff', 3.033],
    ['#959595', '#ffffff', 2.995],
    // The built-in light primary (docs/ui-style-guide.md: 5.6 under white, 5.2 on the page).
    ['#006da8', '#ffffff', 5.6],
    ['#006da8', '#f4f8fc', 5.24],
  ])('%s on %s is %f:1', (a, b, expected) => {
    expect(contrastRatio(a, b)).toBeCloseTo(expected, 2);
  });

  it.each([
    ['#767676', '#ffffff', true, true],
    ['#777777', '#ffffff', false, true],
    ['#949494', '#ffffff', false, true],
    ['#959595', '#ffffff', false, false],
  ])('%s on %s: text AA %s, non-text AA %s', (a, b, text, nonText) => {
    expect(contrastRatio(a, b) >= AA_TEXT).toBe(text);
    expect(contrastRatio(a, b) >= AA_NON_TEXT).toBe(nonText);
  });

  it('formats a ratio rounded down, so a failing 4.499 never reads 4.50', () => {
    expect(formatRatio(4.499)).toBe('4.49:1');
    expect(formatRatio(21)).toBe('21.00:1');
  });
});

describe('deriveContent', () => {
  it.each([
    [['#ffffff'], '#000000'],
    [['#000000'], '#ffffff'],
    [['#006da8'], '#ffffff'],
    [['#00e5ff'], '#000000'],
    [['#f59e0b'], '#000000'],
    [['#1a237e'], '#ffffff'],
    // Several surfaces: the colour whose worst ratio is best.
    [['#ffffff', '#202020'], '#000000'],
    [['#101010', '#e0e0e0', '#303030'], '#ffffff'],
  ])('on %j → %s', (backgrounds, expected) => {
    expect(deriveContent(backgrounds)).toBe(expected);
  });
});

describe('cleanThemeColors', () => {
  it('keeps known tokens with valid values, lower-cased', () => {
    expect(cleanThemeColors({ primary: '#AABBCC', 'base-100': '#ffffff' })).toEqual({
      primary: '#aabbcc',
      'base-100': '#ffffff',
    });
  });
  it.each(HOSTILE)('drops the value %j', (value) => {
    expect(cleanThemeColors({ primary: value })).toEqual({});
  });
  it.each(['color-primary', 'primary;}body{', '__proto__', 'constructor', 'radius-box', 'muted'])(
    'drops the unknown name %j',
    (name) => {
      expect(cleanThemeColors({ [name]: '#ffffff' })).toEqual({});
    },
  );
  it.each([undefined, null, 'x', ['#ffffff'], 3])('treats %j as nothing set', (input) => {
    expect(cleanThemeColors(input)).toEqual({});
  });
});

describe('resolveTheme', () => {
  it('with nothing set is the built-in theme and writes nothing', () => {
    for (const mode of THEME_MODES) {
      expect(resolveTheme(mode, {})).toEqual({
        colors: BUILT_IN_THEME_COLORS[mode],
        derived: [],
        overrides: {},
      });
    }
  });

  it.each([
    // [what is set, the content tokens that are derived, with their values]
    [{ primary: '#ffd400' }, { 'primary-content': '#000000' }],
    [{ primary: '#123456' }, { 'primary-content': '#ffffff' }],
    [{ primary: '#123456', 'primary-content': '#eeeeee' }, {}],
    [
      { error: '#7f1d1d', warning: '#fde047' },
      { 'error-content': '#ffffff', 'warning-content': '#000000' },
    ],
    // A surface: base-content is derived against all three surfaces (one dark surface among light ones keeps black if it is the best worst case).
    [{ 'base-100': '#111111' }, { 'base-content': '#ffffff' }],
    [{ 'base-300': '#cccccc' }, { 'base-content': '#000000' }],
    // A content colour set on its own is not derived and derives nothing.
    [{ 'primary-content': '#000000' }, {}],
  ])('%j derives %j', (set, derived) => {
    const resolved = resolveTheme('light', set);
    expect(resolved.derived.sort()).toEqual(Object.keys(derived).sort());
    for (const [token, value] of Object.entries(derived)) {
      expect(resolved.colors[token as keyof typeof resolved.colors]).toBe(value);
    }
    expect(resolved.overrides).toEqual({ ...cleanThemeColors(set), ...derived });
  });
});

describe('the pairs', () => {
  it('cover every content colour on its colour and the text on the three surfaces', () => {
    const names = CONTRAST_PAIRS.map((pair) => `${pair.foreground}/${pair.background}`);
    for (const color of [
      'primary',
      'secondary',
      'accent',
      'neutral',
      'info',
      'success',
      'warning',
      'error',
    ]) {
      expect(names).toContain(`${color}-content/${color}`);
    }
    for (const surface of ['base-100', 'base-200', 'base-300'])
      expect(names).toContain(`base-content/${surface}`);
    expect(new Set(names).size).toBe(names.length);
    for (const pair of CONTRAST_PAIRS) {
      expect(COLOR_TOKENS).toContain(pair.foreground);
      expect(COLOR_TOKENS).toContain(pair.background);
      expect([AA_TEXT, AA_NON_TEXT]).toContain(pair.minimum);
    }
  });

  it.each(THEME_MODES)('all pass in the built-in %s theme', (mode) => {
    expect(contrastFailures(mode, {})).toEqual([]);
  });
});

describe('contrastFailures', () => {
  it.each([
    // [mode, set, the failing pairs]
    [
      'light',
      { primary: '#29b6f6', 'primary-content': '#ffffff' },
      ['primary-content/primary', 'primary/base-100', 'primary/base-200', 'primary/base-300'],
    ],
    ['light', { 'error-content': '#ff0000' }, ['error-content/error']],
    // A derived content colour never fails on its own colour.
    ['light', { primary: '#808080' }, ['primary/base-100', 'primary/base-300']],
    // A white page in the dark theme: black text is derived for the three surfaces and fails on the two dark ones.
    [
      'dark',
      { 'base-100': '#ffffff' },
      [
        'base-content/base-200',
        'base-content/base-300',
        'primary/base-100',
        'error/base-100',
        'warning/base-100',
      ],
    ],
    [
      'dark',
      { 'base-content': '#475569' },
      ['base-content/base-100', 'base-content/base-200', 'base-content/base-300'],
    ],
    // 3:1 is enough for the ring: primary at about 4.0 on base-200 passes there and fails as text on base-100.
    ['light', { primary: '#4f7fa0' }, ['primary/base-100']],
    ['light', { primary: '#123456', 'base-100': '#ffffff', 'base-content': '#000000' }, []],
  ] as const)('%s %j fails %j', (mode, set, failing) => {
    expect(
      contrastFailures(mode, set).map((failure) => `${failure.foreground}/${failure.background}`),
    ).toEqual(failing);
  });

  it('names the pair, its ratio and the threshold', () => {
    const [failure] = contrastFailures('light', { 'primary-content': '#29b6f6' });
    expect(describeFailure(failure!)).toBe('primary-content on primary is 2.42:1, needs 4.5:1');
    expect(failure).toMatchObject({ mode: 'light', minimum: 4.5 });
  });
});

describe('themeStylesheet', () => {
  const declarations = (css: string) =>
    [...css.matchAll(/--color-([a-z0-9-]+): ([^;]*);/g)].map((m) => [m[1], m[2]]);

  it('with nothing set is a comment and no rule', () => {
    for (const input of [undefined, null, {}, { light: {}, dark: {} }, 'x']) {
      const css = themeStylesheet(input);
      expect(css).toMatch(/^\/\*[^*]*\*\/\n$/);
      expect(css).not.toContain('{');
    }
  });

  it('writes a light set only for light pages and a dark set only for dark pages', () => {
    const css = themeStylesheet({ light: { primary: '#123456' }, dark: { primary: '#abcdef' } });
    expect(css).toBe(
      '/* Theme colours of this instance (branding settings, core.settings). Empty when none is set. */\n' +
        '@media not all and (prefers-color-scheme: dark) { :root:not([data-theme]) { --color-primary: #123456; --color-primary-content: #ffffff; } }\n' +
        "[data-theme='scorpionlight'] { --color-primary: #123456; --color-primary-content: #ffffff; }\n" +
        '@media (prefers-color-scheme: dark) { :root:not([data-theme]) { --color-primary: #abcdef; --color-primary-content: #000000; } }\n' +
        "[data-theme='scorpiondark'] { --color-primary: #abcdef; --color-primary-content: #000000; }\n",
    );
  });

  it('leaves out a theme with nothing set', () => {
    const css = themeStylesheet({ dark: { accent: '#ffffff' } });
    expect(css).not.toContain('scorpionlight');
    expect(css).toContain('scorpiondark');
  });

  it('writes the tokens in a fixed order, lower-cased', () => {
    const css = themeStylesheet({
      light: { 'error-content': '#FFFFFF', 'base-100': '#FAFAFA', primary: '#0000AA' },
    });
    expect(declarations(css).slice(0, 4)).toEqual([
      ['primary', '#0000aa'],
      ['primary-content', '#ffffff'],
      ['base-100', '#fafafa'],
      ['base-content', '#000000'],
    ]);
  });

  it.each(HOSTILE)('never writes the value %j (dropped, not escaped)', (value) => {
    const css = themeStylesheet({
      light: { primary: value, accent: '#00ff00' },
      dark: { primary: value },
    });
    expect(declarations(css).map(([name]) => name)).toEqual([
      'accent',
      'accent-content',
      'accent',
      'accent-content',
    ]);
    if (typeof value === 'string' && value !== '') expect(css).not.toContain(value);
    expect(css).not.toMatch(/url\(|<\/?style|<script|display:\s*none|expression/i);
  });

  it.each(['primary;}body{display:none', 'radius-box', '__proto__', 'x: red; --color-primary'])(
    'never writes the unknown name %j',
    (name) => {
      const css = themeStylesheet({ light: { [name]: '#ffffff' } });
      expect(css).not.toContain('{ --');
      expect(css).not.toContain(name);
    },
  );

  it('every value it writes is a #rrggbb under a known token', () => {
    const set = Object.fromEntries(
      COLOR_TOKENS.map((token, index) => [
        token,
        `#${(index * 0x0c0c0c).toString(16).padStart(6, '0').slice(-6)}`,
      ]),
    );
    const css = themeStylesheet({ light: set, dark: set });
    const written = declarations(css);
    expect(written).toHaveLength(COLOR_TOKENS.length * 4);
    for (const [name, value] of written) {
      expect(COLOR_TOKENS).toContain(name);
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('themeOverrides', () => {
  it('is what the stylesheet writes, per theme', () => {
    expect(themeOverrides({ light: { primary: '#123456' }, dark: { nope: '#ffffff' } })).toEqual({
      light: { primary: '#123456', 'primary-content': '#ffffff' },
      dark: {},
    });
  });
});
