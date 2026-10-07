// The manual colour theme: light, dark, or "system" (nothing stored, the CSS follows
// prefers-color-scheme). The choice lives in localStorage, which can be missing or throw (a private
// window, blocked site data): every access is wrapped and the page works without it.
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_KEY = 'scorpion.theme';

export function readTheme(storage: Pick<Storage, 'getItem'> | undefined): ThemeChoice {
  try {
    const value = storage?.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Stores the choice (or forgets it for "system"). Returns whether it could be stored. */
export function storeTheme(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined,
  choice: ThemeChoice,
): boolean {
  try {
    if (!storage) return false;
    if (choice === 'system') storage.removeItem(THEME_KEY);
    else storage.setItem(THEME_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

/** Puts the choice on <html>: `data-theme` for light and dark, nothing for system. */
export function applyTheme(root: HTMLElement, choice: ThemeChoice): void {
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = `scorpion${choice}`;
}
