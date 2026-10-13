// The notice to the provider when a Reviewer or an administrator makes a service public or private again
// (plan §7 item 6), written inside the caller's transaction through `core.notifications` (ADR 0019): a rollback
// sends nothing, a commit guarantees the mail is tried.
//
// Who gets it: the approved managers of the provider and the person who created the service, found at the
// moment of sending (nothing is cached), never the person who decided, and only an active account. Each gets an
// inbox item and, if the account has an address and has not switched the category off, a mail. The mail names
// the service and the new state; it names nobody and carries no address beyond the recipient's own.
import { url } from '@scorpion/contracts';
import type { IdentityService } from '@scorpion/core-identity/public';
import type { NotificationsService } from '@scorpion/core-notifications/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import type { DbTx, ModuleContext } from '@scorpion/kernel';
import type { OrganisationsPublic } from '@scorpion/registry-organisations/public';

/** The user preference that picks a person's language (registered by core.notifications). */
const LOCALE_PREFERENCE = 'notifications.locale';

export interface PublicationMailDeps {
  identity: Pick<IdentityService, 'users'>;
  notifications: Pick<NotificationsService, 'enqueueTemplate'>;
  settings: Pick<SettingsService, 'getUserPreference'>;
  organisations: Pick<OrganisationsPublic, 'listApprovedManagerIdsAsSystem'>;
}

export interface PublicationNotice {
  serviceId: string;
  serviceName: string;
  /** The organisation that owns the service now. */
  providerId: string | undefined;
  /** The user who created it, when known. */
  createdBy: string | null;
  /** The user who decided; never a recipient. */
  actorId: string | null;
  state: 'public' | 'private';
}

export interface PublicationMail {
  /** Returns how many people were written to (for a test and a log line, never their ids). */
  notify(tx: DbTx, notice: PublicationNotice): Promise<number>;
}

export function createPublicationMail(
  ctx: Pick<ModuleContext, 'config'>,
  deps: PublicationMailDeps,
): PublicationMail {
  const page = (path: string) => `${ctx.config.ORIGIN}${url(ctx.config.BASE_PATH, path)}`;

  return {
    async notify(tx, notice) {
      const managers = notice.providerId
        ? await deps.organisations.listApprovedManagerIdsAsSystem(notice.providerId)
        : [];
      const recipients = new Set(managers);
      if (notice.createdBy) recipients.add(notice.createdBy);
      if (notice.actorId) recipients.delete(notice.actorId);
      const known = await deps.identity.users.findByIds([...recipients]);
      let written = 0;
      for (const userId of [...recipients].sort()) {
        const user = known.get(userId);
        // A deactivated, rejected or deleted account gets nothing.
        if (!user || user.status !== 'active' || user.deletedAt !== null) continue;
        const locale = await deps.settings.getUserPreference(userId, LOCALE_PREFERENCE);
        await deps.notifications.enqueueTemplate(tx, {
          template: 'registry.service-publication',
          data: {
            service: notice.serviceName,
            state: notice.state,
            serviceUrl: page(`/services/${notice.serviceId}`),
          },
          recipient: { ...(user.email ? { address: user.email } : {}), userId },
          inApp: true,
          ...(typeof locale === 'string' && { locale }),
        });
        written++;
      }
      return written;
    },
  };
}
