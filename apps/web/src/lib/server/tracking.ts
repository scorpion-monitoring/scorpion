// The origin of the usage tracker, for the page's CSP (ADR-0054). Asked of the API without the caller's cookie (the
// answer must not depend on who asks) and kept for a few seconds, like the settings it comes from, so a page does not
// cost one more API call. A profile without the module (404), tracking off, or an API that does not answer: no origin,
// and the policy stays what it is.
import { unwrap, type ApiClient } from '@scorpion/contracts/client';

/** How long an answer is kept: the bound of a settings change in the server (ADR-0017). */
export const TRACKING_TTL_MS = 5_000;

export function createTrackingOrigin(
  api: ApiClient,
  options: { ttlMs?: number; now?: () => number } = {},
): () => Promise<string | null> {
  const ttl = options.ttlMs ?? TRACKING_TTL_MS;
  const now = options.now ?? Date.now;
  let cached: { until: number; value: Promise<string | null> } | undefined;
  return () => {
    if (cached && cached.until > now()) return cached.value;
    const value = unwrap(api.GET('/matomo/tracker')).then(
      (config) => (config.enabled ? new URL(config.url).origin : null),
      () => null,
    );
    cached = { until: now() + ttl, value };
    return value;
  };
}
