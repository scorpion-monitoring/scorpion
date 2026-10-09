// The one route of the shell (ADR-0027): the decision is `loadPage`; this file gives it the table of
// pages of this build and the request. Modules add no filesystem route.
import publicApi from '../../generated/openapi-v1.json';
import type { PageServerLoad } from './$types';
import { pages, patterns } from '#lib/pages.ts';
import { basePath } from '#lib/server/env.ts';
import { loadPage } from '#lib/server/page.ts';

export const load: PageServerLoad = ({ locals, url }) =>
  loadPage(
    { pages, patterns },
    {
      url,
      basePath,
      api: locals.api,
      session: () => locals.session(),
      navigation: () => locals.navigation(),
      needsFirstAdmin: () => locals.bootstrap(),
      publicApi,
    },
  );
