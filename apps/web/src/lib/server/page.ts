// The decision behind the catch-all route (ADR-0027), apart from SvelteKit so that it can be tested with
// a table of pages of its own: find the page for the path, let the caller in or turn them away, run the
// page's `load`, and turn whatever it throws into an HTTP error. It never returns a `Response`.
import { error, redirect } from '@sveltejs/kit';
import { url as withBase, type UiRoute } from '@scorpion/contracts';
import type { ApiClient, Navigation, Session } from '@scorpion/contracts/client';
import { resolvePath } from '../match.ts';
import { toHttpError } from './errors.ts';

export interface PageTable {
  patterns: readonly string[];
  pages: ReadonlyMap<string, { package: string; route: UiRoute }>;
}

export interface PageRequest {
  /** The path of the request without `BASE_PATH` (the front took it off) and its query string. */
  url: URL;
  basePath: string;
  api: ApiClient;
  session: () => Promise<Session | null>;
  navigation: () => Promise<Navigation>;
  /** Whether the instance has no administrator yet. Without it (a test, a profile without sign-in) it is never so. */
  needsFirstAdmin?: () => Promise<boolean>;
  publicApi: Parameters<NonNullable<UiRoute['load']>>[0]['publicApi'];
}

export interface PageResult {
  pattern: string;
  params: Record<string, string>;
  data: unknown;
}

/**
 * The query string of the request for a `returnTo`. The URL parser leaves a raw backslash in a query,
 * which `url()` refuses; encoding it keeps the sign-in redirect from failing for an odd address.
 */
export function safeQuery(search: string): string {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is encoded here
  return search.replace(/[\u0000-\u001f\u007f\\]/g, (char) => encodeURIComponent(char));
}

/** The page of `core.identity` that creates the first administrator. */
export const SETUP_PAGE = '/setup';

export async function loadPage(table: PageTable, request: PageRequest): Promise<PageResult> {
  const { url, basePath } = request;

  // A fresh install has nobody who could sign in: the start page is the first-admin form and nothing
  // else is reachable until it has been used. Afterwards the form is a 404 (its own `load` says so).
  if (table.pages.has(SETUP_PAGE) && (await request.needsFirstAdmin?.())) {
    if (url.pathname !== '/') redirect(303, withBase(basePath, '/'));
    return runPage(table.pages.get(SETUP_PAGE)!, SETUP_PAGE, {}, request);
  }

  const match = resolvePath(table.patterns, url.pathname);
  if (!match) error(404, 'This page does not exist.');
  const page = table.pages.get(match.pattern)!;

  // The same list that builds the navigation decides who may open a page: a path the API did not list
  // for this caller is refused, whatever the browser asks for. An anonymous caller is sent to sign in
  // (and back), a signed-in one is told they may not.
  const [session, navigation] = await Promise.all([request.session(), request.navigation()]);
  if (!navigation.routes.includes(match.pattern)) {
    if (!session) {
      const here = withBase(basePath, `${url.pathname}${safeQuery(url.search)}`);
      redirect(303, withBase(basePath, `/login?returnTo=${encodeURIComponent(here)}`));
    }
    error(403, 'You are not allowed to open this page.');
  }

  return runPage(page, match.pattern, match.params, request);
}

async function runPage(
  page: { route: UiRoute },
  pattern: string,
  params: Record<string, string>,
  request: PageRequest,
): Promise<PageResult> {
  try {
    const data: unknown = await page.route.load?.({
      params,
      url: request.url,
      api: request.api,
      publicApi: request.publicApi,
    });
    return { pattern, params, data: data ?? null };
  } catch (failure) {
    toHttpError(failure);
  }
}
