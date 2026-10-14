// The API reference (ADR-0038): a document of its own, not a page of a module, so it is a route of the
// shell outside the registry rule. GET only; everything that matters is in `reference.ts`.
import type { RequestHandler } from './$types';
import { url } from '@scorpion/contracts';
import { createTranslator, negotiateLocale } from '@scorpion/ui-kit';
import { loadBranding } from '#lib/server/branding.ts';
import { basePath } from '#lib/server/env.ts';
import { shellMessages } from '#lib/messages.ts';
import { newNonce, referencePolicy, renderReference } from '#lib/server/reference.ts';

export const GET: RequestHandler = async ({ locals, request }) => {
  const branding = await loadBranding(locals.api);
  // The language of the one link back is the browser's, not the saved preference: reading the preference
  // costs two more API calls (the session and the preferences) on a page that has one text to translate.
  const locale = negotiateLocale({ acceptLanguage: request.headers.get('accept-language') });
  const nonce = newNonce();
  const html = await renderReference({
    nonce,
    documentUrl: url(basePath, '/api/v1/openapi.json'),
    assetUrl: url(basePath, __SCALAR_ASSET__),
    backUrl: url(basePath, '/docs'),
    instanceName: branding.instanceName,
    backLabel: createTranslator(shellMessages, locale)('app.reference.back'),
  });
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': referencePolicy(nonce),
      'cache-control': 'no-cache',
    },
  });
};
