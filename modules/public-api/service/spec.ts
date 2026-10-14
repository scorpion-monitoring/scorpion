// The runtime OpenAPI document of the public API (v1): the routes the loaded modules registered with
// `r.public('v1', …)`, described by the same generator `pnpm openapi:generate` uses, so the committed
// document and this one are the same document unless an administrator changed the title or contact.
import { generateV1Document, type OpenApiDocument } from '@scorpion/contracts';
import type { RegisteredRoute } from '@scorpion/kernel';
import type { PublicApiSettings } from '../settings-schema.ts';

export function buildSpec(
  routes: readonly RegisteredRoute[],
  settings: PublicApiSettings,
  /** `https://example.org/base`: the request's origin plus the base path plus `/api/v1`; none to leave `servers` out. */
  serverUrl?: string,
): OpenApiDocument {
  const contact = {
    ...(settings.contactName ? { name: settings.contactName } : {}),
    ...(settings.contactEmail ? { email: settings.contactEmail } : {}),
    ...(settings.contactUrl ? { url: settings.contactUrl } : {}),
  };
  return generateV1Document(
    routes.filter((entry) => entry.surface === 'v1').map((entry) => entry.route),
    {
      title: settings.specTitle,
      description: settings.specDescription,
      contact,
      servers: serverUrl ? [serverUrl] : undefined,
    },
  );
}
