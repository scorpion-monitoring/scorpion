// The one route of the shell (ADR-0027): finds the page for the path in the table the modules
// contributed, checks the caller may open it, and runs its `load`. Modules add no filesystem route.
import { redirect, error } from '@sveltejs/kit';
import { url as withBase } from '@scorpion/contracts';
import publicApi from '../../generated/openapi-v1.json';
import type { PageServerLoad } from './$types';
import { resolvePath } from '#lib/match.ts';
import { pages, patterns } from '#lib/pages.ts';
import { basePath } from '#lib/server/env.ts';
import { toHttpError } from '#lib/server/errors.ts';

export const load: PageServerLoad = async ({ locals, url }) => {
  const match = resolvePath(patterns, url.pathname);
  if (!match) error(404, 'This page does not exist.');
  const page = pages.get(match.pattern)!;

  // The same list that builds the navigation decides who may open a page: a path the API did not
  // list for this caller is refused, whatever the browser asks for.
  const [session, navigation] = await Promise.all([locals.session(), locals.navigation()]);
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
      api: locals.api,
      publicApi,
    });
    return { pattern: match.pattern, params: match.params, data: data ?? null };
  } catch (failure) {
    toHttpError(failure);
  }
};
