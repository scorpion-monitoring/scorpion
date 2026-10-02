// The registry `auth.approvalPolicy`: how a new account gets its first status. A policy decides
// from the registration context, so `auto-by-email-domain` and `invite-only` (docs/backlog.md) are
// contributions from other modules and need no change here. Which policy is in force is the
// `approvalPolicy` setting.
import { z } from 'zod';

export const APPROVAL_POLICY_REGISTRY = 'auth.approvalPolicy';

/** What a policy may look at: how the account is being created, never a password or a secret. */
export interface RegistrationContext {
  username: string;
  email: string | undefined;
  /** True only when an identity provider vouched for the address. */
  emailVerified: boolean;
  /** `local` for a password registration, else the id of the OIDC provider. */
  provider: string;
}

export interface ApprovalDecision {
  status: 'pending' | 'active';
}

export type ApprovalPolicy = (
  registration: RegistrationContext,
) => ApprovalDecision | Promise<ApprovalDecision>;

export const approvalPolicyEntrySchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'must be lower-case letters, digits and "-"'),
  description: z.string().min(1).optional(),
  decide: z.custom<ApprovalPolicy>((value) => typeof value === 'function', 'expected a function'),
});

export type ApprovalPolicyEntry = z.infer<typeof approvalPolicyEntrySchema>;

/** Every new account waits until someone with the permission approves it. */
export const manualPolicy: ApprovalPolicyEntry = {
  id: 'manual',
  description: 'Every new account waits for approval.',
  decide: () => ({ status: 'pending' }),
};
