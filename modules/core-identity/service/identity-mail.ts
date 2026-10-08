// How core.identity sends mail: through the public service of core.notifications, inside the
// transaction that does the work (ADR 0019), so a rollback sends nothing and a commit guarantees the
// mail will be tried. The service never writes a mail itself; it names a template and its data.
import type { NotificationsService } from '@scorpion/core-notifications/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import type { DbTx } from '@scorpion/kernel';
import type { IdentityMailData } from './mail-templates.ts';

/** The user preference that picks a person's language (registered by core.notifications). */
export const LOCALE_PREFERENCE = 'notifications.locale';

/**
 * The identity mails that also earn an inbox item (M5 sprint 4, recorded in the README of
 * core.notifications). A mail earns one when the person it goes to is an account and may be reading the
 * application: a registration that waits for review (to the administrators, with a link to the page), the
 * approval of an account (the first thing a person finds after signing in) and the notice that somebody
 * tried to register with the address of an account (a security notice for its holder). The rest do not: a
 * link that is a credential never goes to an inbox (the template is `sensitive`), the welcome mail goes to
 * somebody who cannot sign in yet, and a rejected account is gone.
 */
export const INBOX_TEMPLATES: ReadonlySet<keyof IdentityMailData> = new Set([
  'identity.registration-request',
  'identity.approved',
  'identity.register-attempt',
]);

export interface Recipient {
  address: string;
  /** An opaque user id, kept on the delivery row for the status list. */
  userId?: string;
}

export interface IdentityMail {
  /**
   * Stores the mail in `tx`, the caller's transaction. `locale` is the language a request carried
   * or a user prefers; core.notifications checks it against the shipped list and falls back to the
   * instance's default.
   */
  send<K extends keyof IdentityMailData>(
    tx: DbTx,
    template: K,
    data: IdentityMailData[K],
    to: Recipient,
    locale?: string,
  ): Promise<void>;
  /** The language a user chose in their preferences, or `undefined`. Never throws for a user without one. */
  preferredLocale(userId: string): Promise<string | undefined>;
}

export function createIdentityMail(deps: {
  notifications: Pick<NotificationsService, 'enqueueTemplate'>;
  settings: Pick<SettingsService, 'getUserPreference'>;
}): IdentityMail {
  return {
    async send(tx, template, data, to, locale) {
      await deps.notifications.enqueueTemplate(tx, {
        template,
        data,
        recipient: to,
        // Only for an account (a user id); core.notifications still honours the person's switches.
        inApp: INBOX_TEMPLATES.has(template) && to.userId !== undefined,
        locale,
      });
    },
    async preferredLocale(userId) {
      const value = await deps.settings.getUserPreference(userId, LOCALE_PREFERENCE);
      return typeof value === 'string' ? value : undefined;
    },
  };
}
