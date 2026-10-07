// What the shell hands to every page and component through Svelte's context, so a module's page needs
// no import from the web app: the translator, the typed client, `href()` (the only way to build a link,
// ADR-0027) and who is signed in.
import { getContext, setContext } from 'svelte';
import type { ApiClient, Branding, Navigation, Session } from '@scorpion/contracts/client';
import type { Translate } from './i18n.ts';

export interface Shell {
  /** A path of this application under `BASE_PATH`. */
  href: (path: string) => string;
  t: Translate;
  /** The typed client of the browser (it sends the CSRF header of the session). */
  api: ApiClient;
  /** The caller, or `null`. Reads the current value each time. */
  session: () => Session | null;
  navigation: () => Navigation;
  /** How the instance presents itself (names, logos, legal pages). */
  branding: () => Branding;
  locale: () => string;
}

const KEY = Symbol('scorpion.shell');

export function setShell(shell: Shell): void {
  setContext(KEY, shell);
}

export function getShell(): Shell {
  const shell = getContext<Shell | undefined>(KEY);
  if (!shell) throw new Error('getShell() needs a component inside the shell layout');
  return shell;
}
