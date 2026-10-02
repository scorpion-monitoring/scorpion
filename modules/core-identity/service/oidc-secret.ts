// The one place that knows where an OIDC client secret comes from. Until M3 (the encrypted secrets
// store) it is an environment variable named after the provider; M3 changes this function and
// nothing else. The value is returned to the caller that needs it for the code exchange and is
// never put in settings, a log line, an error message, a response or an event.

/** `OIDC_<ID>_CLIENT_SECRET`: the provider id upper-cased, `-` replaced by `_` (ids have no `_`, so it is unambiguous). */
export const clientSecretVariable = (providerId: string): string =>
  `OIDC_${providerId.toUpperCase().replaceAll('-', '_')}_CLIENT_SECRET`;

export type ClientSecretLookup = (providerId: string) => string | undefined;

/** `undefined` when none is set: the provider's client is then a public client (PKCE only). */
export const clientSecretFor: ClientSecretLookup = (providerId) => {
  const value = process.env[clientSecretVariable(providerId)];
  return value === undefined || value === '' ? undefined : value;
};
