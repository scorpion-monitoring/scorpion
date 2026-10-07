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
  publicApi: Parameters<NonNullable<UiRoute['load']>>[0]['publicApi'];
}

export interface PageResult {
  pattern: string;
  params: Record<string, string>;
  data: unknown;
}

export async function loadPage(table: PageTable, request: PageRequest): Promise<PageResult> {
  const { url, basePath } = request;
  const match = resolvePath(table.patterns, url.pathname);
  if (!match) error(404, 'This page does not exist.');
  const page = table.pages.get(match.pattern)!;

  // The same list that builds the navigation decides who may open a page: a path the API did not list
  // for this caller is refused, whatever the browser asks for. An anonymous caller is sent to sign in
  // (and back), a signed-in one is told they may not.
  const [session, navigation] = await Promise.all([request.session(), request.navigation()]);
  if (!navigation.routes.includes(match.pattern)) {
    if (!session) {
      const here = withBase(basePath, `${url.pathname}${url.search}`);
      redirect(303, withBase(basePath, `/login?returnTo=${encodeURIComponent(here)}`));
    }
    error(403, 'You are not allowed to open this page.');
  }

  try {
    const data: unknown = await page.route.load?.({
      params: match.params,
      url,
      api: request.api,
      publicApi: request.publicApi,
    });
    return { pattern: match.pattern, params: match.params, data: data ?? null };
  } catch (failure) {
    toHttpError(failure);
  }
}
