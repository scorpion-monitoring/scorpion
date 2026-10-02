// The module's settings and the one place that reads them. The manifest `settings` field is only
// validated and stored by the kernel today and `ctx` has no settings access (docs/backlog.md), so
// the module reads through this port. Its default implementation yields the defaults of the
// module's own schema; M3 (core.settings) replaces `defaultSettings` and nothing else.
import { z } from 'zod';
import { providerId } from '../validation.ts';

/** An issuer or endpoint must be https; http is for a provider on the same machine (development, tests). */
export function isSecureUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

/** One OIDC provider. The client secret is not here: it comes from the environment (`oidc-secret.ts`). */
export const oidcProviderSchema = z.strictObject({
  /** Lower-case letters, digits and "-"; in the callback URL and in `identity_auth_method.provider`. */
  id: providerId.max(32).refine((value) => value !== 'local', 'is reserved for password accounts'),
  displayName: z.string().trim().min(1).max(100),
  /** The issuer URL; discovery is `<issuer>/.well-known/openid-configuration`. */
  issuer: z.string().max(500).refine(isSecureUrl, 'must be an https URL (http only for localhost)'),
  clientId: z.string().min(1).max(255),
  scopes: z
    .array(z.string().regex(/^[\x21\x23-\x5B\x5D-\x7E]+$/, 'is not a valid scope token'))
    .max(20)
    .default(['openid', 'email', 'profile'])
    .refine((scopes) => scopes.includes('openid'), 'must include "openid"'),
});

export type OidcProvider = z.infer<typeof oidcProviderSchema>;

/** What a mail says when the settings do not name the instance or the sender. */
export const DEFAULT_INSTANCE_NAME = 'Scorpion';
export const DEFAULT_MAIL_FROM = 'no-reply@localhost';

export const settingsSchema = z.strictObject({
  /** Whether people may register and sign in with a password. Enforced on the server (defect 13). */
  localAccounts: z.boolean().default(true),
  /**
   * How mails from core.identity name the instance and who they come from. Until core.settings
   * (M3) and core.notifications (M4) own branding and the sender address, they live here; no
   * mail text hard-codes either.
   */
  instanceName: z.string().trim().min(1).max(100).optional(),
  mailFrom: z.string().trim().min(3).max(254).optional(),
  /** The id of the `auth.approvalPolicy` entry that decides the status of a new account. */
  approvalPolicy: z.string().min(1).default('manual'),
  /**
   * The OIDC providers people may sign in with. None by default, which turns OIDC off. They are
   * independent of `localAccounts`: signing in through a provider is a separate way in (ADR 0011).
   */
  oidcProviders: z
    .array(oidcProviderSchema)
    .max(20)
    .default([])
    .refine(
      (list) => new Set(list.map((p) => p.id)).size === list.length,
      'provider ids must be unique',
    ),
});

export type IdentitySettingsValues = z.infer<typeof settingsSchema>;

export interface IdentitySettings {
  get(): Promise<IdentitySettingsValues>;
}

/** Until M3: no stored settings, so the defaults of the schema apply. */
export const defaultSettings: IdentitySettings = {
  get: () => Promise.resolve(settingsSchema.parse({})),
};
