// The mail and the inbox items of membership (plan §7 item 8), written inside the caller's
// transaction through `core.notifications` (ADR 0019): a rollback sends nothing, a commit guarantees
// the mail is tried. Recipients are people, found through the public service of `core.identity`; this
// module reads no identity table.
//
// A mail names the organisation and, in a request, the requester's username. It never carries an
// address beyond the recipient's own, and a link is `<origin><base path><page>`, built with the
// instance values (rule 9), never a constant.
import { url } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { IdentityService } from '@scorpion/core-identity/public';
import type { NotificationsService } from '@scorpion/core-notifications/public';
import type { SettingsService } from '@scorpion/core-settings/public';
import type { DbTx, ModuleContext } from '@scorpion/kernel';
import { and, asc, eq } from 'drizzle-orm';
import { membership } from '../db/schema.ts';

/** The user preference that picks a person's language (registered by core.notifications). */
const LOCALE_PREFERENCE = 'notifications.locale';
const ADMIN_ROLE = 'admin';

export interface MembershipMailDeps {
  authz: Pick<AuthzService, 'listHoldersAsSystem'>;
  identity: Pick<IdentityService, 'users'>;
  notifications: Pick<NotificationsService, 'enqueueTemplate'>;
  settings: Pick<SettingsService, 'getUserPreference'>;
}

export interface OrganisationRef {
  id: string;
  name: string;
}

/** Who gets a mail: an active account, with the address it has (if any) and the language it prefers. */
interface Person {
  id: string;
  username: string;
  email: string | undefined;
  locale: string | undefined;
}

export interface MembershipMail {
  /** The page of an organisation, as an absolute URL. */
  organisationUrl(organisationId: string): string;
  /** A person's username, for a screen; `undefined` for an account that is gone. */
  usernameOf(userId: string): Promise<string | undefined>;
  /**
   * A request: the approved managers of the organisation and the administrators, once each, the
   * requester left out. A mail and an inbox item; an administrator's link is the administrators' screen.
   */
  requested(tx: DbTx, input: { requesterId: string; organisation: OrganisationRef }): Promise<void>;
  /** The decision, to the requester: a mail and an inbox item in their language. */
  decided(
    tx: DbTx,
    input: { userId: string; organisation: OrganisationRef; decision: 'approved' | 'rejected' },
  ): Promise<void>;
  /** A role change, to the person it concerns: an inbox item only. */
  roleChanged(
    tx: DbTx,
    input: { userId: string; organisation: OrganisationRef; role: 'member' | 'manager' },
  ): Promise<void>;
  /** "No manager": an inbox item for every administrator, no mail. */
  withoutManager(tx: DbTx, organisation: OrganisationRef): Promise<void>;
}

export function createMembershipMail(
  ctx: Pick<ModuleContext, 'config'>,
  deps: MembershipMailDeps,
): MembershipMail {
  const page = (path: string) => `${ctx.config.ORIGIN}${url(ctx.config.BASE_PATH, path)}`;
  const organisationUrl = (id: string) => page(`/organisations/${id}`);

  /** An active account, or `undefined`: a deactivated, rejected or deleted account gets nothing. */
  async function person(userId: string): Promise<Person | undefined> {
    const user = await deps.identity.users.findById(userId);
    if (!user || user.status !== 'active' || user.deletedAt !== null) return undefined;
    const locale = await deps.settings.getUserPreference(userId, LOCALE_PREFERENCE);
    return {
      id: user.id,
      username: user.username,
      email: user.email ?? undefined,
      locale: typeof locale === 'string' ? locale : undefined,
    };
  }

  const recipient = (who: Person) => ({
    ...(who.email !== undefined && { address: who.email }),
    userId: who.id,
  });

  async function administrators(tx: DbTx): Promise<string[]> {
    return deps.authz.listHoldersAsSystem(tx, ADMIN_ROLE);
  }

  return {
    organisationUrl,

    async usernameOf(userId) {
      return (await deps.identity.users.findById(userId))?.username;
    },

    async requested(tx, { requesterId, organisation }) {
      const requester = await deps.identity.users.findById(requesterId);
      if (!requester) return;
      const managers = await tx
        .select({ userId: membership.userId })
        .from(membership)
        .where(
          and(
            eq(membership.organisationId, organisation.id),
            eq(membership.state, 'approved'),
            eq(membership.role, 'manager'),
          ),
        )
        .orderBy(asc(membership.userId));
      const admins = new Set(await administrators(tx));
      // One mail per person, even for a manager who is also an administrator (who gets the
      // administrators' link); never one to the requester.
      const recipients = new Set([...managers.map((row) => row.userId), ...admins]);
      recipients.delete(requesterId);
      for (const userId of [...recipients].sort()) {
        const who = await person(userId);
        if (!who) continue;
        await deps.notifications.enqueueTemplate(tx, {
          template: 'registry.membership-requested',
          data: {
            applicant: requester.username,
            organisations: [organisation.name],
            reviewUrl: page(admins.has(userId) ? '/admin/memberships' : '/account/organisations'),
          },
          recipient: recipient(who),
          inApp: true,
          ...(who.locale !== undefined && { locale: who.locale }),
        });
      }
    },

    async decided(tx, { userId, organisation, decision }) {
      const who = await person(userId);
      if (!who) return;
      await deps.notifications.enqueueTemplate(tx, {
        template: 'registry.membership-decided',
        data: {
          organisation: organisation.name,
          decision,
          organisationUrl: organisationUrl(organisation.id),
        },
        recipient: recipient(who),
        inApp: true,
        ...(who.locale !== undefined && { locale: who.locale }),
      });
    },

    async roleChanged(tx, { userId, organisation, role }) {
      const who = await person(userId);
      if (!who) return;
      await deps.notifications.enqueueTemplate(tx, {
        template: 'registry.membership-role-changed',
        data: {
          organisation: organisation.name,
          role,
          organisationUrl: organisationUrl(organisation.id),
        },
        // No address: the template is an inbox item only.
        recipient: { userId: who.id },
        inApp: true,
        ...(who.locale !== undefined && { locale: who.locale }),
      });
    },

    async withoutManager(tx, organisation) {
      for (const userId of await administrators(tx)) {
        const who = await person(userId);
        if (!who) continue;
        await deps.notifications.enqueueTemplate(tx, {
          template: 'registry.organisation-without-manager',
          data: {
            organisation: organisation.name,
            organisationUrl: organisationUrl(organisation.id),
          },
          recipient: { userId: who.id },
          inApp: true,
          ...(who.locale !== undefined && { locale: who.locale }),
        });
      }
    },
  };
}
