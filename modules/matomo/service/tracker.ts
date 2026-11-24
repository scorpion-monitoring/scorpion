// What the browser's tracker needs to know (ADR-0054). The route is public: anonymous visitors are counted too. The
// answer holds nothing the tracker script would not show anyway, except the caller's own pseudonymous id.
import { createHmac } from 'node:crypto';
import type { Actor } from '@scorpion/contracts';
import type { Logger } from '@scorpion/kernel';
import type { MatomoSettings } from '../settings-schema.ts';

/** The secret that keys the pseudonymous user id (secrets store of core.settings). */
export const USER_ID_KEY_SECRET = 'matomo.user-id-key';

/** Length of the pseudonymous id, in hex characters (128 bits). */
export const USER_ID_LENGTH = 32;

export type TrackerConfig =
  | { enabled: false }
  | {
      enabled: true;
      /** The Matomo base address, always ending in `/`. */
      url: string;
      siteId: number;
      cookieless: boolean;
      respectDoNotTrack: boolean;
      /** The caller's pseudonymous id: only for a signed-in person, and only with the option on and the secret set. */
      userId?: string;
    };

export interface TrackerService {
  /** The configuration for this caller. */
  tracker(actor: Actor): Promise<TrackerConfig>;
}

export interface TrackerDependencies {
  settings: () => Promise<MatomoSettings>;
  /** Reads a secret of the secrets store; `undefined` when it is not set. */
  secret: (name: string) => Promise<string | undefined>;
  log: Logger;
}

/**
 * The pseudonymous id of a user: an HMAC of the user id under the secret, so Matomo never sees a Scorpion id and nobody can
 * tell whose it is without the secret. A new secret gives everybody a new id.
 */
export function pseudonymousId(key: string, userId: string): string {
  return createHmac('sha256', key)
    .update(`scorpion.matomo.user-id.v1\0${userId}`, 'utf8')
    .digest('hex')
    .slice(0, USER_ID_LENGTH);
}

/** The base address with exactly one trailing `/`, so `matomo.js` and `matomo.php` can be appended. */
export function baseUrl(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

export function createTrackerService(deps: TrackerDependencies): TrackerService {
  let warnedMissingKey = false;
  return {
    async tracker(actor) {
      const settings = await deps.settings();
      // The schema already requires both while enabled; a stored value it dropped on read must still mean "off".
      if (!settings.enabled || settings.url === undefined || settings.siteId === undefined) {
        return { enabled: false };
      }
      const config: TrackerConfig = {
        enabled: true,
        url: baseUrl(settings.url),
        siteId: settings.siteId,
        cookieless: settings.cookieless,
        respectDoNotTrack: settings.respectDoNotTrack,
      };
      if (!settings.pseudonymousUserId || actor.kind !== 'user') return config;
      const key = await deps.secret(USER_ID_KEY_SECRET);
      if (key === undefined) {
        if (!warnedMissingKey) {
          warnedMissingKey = true;
          // The name goes in the message: the log redacts a field called `secret`.
          deps.log.warn(
            `pseudonymousUserId is on but the secret ${USER_ID_KEY_SECRET} is not set; signed-in people are counted without an id`,
          );
        }
        return config;
      }
      warnedMissingKey = false;
      return { ...config, userId: pseudonymousId(key, actor.userId) };
    },
  };
}
