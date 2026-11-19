// The mail to the administrators that a new account waits for review. Shared by every way an
// account is created (a password registration and a first OIDC sign-in), so no path forgets it.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { DbTx } from '@scorpion/kernel';
import { user } from '../db/schema.ts';
import type { User } from '../public.ts';
import type { IdentityMail } from './identity-mail.ts';
import type { MailLinks } from './mail-links.ts';
import { ADMIN_ROLE } from './roles.ts';

export interface RegistrationNoticeDeps {
  authz: Pick<AuthzService, 'listHoldersAsSystem'>;
  mail: IdentityMail;
  links: Pick<MailLinks, 'review'>;
}

/**
 * Queues, in `tx`, one mail to every active administrator who has an address, each in their own
 * language. The applicant's address is left out when the account has none (an OIDC sign-in whose
 * provider did not vouch for one).
 */
export async function mailAdministrators(
  tx: DbTx,
  deps: RegistrationNoticeDeps,
  applicant: User,
): Promise<void> {
  const adminIds = await deps.authz.listHoldersAsSystem(tx, ADMIN_ROLE);
  if (adminIds.length === 0) return;
  const admins = await tx
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(and(inArray(user.id, adminIds), eq(user.status, 'active'), isNull(user.deletedAt)))
    .orderBy(user.id);
  for (const admin of admins) {
    if (!admin.email) continue;
    await deps.mail.send(
      tx,
      'identity.registration-request',
      {
        applicantUsername: applicant.username,
        ...(applicant.email ? { applicantEmail: applicant.email } : {}),
        reviewUrl: deps.links.review(),
      },
      { address: admin.email, userId: admin.id },
      await deps.mail.preferredLocale(admin.id),
    );
  }
}
