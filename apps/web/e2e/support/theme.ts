import { expect } from '@playwright/test';
import type { AdminApi } from './admin.ts';

// The theme colours of the e2e stack (M12a sprint 4). A spec that applies a custom set puts the stored colours back at the end:
// the specs of a stack run one after the other and share its settings, and the doc screenshots keep the built-in colours.

/** A readable custom set (it passes the check in both themes), visibly unlike the built-in colours. */
export const CUSTOM_COLOURS = {
  light: {
    primary: '#0f5c5c',
    secondary: '#4a1d6e',
    accent: '#f2b84b',
    'base-100': '#fffdf8',
    'base-200': '#f6efe1',
    'base-300': '#eadfc8',
    error: '#a3123a',
  },
  dark: {
    primary: '#fbbf24',
    secondary: '#7c3aed',
    accent: '#5eead4',
    'base-100': '#16130f',
    'base-200': '#221d17',
    'base-300': '#352d24',
    error: '#fb7185',
  },
} as const;

interface SettingsDocument {
  version: number;
  values: { branding?: Record<string, unknown> } & Record<string, unknown>;
}

interface BrandingRead {
  themeVersion: string | null;
}

/** Saves `colors` as the theme colours and waits until the branding read carries the new version (`null` for none). */
async function save(api: AdminApi, colors: unknown): Promise<string | null> {
  const current = await api.get<SettingsDocument>('/settings/core.settings');
  const versionBefore = (await api.get<BrandingRead>('/branding')).themeVersion;
  const unchanged = JSON.stringify(current.values.branding?.colors) === JSON.stringify(colors);
  const saved = await api.send('PUT', '/settings/core.settings', {
    version: current.version,
    values: { ...current.values, branding: { ...current.values.branding, colors } },
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  if (unchanged) return versionBefore;
  const empty = !Object.values(colors as Record<string, object>).some(
    (theme) => Object.keys(theme ?? {}).length > 0,
  );
  // Another process's settings cache sees a save within five seconds: wait on the answer, never on time.
  let version: string | null = versionBefore;
  await expect
    .poll(
      async () => {
        version = (await api.get<BrandingRead>('/branding')).themeVersion;
        return empty ? version === null : version !== null && version !== versionBefore;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return version;
}

/**
 * Applies `colors` (none clears them) and returns the version (`null` for none) and a function that puts back the colours stored before (call it in `finally`).
 */
export async function applyThemeColours(
  api: AdminApi,
  colors: unknown = CUSTOM_COLOURS,
): Promise<{ version: string | null; restore: () => Promise<void> }> {
  const before = await api.get<SettingsDocument>('/settings/core.settings');
  const previous = before.values.branding?.colors ?? { light: {}, dark: {} };
  const version = await save(api, colors);
  return { version, restore: async () => void (await save(api, previous)) };
}
