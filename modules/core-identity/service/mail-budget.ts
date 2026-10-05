// The mail budget of an address (ADR 0012): how many mails one address may be sent, so the feature
// cannot be used to flood somebody. It is spent for every address, known or not, so exhausting it
// says nothing about whether an account exists. Used by the reset request, the verification mail and
// registration (both of its paths).
import { createHash } from 'node:crypto';
import { createRateLimiter, type ModuleContext } from '@scorpion/kernel';
import { budgetLimit, type IdentitySettings } from './settings.ts';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export interface MailBudget {
  /** Spends one mail from the address's budget; false when it has had its share for now. */
  spend(address: string): Promise<boolean>;
}

export function createMailBudget(ctx: ModuleContext, settings: IdentitySettings): MailBudget {
  const limiter = createRateLimiter(ctx.db);
  return {
    async spend(address) {
      const { mailBudgets } = await settings.get();
      const decision = await limiter.consume(
        `identity.mail:${sha256(address.toLowerCase())}`,
        budgetLimit(mailBudgets.perAddress),
      );
      return decision.allowed;
    },
  };
}
