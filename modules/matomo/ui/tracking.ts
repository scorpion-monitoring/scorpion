// What the tracker sends, as plain functions (ADR-0054). Matomo receives the registered pattern of a page, never its address:
// no ids, no query, no fragment (a reset or sign-in link carries its token in the fragment). Kept free of the DOM so the
// rules are tested in a table.
import type { ShownPage } from '@scorpion/ui-kit';

/** What a Matomo `_paq` queue entry is: a command name and its arguments. */
export type MatomoCommand = [string, ...(string | number | boolean)[]];

export interface EnabledTracker {
  enabled: true;
  url: string;
  siteId: number;
  cookieless: boolean;
  respectDoNotTrack: boolean;
  userId?: string;
}

/** The path Matomo is told about: the page's pattern, or a fixed name for a page that has none. */
export function trackedPath(page: ShownPage): string {
  if (page.status >= 400) return '/(error)';
  return page.pattern ?? '/(unknown)';
}

/**
 * The full address Matomo is told about: the origin and the base path (from `href`), then the pattern. Never the address bar.
 * `href` is the shell's, so a base path of several segments is kept as it is (defect 11).
 */
export function trackedUrl(
  origin: string,
  href: (path: string) => string,
  page: ShownPage,
): string {
  return `${origin}${href(trackedPath(page))}`;
}

/** Whether the browser asked not to be tracked: Do Not Track, or Global Privacy Control. */
export function asksNotToBeTracked(browser: {
  doNotTrack?: string | null;
  windowDoNotTrack?: string | null;
  globalPrivacyControl?: boolean;
}): boolean {
  return (
    browser.doNotTrack === '1' ||
    browser.doNotTrack === 'yes' ||
    browser.windowDoNotTrack === '1' ||
    browser.globalPrivacyControl === true
  );
}

/** The commands that set the tracker up, before the first page view. Link tracking stays off: it would send addresses. */
export function setupCommands(config: EnabledTracker): MatomoCommand[] {
  const commands: MatomoCommand[] = [];
  if (config.cookieless) commands.push(['disableCookies']);
  commands.push(['setTrackerUrl', `${config.url}matomo.php`]);
  commands.push(['setSiteId', String(config.siteId)]);
  return commands;
}

/**
 * The commands of one page view. `previousUrl` is the tracked address of the page before (the referrer of a navigation
 * inside the application); `userId` is the caller's pseudonymous id, or `undefined`, which resets one sent before
 * (somebody signed out).
 */
export function pageViewCommands(input: {
  url: string;
  title: string;
  previousUrl: string | undefined;
  userId: string | undefined;
  hadUserId: boolean;
}): MatomoCommand[] {
  const commands: MatomoCommand[] = [];
  if (input.previousUrl !== undefined) commands.push(['setReferrerUrl', input.previousUrl]);
  commands.push(['setCustomUrl', input.url]);
  commands.push(['setDocumentTitle', input.title]);
  if (input.userId !== undefined) commands.push(['setUserId', input.userId]);
  else if (input.hadUserId) commands.push(['resetUserId']);
  commands.push(['trackPageView']);
  return commands;
}

/**
 * Whether a navigation is a new page view: the path changed. A search or a filter on the same page changes only the
 * query, and the back button to the same page changes nothing; neither is counted again.
 */
export function isNewPageView(previousPathname: string | undefined, page: ShownPage): boolean {
  return previousPathname !== page.pathname;
}
