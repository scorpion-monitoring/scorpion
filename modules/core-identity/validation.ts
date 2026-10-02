// Input rules for accounts. The service applies them to every caller (routes, CLI, OIDC
// provisioning), so no entry point can skip one. Size limits are part of the rules.
import { z } from 'zod';
import { SCOPE, SCOPE_MAX_LENGTH, SCOPES_MAX } from './service/token-format.ts';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 31;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 255;
/** RFC 5321: a mailbox address is at most 254 characters. */
export const EMAIL_MAX = 254;
export const SUBJECT_MAX = 255;

export const username = z
  .string()
  .min(USERNAME_MIN)
  .max(USERNAME_MAX)
  .regex(/^[a-z0-9_-]+$/, 'may contain only lower-case letters, digits, "_" and "-"');

export const password = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);

export const email = z.email().max(EMAIL_MAX);

/** `local`, or the id of a configured OIDC provider. */
export const providerId = z
  .string()
  .regex(
    /^[a-z][a-z0-9-]{0,62}$/,
    'must be lower-case letters, digits and "-", starting with a letter',
  );

const localAuth = z.strictObject({ provider: z.literal('local'), password });
const externalAuth = z.strictObject({
  provider: providerId.refine((value) => value !== 'local', 'is reserved for password accounts'),
  /** The user's id at the provider (the `sub` claim). */
  subject: z.string().min(1).max(SUBJECT_MAX),
});

export const createUserInput = z
  .strictObject({
    username,
    email: email.optional(),
    /** Only an identity provider's word makes an address verified; a password account starts unverified. */
    emailVerified: z.boolean().default(false),
    /** `pending` waits for approval (the default); `active` is for trusted callers such as `create-admin`. */
    status: z.enum(['pending', 'active']).default('pending'),
    auth: z.union([localAuth, externalAuth]),
  })
  .superRefine((value, ctx) => {
    if (value.emailVerified && value.email === undefined) {
      ctx.addIssue({ code: 'custom', path: ['emailVerified'], message: 'needs an email address' });
    }
    if (value.emailVerified && value.auth.provider === 'local') {
      ctx.addIssue({
        code: 'custom',
        path: ['emailVerified'],
        message: 'cannot be set for a password account; the owner confirms by mail',
      });
    }
  });

export type CreateUserInput = z.input<typeof createUserInput>;

/** The body of `POST /register`: a password account. Unlike `createUserInput`, the email is required. */
export const registerInput = z.strictObject({ username, email, password });
export type RegisterInput = z.infer<typeof registerInput>;

/**
 * The body of `POST /login`. Only the size is limited here, not the registration rules: a rule
 * that changes later must not lock out an old account, and the answer must not hint at them.
 */
export const loginInput = z.strictObject({
  username: z.string().min(1).max(USERNAME_MAX),
  password: z.string().min(1).max(PASSWORD_MAX),
});
export type LoginInput = z.infer<typeof loginInput>;

export const TOKEN_NAME_MAX = 64;

/** A scope is `read:` or `write:` and a dotted kebab-case resource. Which resources exist is up to the modules (M3). */
export const scope = z
  .string()
  .max(SCOPE_MAX_LENGTH)
  .regex(SCOPE, 'must look like "read:kpi" or "write:registry.services"');

const tokenName = z
  .string()
  .trim()
  .min(1)
  .max(TOKEN_NAME_MAX)
  .regex(/^[^\p{Cc}]+$/u, 'may not contain control characters');

const scopes = z
  .array(scope)
  .max(SCOPES_MAX)
  .transform((list) => [...new Set(list)].sort());

const expiresAt = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

/** The body of `POST /tokens`. `expiresAt` is optional (no expiry) and must lie in the future. */
export const createTokenInput = z.strictObject({
  name: tokenName,
  scopes: scopes.default([]),
  expiresAt: expiresAt.nullish().transform((value) => value ?? null),
});
export type CreateTokenInput = z.input<typeof createTokenInput>;

/** The body of `POST /tokens/{id}/rotate`: a new expiry, or the old one is kept. */
export const rotateTokenInput = z.strictObject({ expiresAt: expiresAt.optional() });
export type RotateTokenInput = z.input<typeof rotateTokenInput>;

/** The account `create-admin` and the first-run token create: active, with a password and an address. */
export const createAdminInput = z.strictObject({ username, email, password });
export type CreateAdminInput = z.infer<typeof createAdminInput>;

/** The body of `POST /bootstrap/first-admin`. The token is checked by the service; here only its size. */
export const redeemFirstRunInput = z.strictObject({
  token: z.string().min(1).max(128),
  username,
  email,
  password,
});

/** `:provider` in the OIDC routes. A malformed id is a 422; whether it exists is the service's 404. */
export const oidcProviderParam = z.object({ provider: providerId.max(32) });

/**
 * The callback's query. The provider sends `code` and `state`, or `error` and `state`. Unknown
 * parameters (`iss`, `session_state`, `error_description`) are ignored and never read. Missing or
 * oversized values are a 422; whether the state is good is the service's 400.
 */
export const oidcCallbackQuery = z.object({
  state: z.string().min(1).max(128),
  code: z.string().min(1).max(2048).optional(),
  error: z.string().min(1).max(64).optional(),
});

/** `POST /auth/password-reset`: only the address. The answer never depends on whether it is known. */
export const resetRequestInput = z.strictObject({ email });

/** A mailed token: only its size is limited here; whether it is good is the service's 400. */
const mailedToken = z.string().min(1).max(128);

/** `POST /auth/password-reset/confirm`. */
export const resetConfirmInput = z.strictObject({ token: mailedToken, password });
export type ResetConfirmInput = z.infer<typeof resetConfirmInput>;

/** `POST /auth/verify-email`. */
export const verifyEmailInput = z.strictObject({ token: mailedToken });

/** `POST /account/password`. The current password is checked, not validated against the rules. */
export const changePasswordInput = z.strictObject({
  currentPassword: z.string().min(1).max(PASSWORD_MAX),
  newPassword: password,
});
export type ChangePasswordInput = z.infer<typeof changePasswordInput>;
