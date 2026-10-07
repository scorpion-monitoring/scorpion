// Linking a provider by mail confirmation (ADR 0026, ASVS 6.8.1). A first sign-in at a provider whose
// verified address an existing account holds links nothing and signs nobody in: `request` mails a
// single-use 10-minute token to the account's own address, and `confirm` links the identity only
// when the account holder, signed in to that account and recently authenticated, presents it.
//
// An attacker can make `request` run by asserting somebody's address at a provider they operate. So
// the mail changes nothing by itself, goes only to the account's own address, is bounded by the
// address's mail budget, and is useless without the signed-in session of the account.
import { Invalid, Unauthorized, type Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { ModuleContext } from '@scorpion/kernel';
import type { ZodError } from 'zod';
import type { User, UserService } from '../public.ts';
import { confirmOidcLinkInput } from '../validation.ts';
import { addIdentityIn } from './identity-link.ts';
import type { IdentityMail } from './identity-mail.ts';
import type { MailBudget } from './mail-budget.ts';
import type { MailLinks } from './mail-links.ts';
import { claimMailToken, issueMailToken, OIDC_LINK_TTL_MS, peekMailToken } from './mail-tokens.ts';
import { BadRequest } from './oidc-errors.ts';
import { requireSession } from './require-user.ts';
import type { SessionService } from './sessions.ts';
import type { IdentitySettings, OidcProvider } from './settings.ts';

function invalid(error: ZodError): Invalid {
  return new Invalid(
    'The request is not valid.',
    error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}

const LINK_PROBLEM = 'This link is not valid or has expired. Start the sign-in again.';

export interface OidcLinkService {
  /**
   * A provider asserted a verified address that `existing` holds, for a `subject` not known yet.
   * Mails the account's own address and stores the token, in one transaction; nothing when the
   * account is rejected or deleted or the address has had its mails for the hour. Resolves the
   * same in every case. Never links and never signs in.
   */
  request(provider: OidcProvider, subject: string, existing: User, now?: Date): Promise<void>;
  /**
   * Links the identity the token names to the caller's own account. Needs a session of the account
   * the mail went to (another account's session, or an access token, is refused and leaves the token
   * usable) and a recent authentication (401 `reauthentication-required`). 400 for any token that is
   * not good; 409 when the identity is linked already. Returns the provider that was linked.
   */
  confirm(actor: Actor, input: unknown, now?: Date): Promise<{ provider: string; name: string }>;
}

export function createOidcLinkService(
  ctx: ModuleContext,
  deps: {
    authz: AuthzService;
    users: UserService;
    sessions: SessionService;
    settings: IdentitySettings;
    mail: IdentityMail;
    budget: MailBudget;
    links: MailLinks;
  },
): OidcLinkService {
  const { authz, users, sessions, settings, mail, budget, links } = deps;

  return {
    async request(provider, subject, existing, now = new Date()) {
      // Spent whether or not a mail goes out, before anything tells the cases apart.
      const mayMail = await budget.spend(existing.email ?? '');
      if (
        !mayMail ||
        !existing.email ||
        existing.deletedAt !== null ||
        existing.status === 'rejected'
      ) {
        return;
      }
      const locale = await mail.preferredLocale(existing.id);
      await ctx.db.tx(async (tx) => {
        const token = await issueMailToken(tx, {
          userId: existing.id,
          purpose: 'oidc-link',
          identity: { provider: provider.id, subject },
          ttlMs: OIDC_LINK_TTL_MS,
          now,
        });
        // Queued before the event, so a failing outbox rolls the mail back with the token.
        await mail.send(
          tx,
          'identity.oidc-link',
          {
            linkUrl: links.oidcLink(token),
            providerName: provider.displayName,
            validForMinutes: OIDC_LINK_TTL_MS / 60_000,
          },
          { address: existing.email!, userId: existing.id },
          locale,
        );
        await ctx.events.emit('identity.authMethod.linkRequested@1', {
          userId: existing.id,
          username: existing.username,
          provider: provider.id,
        });
      });
    },

    async confirm(actor, input, now = new Date()) {
      const caller = requireSession(actor, 'Confirming a sign-in link');
      await authz.require(actor, 'core.identity.auth-method.link');
      // Adding a way to sign in needs a recent authentication (ASVS 7.5.1), checked before the token
      // is touched, so a stale session spends nothing.
      await sessions.requireRecentAuth(actor);
      const parsed = confirmOidcLinkInput.safeParse(input);
      if (!parsed.success) throw invalid(parsed.error);
      const { token } = parsed.data;

      // Looked at, not used: another account's token stays whole, and answers like an unknown one.
      const peeked = await peekMailToken(ctx.db, token, 'oidc-link', now);
      if (!peeked || peeked.userId !== caller.userId || !peeked.provider || !peeked.subject) {
        throw new BadRequest(LINK_PROBLEM);
      }
      const { oidcProviders } = await settings.get();
      const provider = oidcProviders.find((entry) => entry.id === peeked.provider);
      if (!provider) throw new BadRequest(LINK_PROBLEM);
      const account = await users.findById(caller.userId);
      if (!account || account.deletedAt !== null || account.status !== 'active') {
        throw new Unauthorized('The session is not valid. Sign in again.');
      }

      await ctx.db.tx(async (tx) => {
        // One conditional update, and only for this account: two requests with the same link link once.
        const claimed = await claimMailToken(tx, token, 'oidc-link', now, caller.userId);
        if (!claimed?.provider || !claimed.subject) throw new BadRequest(LINK_PROBLEM);
        await addIdentityIn(ctx, tx, account, claimed.provider, claimed.subject, 'email');
      });
      return { provider: provider.id, name: provider.displayName };
    },
  };
}
