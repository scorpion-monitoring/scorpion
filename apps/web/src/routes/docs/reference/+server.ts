// The API reference (ADR-0038): a document of its own, not a page of a module, so it is a route of the
// shell outside the registry rule. GET only; everything that matters is in `reference.ts`.
import type { RequestHandler } from './$types';
import { url } from '@scorpion/contracts';
import { createTranslator } from '@scorpion/ui-kit';
import { loadBranding } from '#lib/server/branding.ts';
import { basePath } from '#lib/server/env.ts';
import { shellMessages } from '#lib/messages.ts';
import { newNonce, referencePolicy, renderReference } from '#lib/server/reference.ts';

export const GET: RequestHandler = async ({ locals }) => {
  const [branding, locale] = await Promise.all([loadBranding(locals.api), locals.locale()]);
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
