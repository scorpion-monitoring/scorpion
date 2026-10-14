// The colours of the API reference (ADR-0038), taken from the shell's two DaisyUI themes (`scorpionlight`
// and `scorpiondark` in src/app.css) and handed to Scalar as `--scalar-*` variables. The values are
// written here once; `reference-theme.test.ts` fails when one drifts from app.css.

export type ReferenceMode = 'light' | 'dark';

/** The palette of a theme, by the names app.css gives it (`--color-<name>`; `muted` is `--scorpion-muted`). */
export interface ReferencePalette {
  'base-100': string;
  'base-200': string;
  'base-300': string;
  'base-content': string;
  muted: string;
  primary: string;
  'primary-content': string;
  secondary: string;
  accent: string;
  info: string;
  success: string;
  warning: string;
  error: string;
}

export const REFERENCE_PALETTES: Readonly<Record<ReferenceMode, ReferencePalette>> = {
  light: {
    'base-100': '#f4f8fc',
    'base-200': '#e3edf7',
    'base-300': '#d0e1f2',
    'base-content': '#0f172a',
    muted: '#475569',
    primary: '#006da8',
    'primary-content': '#ffffff',
    secondary: '#0a2540',
    accent: '#29b6f6',
    info: '#006da8',
    success: '#047857',
    warning: '#92400e',
    error: '#b91c1c',
  },
  dark: {
    'base-100': '#070c1e',
    'base-200': '#0e1738',
    'base-300': '#192653',
    'base-content': '#e2e8f0',
    muted: '#94a3b8',
    primary: '#00e5ff',
    'primary-content': '#070c1e',
    secondary: '#1a237e',
    accent: '#80d8ff',
    info: '#00e5ff',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#f87171',
  },
};

/** The `--scalar-*` variables of one palette. */
export function scalarVariables(mode: ReferenceMode): Record<string, string> {
  const p = REFERENCE_PALETTES[mode];
  return {
    '--scalar-background-1': p['base-100'],
    '--scalar-background-2': p['base-200'],
    '--scalar-background-3': p['base-300'],
    '--scalar-background-accent': p['base-200'],
    '--scalar-color-1': p['base-content'],
    '--scalar-color-2': p.muted,
    '--scalar-color-3': p.muted,
    '--scalar-color-accent': p.primary,
    '--scalar-border-color': p['base-300'],
    '--scalar-button-1': p.primary,
    '--scalar-button-1-hover': p.primary,
    '--scalar-button-1-color': p['primary-content'],
    '--scalar-color-green': p.success,
    '--scalar-color-red': p.error,
    '--scalar-color-yellow': p.warning,
    '--scalar-color-blue': p.info,
    '--scalar-color-orange': p.warning,
    // Code keywords: the deep blue of the light theme is unreadable on the dark one, which takes its accent.
    '--scalar-color-purple': mode === 'dark' ? p.accent : p.secondary,
    '--scalar-link-color': p.primary,
    '--scalar-link-color-hover': p.primary,
  };
}

function block(selector: string, variables: Record<string, string>): string {
  const lines = Object.entries(variables).map(([name, value]) => `  ${name}: ${value};`);
  return `${selector} {\n${lines.join('\n')}\n}`;
}

/**
 * The custom CSS of the reference: the two palettes under the classes Scalar puts on `<body>`, and the
 * slim bar above it. Specificity is raised (`html body`) so that Scalar's own theme does not win.
 */
export function referenceCss(): string {
  return [
    block('html body.light-mode', scalarVariables('light')),
    block('html body.dark-mode', scalarVariables('dark')),
    `html { --scalar-custom-header-height: 2.75rem; }`,
    `.scorpion-bar { position: sticky; top: 0; z-index: 100; display: flex; align-items: center; gap: 1rem; height: 2.75rem; padding: 0 1rem; background: var(--scalar-background-2); color: var(--scalar-color-1); border-bottom: 1px solid var(--scalar-border-color); font-family: system-ui, sans-serif; font-size: 0.875rem; }`,
    `.scorpion-bar a { color: var(--scalar-color-accent); font-weight: 600; text-decoration: underline; }`,
    `.scorpion-bar a:focus-visible { outline: 2px solid var(--scalar-color-accent); outline-offset: 2px; }`,
  ].join('\n');
}
