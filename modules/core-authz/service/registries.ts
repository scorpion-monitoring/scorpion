// The registries core.authz owns. Modules contribute to them; the owner never branches on a module.
import type { UserActor } from '@scorpion/contracts';
import { z } from 'zod';
import { ROLE_KEY_FORMAT } from './permissions.ts';

/** What a permission is checked against, for permissions that declare a `scope`. */
export interface Resource {
  /** The kind of thing, equal to the `scope` of the permission: `service`. */
  type: string;
  /** Which one; the policy decides what it means. */
  id?: string;
  /** Who asked for the thing the caller is deciding on (a registration, a membership request). */
  requestedBy?: string;
  /**
   * True when the caller is deciding on someone's request (approve, reject). Nobody may decide on
   * their own request (`requestedBy` is the caller), whatever roles they hold.
   */
  approval?: boolean;
}

export const DEFAULT_ROLE_REGISTRY = 'authz.defaultRole';
export const RESOURCE_POLICY_REGISTRY = 'authz.resourcePolicy';

/**
 * Permissions a module gives a seeded role by default (for example Reviewer). Applied once per role
 * and permission (`authz_default_grant`). Admin needs none: it holds everything.
 */
export const defaultRoleEntrySchema = z.strictObject({
  role: z.string().regex(ROLE_KEY_FORMAT, 'must be a role key'),
  permissions: z.array(z.string().min(1)).min(1),
});
export type DefaultRoleEntry = z.infer<typeof defaultRoleEntrySchema>;

export interface ResourcePolicyRequest {
  actor: UserActor;
  permission: string;
  resource: Resource;
}

/**
 * Decides whether an actor holds a resource-scoped permission on one resource, for callers that do
 * not hold it globally (a member of the provider may edit the service). It can only add access: a
 * built-in protection is checked first and a policy cannot override it. A policy that throws is an
 * error, never a grant.
 */
export type ResourcePolicy = (request: ResourcePolicyRequest) => boolean | Promise<boolean>;

export const resourcePolicyEntrySchema = z.strictObject({
  /** The `scope` of the permissions this policy answers for. */
  resourceType: z.string().min(1),
  allows: z.custom<ResourcePolicy>((value) => typeof value === 'function', 'expected a function'),
});
export type ResourcePolicyEntry = z.infer<typeof resourcePolicyEntrySchema>;
