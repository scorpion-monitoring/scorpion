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
  displayName: z.string().trim().min(1).max(100).meta({ title: 'Name shown on the button' }),
  /**
   * The icon of the sign-in button: a stored file, named by the SHA-256 of its content (uploaded as
   * a logo is, ADR 0018; `GET /files/{hash}`). Without one the button shows the name only.
   */
  iconHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'must be the SHA-256 of an uploaded file (64 lower-case hex digits)')
    .optional()
    .meta({ title: 'Icon', widget: 'logo' }),
  /** The issuer URL; discovery is `<issuer>/.well-known/openid-configuration`. */
  issuer: z
    .string()
    .max(500)
    .refine(isSecureUrl, 'must be an https URL (http only for localhost)')
    .meta({
      title: 'Issuer URL',
      description: 'Discovery is <issuer>/.well-known/openid-configuration.',
    }),
  clientId: z.string().min(1).max(255).meta({ title: 'Client ID' }),
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

/**
 * The throttle on failed password attempts (ADR 0026, `docs/security/authentication.md`). After
 * `freeAttempts` failures for one account from one network, and after `freeAttemptsPerAccount` for
 * the account from anywhere, a further failure blocks that key for `baseDelaySeconds`, doubling with
 * each failure up to `maxDelaySeconds`. Counters are forgotten after `forgetAfterSeconds` without a
 * failure. Nothing locks an account for good.
 */
export const DEFAULT_LOGIN_THROTTLE = {
  freeAttempts: 5,
  freeAttemptsPerAccount: 20,
  baseDelaySeconds: 15,
  maxDelaySeconds: 900,
  forgetAfterSeconds: 3600,
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
  localAccounts: z.boolean().default(true).meta({
    title: 'Password accounts',
    description:
      'Whether people may register and sign in with a password. Turn it off to allow only the sign-in providers below.',
  }),
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
    .default({ ...DEFAULT_RETENTION })
    .meta({
      title: 'Retention',
      description:
        'How long the hourly cleanup keeps rejected accounts, expired tokens and how many accounts it removes at once.',
    }),
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
    })
    .meta({
      title: 'Mail limits',
      description:
        'How many mails one address can be sent (reset and confirmation links) and how many confirmation mails one signed-in user can ask for. They protect the owner of an address from a flood.',
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
    .default({ ...DEFAULT_SESSIONS })
    .meta({
      title: 'Sessions',
      description:
        'A session ends after this many days without use, and at the latest after the absolute limit. The recent-authentication window is how recently someone must have signed in for a sensitive change. A changed value applies to new sessions.',
    }),
  /**
   * Whether a new password is checked against the Have I Been Pwned range API (only the first 5
   * characters of its SHA-1 are sent). Turn it off for an installation that may not call out. A
   * service that does not answer never blocks a password (it fails open and is counted).
   */
  passwordBreachCheck: z.boolean().default(true).meta({
    title: 'Check new passwords against known breaches',
    description:
      'Only the first 5 characters of the SHA-1 of a password are sent to the Have I Been Pwned range API. Turn it off for an installation that may not call out.',
  }),
  /** The brute-force throttle on failed password attempts; see `DEFAULT_LOGIN_THROTTLE`. */
  loginThrottle: z
    .strictObject({
      freeAttempts: z.number().int().min(1).max(1000).default(DEFAULT_LOGIN_THROTTLE.freeAttempts),
      freeAttemptsPerAccount: z
        .number()
        .int()
        .min(1)
        .max(10_000)
        .default(DEFAULT_LOGIN_THROTTLE.freeAttemptsPerAccount),
      baseDelaySeconds: z
        .number()
        .int()
        .min(1)
        .max(3600)
        .default(DEFAULT_LOGIN_THROTTLE.baseDelaySeconds),
      maxDelaySeconds: z
        .number()
        .int()
        .min(1)
        .max(86_400)
        .default(DEFAULT_LOGIN_THROTTLE.maxDelaySeconds),
      forgetAfterSeconds: z
        .number()
        .int()
        .min(60)
        .max(604_800)
        .default(DEFAULT_LOGIN_THROTTLE.forgetAfterSeconds),
    })
    .refine((value) => value.maxDelaySeconds >= value.baseDelaySeconds, {
      message: 'maxDelaySeconds must not be less than baseDelaySeconds',
    })
    .refine((value) => value.freeAttemptsPerAccount >= value.freeAttempts, {
      message: 'freeAttemptsPerAccount must not be less than freeAttempts',
    })
    .default({ ...DEFAULT_LOGIN_THROTTLE })
    .meta({
      title: 'Throttle on failed sign-ins',
      description:
        'After a few free failures a further one blocks that account and network for a delay that doubles up to a maximum. Nothing locks an account for good.',
    }),
  /** The id of the `auth.approvalPolicy` entry that decides the status of a new account. */
  approvalPolicy: z.string().min(1).default('manual').meta({
    title: 'Approval policy',
    description: 'How a new account becomes active. "manual" means an administrator approves it.',
  }),
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
    )
    .meta({
      title: 'Sign-in providers (OIDC)',
      description:
        'The OpenID Connect providers people may sign in with. None turns it off. The client secret of a provider is stored under Secrets, not here.',
    }),
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
