// The one place that knows where an OIDC client secret comes from: the encrypted secrets store of
// core.settings (ADR 0016), under `oidc.<provider id>.client-secret`. There is no environment
// fallback (M3 decision 4): `OIDC_<ID>_CLIENT_SECRET` is not read. The value is returned to the
// caller that needs it for the code exchange and is never put in settings, a log line, an error
// message, a response or an event.
import type { SettingsService } from '@scorpion/core-settings/public';

/** `oidc.keycloak.client-secret`. Provider ids are lower-case letters, digits and `-`, so the name is a valid secret name. */
export const clientSecretName = (providerId: string): string => `oidc.${providerId}.client-secret`;

export type ClientSecretLookup = (
  providerId: string,
) => Promise<string | undefined> | string | undefined;

/** `undefined` when none is stored: the provider's client is then a public client (PKCE only). */
export const clientSecretFrom =
  (settings: Pick<SettingsService, 'getSecret'>): ClientSecretLookup =>
  (providerId) =>
    settings.getSecret(clientSecretName(providerId));
