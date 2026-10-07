import type { LayoutServerLoad } from './$types';
import { loadBranding } from '#lib/server/branding.ts';
import { basePath } from '#lib/server/env.ts';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  // Reading the path makes the load run again on every navigation: who is signed in, and what they
  // may see, are asked afresh for each page (the API is the source, nothing is cached in the page).
  void url.pathname;
  const [session, navigation, branding, locale] = await Promise.all([
    locals.session(),
    locals.navigation(),
    loadBranding(locals.api),
    locals.locale(),
  ]);
  return { basePath, session, navigation, branding, locale };
};
