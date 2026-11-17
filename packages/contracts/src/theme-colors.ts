// The colours of the two themes as data (M12a sprint 4, ADR-0051): the daisyUI tokens an administrator may set, the WCAG contrast
// maths that decides whether a set may be saved, the content colours derived when none is given, and the stylesheet that carries a set
// to the browser. One implementation for the server (the check on save, the branding read), the web app (`GET /theme.css`) and the
// admin screen (its preview), so what the screen warns about is what the server refuses. No Svelte, no I/O.
//
// A value is `#rrggbb` and nothing else: it is checked by `HEX_COLOR` before it is stored and again before it is written, and the
// stylesheet names only the tokens of `COLOR_TOKENS`. A stored value can therefore never be CSS.

export const THEME_MODES = ['light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** The daisyUI colour tokens (`--color-<token>`), in the order the admin screen lists them. */
export const COLOR_TOKENS = [
  'primary',
  'primary-content',
  'secondary',
  'secondary-content',
  'accent',
  'accent-content',
  'neutral',
  'neutral-content',
  'base-100',
  'base-200',
  'base-300',
  'base-content',
  'info',
  'info-content',
  'success',
  'success-content',
  'warning',
  'warning-content',
  'error',
  'error-content',
] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

/** What an administrator set for one theme: any of the tokens, each `#rrggbb`. An unset token keeps the built-in value. */
export type ThemeColors = Partial<Record<ColorToken, string>>;
export type ThemeColorSet = Partial<Record<ThemeMode, ThemeColors>>;

/** The one form a stored colour may have. */
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && HEX_COLOR.test(value);

const isToken = (name: string): name is ColorToken =>
  (COLOR_TOKENS as readonly string[]).includes(name);

/**
 * The built-in themes `scorpionlight` and `scorpiondark` of `apps/web/src/app.css`, which stay the source of what the page shows;
 * these copies are what the contrast check measures an unset token by. `apps/web/src/theme-colors-drift.test.ts` fails when one drifts.
 */
export const BUILT_IN_THEME_COLORS: Readonly<
  Record<ThemeMode, Readonly<Record<ColorToken, string>>>
> = {
  light: {
    primary: '#006da8',
    'primary-content': '#ffffff',
    secondary: '#0a2540',
    'secondary-content': '#f4f8fc',
    accent: '#29b6f6',
    'accent-content': '#0a2540',
    neutral: '#0f172a',
    'neutral-content': '#f4f8fc',
    'base-100': '#f4f8fc',
    'base-200': '#e3edf7',
    'base-300': '#d0e1f2',
    'base-content': '#0f172a',
    info: '#006da8',
    'info-content': '#ffffff',
    success: '#047857',
    'success-content': '#ffffff',
    warning: '#92400e',
    'warning-content': '#ffffff',
    error: '#b91c1c',
    'error-content': '#ffffff',
  },
  dark: {
    primary: '#00e5ff',
    'primary-content': '#070c1e',
    secondary: '#1a237e',
    'secondary-content': '#e2e8f0',
    accent: '#80d8ff',
    'accent-content': '#070c1e',
    neutral: '#192653',
    'neutral-content': '#e2e8f0',
    'base-100': '#070c1e',
    'base-200': '#0e1738',
    'base-300': '#192653',
    'base-content': '#e2e8f0',
    info: '#00e5ff',
    'info-content': '#070c1e',
    success: '#10b981',
    'success-content': '#070c1e',
    warning: '#f59e0b',
    'warning-content': '#070c1e',
    error: '#f87171',
    'error-content': '#070c1e',
  },
};

// --- WCAG 2.x contrast ------------------------------------------------------------------------------

/** WCAG AA for text (1.4.3). */
export const AA_TEXT = 4.5;
/** WCAG AA for large text (1.4.3) and for the edges of controls and focus rings (1.4.11). */
export const AA_NON_TEXT = 3;

/** The relative luminance of a `#rrggbb` colour (WCAG 2.x, sRGB). */
export function relativeLuminance(hex: string): number {
  if (!isHexColor(hex)) throw new TypeError(`not a #rrggbb colour: ${String(hex).slice(0, 20)}`);
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The contrast ratio of two colours, from 1 to 21, whichever is lighter. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** A ratio as people read it: rounded down to two places, so 4.499 is never shown as the 4.5 it fails. */
export const formatRatio = (ratio: number): string =>
  `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;

export interface ContrastPair {
  foreground: ColorToken;
  background: ColorToken;
  /** `AA_TEXT` for text, `AA_NON_TEXT` for an edge or a focus ring. */
  minimum: number;
  /** Where the page draws the pair (for the docs and the admin screen). */
  use: string;
}

const onItsColour = (color: ColorToken, use: string): ContrastPair => ({
  foreground: `${color}-content` as ColorToken,
  background: color,
  minimum: AA_TEXT,
  use,
});

/**
 * Every text and background pair the page draws from the tokens, checked in each theme. The first eleven are a content colour on
 * its colour and the text on the three surfaces; the rest are the colours the components use as text or as a ring on a surface
 * (`text-primary`, `text-error` under a field, `text-warning`, the primary focus ring and the active option's outline).
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  onItsColour('primary', 'buttons, chosen chips'),
  onItsColour('secondary', 'secondary buttons'),
  onItsColour('accent', 'accent fills'),
  onItsColour('neutral', 'neutral buttons, tooltips'),
  onItsColour('info', 'info alerts and badges'),
  onItsColour('success', 'success alerts and badges'),
  onItsColour('warning', 'warning alerts and badges'),
  onItsColour('error', 'error alerts and badges'),
  { foreground: 'base-content', background: 'base-100', minimum: AA_TEXT, use: 'text on the page' },
  { foreground: 'base-content', background: 'base-200', minimum: AA_TEXT, use: 'text on cards' },
  {
    foreground: 'base-content',
    background: 'base-300',
    minimum: AA_TEXT,
    use: 'text on raised parts',
  },
  {
    foreground: 'primary',
    background: 'base-100',
    minimum: AA_TEXT,
    use: 'primary text and links',
  },
  { foreground: 'error', background: 'base-100', minimum: AA_TEXT, use: 'messages under a field' },
  { foreground: 'error', background: 'base-200', minimum: AA_TEXT, use: 'messages on a card' },
  { foreground: 'warning', background: 'base-100', minimum: AA_TEXT, use: 'warnings as text' },
  {
    foreground: 'primary',
    background: 'base-200',
    minimum: AA_NON_TEXT,
    use: 'focus ring on a card',
  },
  {
    foreground: 'primary',
    background: 'base-300',
    minimum: AA_NON_TEXT,
    use: 'focus ring on a raised part',
  },
];

// --- derived content colours ------------------------------------------------------------------------

/** The content tokens and the colours they are drawn on. `base-content` is drawn on all three surfaces. */
export const CONTENT_OF: Readonly<Partial<Record<ColorToken, readonly ColorToken[]>>> = {
  'primary-content': ['primary'],
  'secondary-content': ['secondary'],
  'accent-content': ['accent'],
  'neutral-content': ['neutral'],
  'base-content': ['base-100', 'base-200', 'base-300'],
  'info-content': ['info'],
  'success-content': ['success'],
  'warning-content': ['warning'],
  'error-content': ['error'],
};

const BLACK = '#000000';
const WHITE = '#ffffff';

/** Black or white, whichever has the higher contrast on the worst of `backgrounds` (black on a tie). */
export function deriveContent(backgrounds: readonly string[]): string {
  const worst = (text: string) => Math.min(...backgrounds.map((bg) => contrastRatio(text, bg)));
  return worst(WHITE) > worst(BLACK) ? WHITE : BLACK;
}

/** Only the known tokens with a valid value, lower-cased: whatever else an object holds is ignored. */
export function cleanThemeColors(input: unknown): ThemeColors {
  const clean: ThemeColors = {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return clean;
  for (const [name, value] of Object.entries(input)) {
    if (isToken(name) && isHexColor(value)) clean[name] = value.toLowerCase();
  }
  return clean;
}

export interface ResolvedTheme {
  /** Every token's colour as the page draws it: the built-in value, the administrator's, or a derived one. */
  colors: Record<ColorToken, string>;
  /** The content tokens that were left unset and are derived (their colour was set). */
  derived: ColorToken[];
  /** What the stylesheet writes: the set tokens and the derived ones. Empty when nothing is set. */
  overrides: ThemeColors;
}

/**
 * One theme as the page will draw it. A content token left unset is **derived** (black or white, `deriveContent`) when the colour
 * it is drawn on was set; when that colour was not set either, the built-in pair stays as it is.
 */
export function resolveTheme(mode: ThemeMode, input: unknown): ResolvedTheme {
  const set = cleanThemeColors(input);
  const colors = { ...BUILT_IN_THEME_COLORS[mode], ...set };
  const derived: ColorToken[] = [];
  for (const token of COLOR_TOKENS) {
    const on = CONTENT_OF[token];
    if (!on || set[token] !== undefined || !on.some((background) => set[background] !== undefined))
      continue;
    colors[token] = deriveContent(on.map((background) => colors[background]));
    derived.push(token);
  }
  const overrides: ThemeColors = { ...set };
  for (const token of derived) overrides[token] = colors[token];
  return { colors, derived, overrides };
}

export interface ContrastFailure {
  mode: ThemeMode;
  foreground: ColorToken;
  background: ColorToken;
  ratio: number;
  minimum: number;
}

/** The pairs of one theme that fail AA, in the order of `CONTRAST_PAIRS`. Empty when the set may be saved. */
export function contrastFailures(mode: ThemeMode, input: unknown): ContrastFailure[] {
  const { colors } = resolveTheme(mode, input);
  return CONTRAST_PAIRS.flatMap(({ foreground, background, minimum }) => {
    const ratio = contrastRatio(colors[foreground], colors[background]);
    return ratio < minimum ? [{ mode, foreground, background, ratio, minimum }] : [];
  });
}

/** A failure in words, naming the pair: `primary-content on primary is 2.10:1, needs 4.5:1`. */
export const describeFailure = (failure: ContrastFailure): string =>
  `${failure.foreground} on ${failure.background} is ${formatRatio(failure.ratio)}, needs ${failure.minimum}:1`;

// --- the stylesheet ---------------------------------------------------------------------------------

/**
 * The rules that select each theme, as daisyUI selects its own (`app.css`, `@layer base`). This sheet is not in a layer, so it wins
 * over the built-in themes by the cascade, whatever their specificity. The light rules must not match a dark page: an unset dark
 * token then keeps its built-in value instead of taking the light one.
 */
const SELECTORS: Readonly<Record<ThemeMode, readonly string[]>> = {
  light: [
    '@media not all and (prefers-color-scheme: dark) { :root:not([data-theme]) { $ } }',
    "[data-theme='scorpionlight'] { $ }",
  ],
  dark: [
    '@media (prefers-color-scheme: dark) { :root:not([data-theme]) { $ } }',
    "[data-theme='scorpiondark'] { $ }",
  ],
};

const HEADER =
  '/* Theme colours of this instance (branding settings, core.settings). Empty when none is set. */\n';

/**
 * The stylesheet of `GET /theme.css`. It is built from `resolveTheme`, so a value reaches it only as a lower-case `#rrggbb` under a
 * name of `COLOR_TOKENS`; anything else in the input is dropped, never escaped. A set with no colours is the comment alone.
 */
export function themeStylesheet(set: unknown): string {
  const input = (typeof set === 'object' && set !== null ? set : {}) as Record<string, unknown>;
  const blocks: string[] = [];
  for (const mode of THEME_MODES) {
    const { overrides } = resolveTheme(mode, input[mode]);
    const declarations = COLOR_TOKENS.filter((token) => overrides[token] !== undefined)
      .map((token) => `--color-${token}: ${overrides[token]};`)
      .join(' ');
    if (declarations === '') continue;
    for (const rule of SELECTORS[mode]) blocks.push(rule.replace('$', () => declarations));
  }
  return HEADER + blocks.map((block) => `${block}\n`).join('');
}

/** The written overrides of both themes, the shape the branding read returns. */
export function themeOverrides(set: unknown): Record<ThemeMode, ThemeColors> {
  const input = (typeof set === 'object' && set !== null ? set : {}) as Record<string, unknown>;
  return {
    light: resolveTheme('light', input.light).overrides,
    dark: resolveTheme('dark', input.dark).overrides,
  };
}
