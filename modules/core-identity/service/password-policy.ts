// The rules for a new password beyond its length (ASVS 6.1.2, 6.2.4, 6.2.11, 6.2.12), applied by
// every code path that sets one, before a transaction or a hash. See ADR 0026.
//
// Order: the words (local, cheap), then the breach service. The breach check fails open: when the
// service does not answer, the password is accepted and a warning without any password data is
// logged; the adapter counts it.
import { Invalid } from '@scorpion/contracts';
import type { PwnedPasswords } from '@scorpion/integrations';
import type { ModuleContext } from '@scorpion/kernel';
import { contextTerms, findContextWord } from './password-words.ts';
import type { IdentitySettings } from './settings.ts';

export interface PasswordSubject {
  username?: string | null;
  email?: string | null;
}

export interface PasswordPolicy {
  /**
   * Throws `Invalid` (422) on `field` when the password is a context word, or is in the breach set.
   * Messages never say how often a password was seen. `subject` adds the person's own names.
   */
  check(password: string, subject?: PasswordSubject, field?: string): Promise<void>;
}

export function createPasswordPolicy(
  ctx: ModuleContext,
  deps: {
    settings: IdentitySettings;
    /** The instance's branding names; read each time, they can change. */
    names: () => Promise<{ instanceName: string; productName: string }>;
    pwned: PwnedPasswords;
  },
): PasswordPolicy {
  const refuse = (field: string, message: string) =>
    new Invalid('The request is not valid.', [{ path: field, message }]);

  return {
    async check(password, subject = {}, field = 'password') {
      const names = await deps.names();
      const host = new URL(ctx.config.ORIGIN).hostname;
      const terms = contextTerms({ ...names, host, ...subject });
      if (findContextWord(password, terms)) {
        throw refuse(field, 'is too easy to guess: it contains the name of this service or of you');
      }

      if (!(await deps.settings.get()).passwordBreachCheck) return;
      const result = await deps.pwned.check(password);
      if (result === 'breached') {
        throw refuse(field, 'appears in lists of leaked or common passwords; choose another');
      }
      if (result === 'unavailable') {
        ctx.log.warn('the password breach check is unavailable; the password was accepted');
      }
    },
  };
}
