// The module's settings and the one place that reads them. The module reads through the
// `IdentitySettings` port, whose default implementation is `ctx.settings` (ADR 0017): the values an
// administrator saved through core.settings, validated by the schema below, with its defaults. Tests
// pass their own port.
import type { RateLimit } from '@scorpion/kernel';
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

/** One OIDC provider. The client secret is not here: it is in the secrets store (`oidc-secret.ts`). */
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

const DAY_MS = 24 * 3600 * 1000;

/** What the cleanup job keeps and how much it removes at once (README, "Cleanup"). */
export const DEFAULT_RETENTION = {
  purgeAfterDays: 30,
  tokenGraceDays: 30,
  purgeBatch: 500,
} as const;

/**
 * The lifetime of a session and the window of a recent authentication (ADR 0025,
 * `docs/security/sessions.md`). A session ends after `inactivityDays` without use, and at the latest
 * `absoluteDays` after it began, however often it is used.
 */
export const DEFAULT_SESSIONS = {
  inactivityDays: 7,
  absoluteDays: 30,
  recentAuthSeconds: 300,
} as const;

/** Mails that one address, and one signed-in user, may cause: a burst, then a steady rate per hour. */
export const DEFAULT_MAIL_BUDGETS = {
  perAddress: { burst: 3, perHour: 3 },
  perUser: { burst: 5, perHour: 5 },
} as const;

const mailBudget = z.strictObject({
  burst: z.number().int().min(1).max(1000),
  perHour: z.number().min(0.1).max(10_000),
});

export const settingsSchema = z.strictObject({
  /** Whether people may register and sign in with a password. Enforced on the server (defect 13). */
  localAccounts: z.boolean().default(true),
  /**
   * How long the hourly cleanup keeps things. A soft-deleted account keeps its username and address
   * for `purgeAfterDays` before it is purged (ADR 0013); an expired or revoked access token is shown
   * to its owner for `tokenGraceDays`; at most `purgeBatch` accounts go per run.
   */
  retention: z
    .strictObject({
      purgeAfterDays: z.number().int().min(1).max(3650).default(DEFAULT_RETENTION.purgeAfterDays),
      tokenGraceDays: z.number().int().min(1).max(3650).default(DEFAULT_RETENTION.tokenGraceDays),
      purgeBatch: z.number().int().min(1).max(10_000).default(DEFAULT_RETENTION.purgeBatch),
    })
    .default({ ...DEFAULT_RETENTION }),
  /**
   * How many mails one address can be sent (reset and confirmation links) and how many confirmation
   * mails one signed-in user can ask for. They protect the owner of an address from a flood.
   */
  mailBudgets: z
    .strictObject({
      perAddress: mailBudget.default({ ...DEFAULT_MAIL_BUDGETS.perAddress }),
      perUser: mailBudget.default({ ...DEFAULT_MAIL_BUDGETS.perUser }),
    })
    .default({
      perAddress: { ...DEFAULT_MAIL_BUDGETS.perAddress },
      perUser: { ...DEFAULT_MAIL_BUDGETS.perUser },
    }),
  /**
   * `inactivityDays`: a session ends this long after its last use. `absoluteDays`: it ends this long
   * after it began whatever the use (at least `inactivityDays`). `recentAuthSeconds`: how recently
   * the person must have signed in or confirmed their identity for an email change, linking a
   * provider, ending a session or "log out everywhere". A session keeps the end it was created
   * with; a changed value applies to new sessions.
   */
  sessions: z
    .strictObject({
      inactivityDays: z.number().int().min(1).max(365).default(DEFAULT_SESSIONS.inactivityDays),
      absoluteDays: z.number().int().min(1).max(365).default(DEFAULT_SESSIONS.absoluteDays),
      recentAuthSeconds: z
        .number()
        .int()
        .min(30)
        .max(3600)
        .default(DEFAULT_SESSIONS.recentAuthSeconds),
    })
    .refine(
      (value) => value.absoluteDays >= value.inactivityDays,
      'absoluteDays must not be less than inactivityDays',
    )
    .default({ ...DEFAULT_SESSIONS }),
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

/** The token bucket for a mail budget. */
export const budgetLimit = (budget: { burst: number; perHour: number }): RateLimit => ({
  capacity: budget.burst,
  refillPerSecond: budget.perHour / 3600,
});

/** Days as milliseconds, for the cutoffs of the cleanup job. */
export const daysToMs = (days: number): number => days * DAY_MS;
