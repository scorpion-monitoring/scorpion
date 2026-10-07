import { unwrap, type ApiClient, type Branding } from '@scorpion/contracts/client';

/**
 * How the instance presents itself, from the branding settings. The shell depends on `core.settings`,
 * so the route is always there; a failure is the API being down and reaches the visitor as the error page.
 */
export function loadBranding(api: ApiClient): Promise<Branding> {
  return unwrap(api.GET('/branding'));
}
