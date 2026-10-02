// Input rules for accounts. The service applies them to every caller (routes, CLI, OIDC
// provisioning), so no entry point can skip one. Size limits are part of the rules.
import { z } from 'zod';

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
