// What the shell hands to every page and component through Svelte's context, so a module's page needs
// no import from the web app: the translator, the typed client, `href()` (the only way to build a link,
// ADR-0027), who is signed in, and the few things a page has to ask of the application around it.
import { getContext, setContext } from 'svelte';
import type { ApiClient, Branding, Navigation, Session } from '@scorpion/contracts/client';
import type { Translate } from './i18n.ts';
import type { Intent } from './reauth.ts';

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
  /** `candidate` when it is a path of this instance (an address under `BASE_PATH`), else `null`: the open-redirect check. */
  localPath: (candidate: unknown) => string | null;
  /** Asks the server again who is signed in, what they may see and in which language, and reloads the page's data. */
  refresh: () => Promise<void>;
  /** Goes to an address built with `href()`. */
  goto: (address: string, options?: { replace?: boolean }) => Promise<void>;
  /** Replaces the address in the address bar without leaving the page, which also drops a `#fragment`. */
  replaceUrl: (address: string) => void;
  /**
   * Runs an action that may need a recent authentication. On 401 `reauthentication-required` the
   * dialog asks for the password (or a provider) and the action runs again. `intent` lets the action
   * be repeated by the page after a return from a provider (`takeIntent`).
   */
  withReauth: <T>(action: () => Promise<T>, intent?: Intent) => Promise<T>;
  /** The action the person asked for before they left for a provider, once; `undefined` if there is none for `id`. */
  takeIntent: (id: string) => { payload: unknown } | undefined;
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
