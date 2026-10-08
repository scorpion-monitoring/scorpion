// The HTTP routes of core.identity. Thin: Zod parses, one service call, the result is mapped.
// All of them are internal routes (`/api/internal/...`) for the web UI.
import {
  createRoute,
  listEnvelope,
  paginate,
  paginationQuery,
  z,
  type AppEnv,
  type RouteHandler,
} from '@scorpion/contracts';
import { MAX_UPLOAD_BYTES } from '@scorpion/core-blob/public';
import type { RouteRegistrar } from '@scorpion/kernel';
import {
  clearLoginCookie,
  clearSessionCookie,
  readLoginCookie,
  readSessionCookie,
  writeLoginCookie,
  writeSessionCookie,
} from './cookie.ts';
import type { AccountService } from './service/accounts.ts';
import type { ApprovalService } from './service/approval.ts';
import type { BootstrapService } from './service/bootstrap.ts';
import type { OidcLinkService } from './service/oidc-link.ts';
import type { OidcService } from './service/oidc.ts';
import { loginErrorCode } from './service/oidc-errors.ts';
import type { ProfileService } from './service/profile.ts';
import type { RecoveryService } from './service/recovery.ts';
import type { RoleService } from './service/roles.ts';
import type { SessionAdminService } from './service/session-admin.ts';
import type { SessionSummary } from './service/sessions.ts';
import type { CreatedToken, TokenInfo, TokenService } from './service/tokens.ts';
import type { AdminUser, UserAdminService } from './service/user-admin.ts';
import {
  approveInput,
  assignRoleInput,
  changePasswordInput,
  confirmOidcLinkInput,
  createTokenInput,
  loginInput,
  oidcCallbackQuery,
  oidcProviderParam,
  reauthenticateInput,
  redeemFirstRunInput,
  registerInput,
  resetConfirmInput,
  resetRequestInput,
  roleParam,
  rotateTokenInput,
  updateProfileInput,
  userListQuery,
  verifyEmailInput,
} from './validation.ts';

export interface IdentityRoutesServices {
  accounts: AccountService;
  approval: ApprovalService;
  bootstrap: BootstrapService;
  oidc: OidcService;
  oidcLink: OidcLinkService;
  profile: ProfileService;
  recovery: RecoveryService;
  roles: RoleService;
  sessionAdmin: SessionAdminService;
  tokens: TokenService;
  userAdmin: UserAdminService;
}

const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  status: z.enum(['pending', 'active', 'rejected', 'deactivated']),
});

const idParam = z.object({ id: z.uuid() });
const json = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { 'application/json': { schema } },
});
const ok = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
});

export const registerRoute = createRoute({
  method: 'post',
  path: '/auth/register',
  public: true,
  publicReason: 'Anyone may ask for an account; it waits for approval. Rate limited (strict).',
  rateLimit: 'strict',
  request: { body: json(registerInput) },
  responses: {
    202: ok(
      'The request was accepted. Always the same answer for a well-formed request, whether the email address is new or already has an account: a new address gets an account that waits for review, a taken one gets a mail to its owner and nothing else. Check your mail.',
      z.object({ accepted: z.literal(true) }),
    ),
    403: { description: 'Local accounts are turned off.' },
    409: { description: 'The username is taken (usernames are public).' },
  },
});

export const loginRoute = createRoute({
  method: 'post',
  path: '/auth/login',
  public: true,
  publicReason: 'Signing in is what makes a caller known. Rate limited (strict).',
  rateLimit: 'strict',
  request: { body: json(loginInput) },
  responses: {
    200: ok(
      'Signed in. The session cookie is set; send `csrfToken` as `X-CSRF-Token` on writes.',
      z.object({ user: userSchema, csrfToken: z.string() }),
    ),
    401: { description: 'The username or password is wrong.' },
    403: { description: 'The account is waiting for approval, or local accounts are off.' },
  },
});

export const logoutRoute = createRoute({
  method: 'post',
  path: '/auth/logout',
  permission: 'core.identity.session.manage',
  responses: { 204: { description: 'The session is over and its cookie is cleared.' } },
});

export const logoutAllRoute = createRoute({
  method: 'post',
  path: '/auth/logout-all',
  permission: 'core.identity.session.manage',
  responses: {
    200: ok('Every session of the caller is over.', z.object({ revoked: z.int().min(0) })),
  },
});

export const meRoute = createRoute({
  method: 'get',
  path: '/auth/me',
  permission: 'core.identity.me.read',
  responses: {
    200: ok(
      'The caller.',
      z.object({
        user: userSchema,
        roles: z.array(z.string()),
        csrfToken: z.string().nullable(),
      }),
    ),
  },
});

const pendingUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const listPendingRoute = createRoute({
  method: 'get',
  path: '/users/pending',
  permission: 'core.identity.user.list-pending',
  request: { query: paginationQuery() },
  responses: { 200: ok('Accounts waiting for approval.', listEnvelope(pendingUserSchema)) },
});

const adminUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  status: z.enum(['pending', 'active', 'rejected', 'deactivated']),
  createdAt: z.iso.datetime(),
});

export const listUsersRoute = createRoute({
  method: 'get',
  path: '/users',
  permission: 'core.identity.user.read',
  request: { query: userListQuery },
  responses: {
    200: ok(
      'The accounts, sorted by the chosen column and then by id. Without `status`: pending, active and deactivated ones; `rejected` lists the rejected (soft-deleted) ones.',
      listEnvelope(adminUserSchema),
    ),
  },
});

export const getUserRoute = createRoute({
  method: 'get',
  path: '/users/{id}',
  permission: 'core.identity.user.read',
  request: { params: idParam },
  responses: {
    200: ok('One account.', adminUserSchema),
    404: { description: 'No such user.' },
  },
});

export const listUserRolesRoute = createRoute({
  method: 'get',
  path: '/users/{id}/roles',
  permission: 'core.identity.user.read',
  request: { params: idParam, query: paginationQuery() },
  responses: {
    200: ok('The role keys the user holds, by key.', listEnvelope(z.object({ key: z.string() }))),
    403: { description: 'Needs `core.authz.role.read` too.' },
    404: { description: 'No such user.' },
  },
});

export const deactivateUserRoute = createRoute({
  method: 'post',
  path: '/users/{id}/deactivate',
  permission: 'core.identity.user.deactivate',
  audit: true,
  request: { params: idParam },
  responses: {
    200: ok('The account is deactivated and every one of its sessions has ended.', adminUserSchema),
    403: { description: 'Your own account.' },
    404: { description: 'No such user.' },
    409: { description: 'The account is not active, or it is the last Admin who can sign in.' },
  },
});

const decision = z.object({ id: z.string(), status: z.enum(['pending', 'active', 'rejected']) });

export const approveRoute = createRoute({
  method: 'post',
  path: '/users/{id}/approve',
  permission: 'core.identity.user.approve',
  audit: { body: true },
  request: {
    params: idParam,
    // Optional: `{}` or no body gives the role `user`.
    body: { required: false, content: { 'application/json': { schema: approveInput } } },
  },
  responses: {
    200: ok('The account is active and holds the role.', decision),
    403: {
      description:
        'Your own account, or the caller may not assign roles (`core.authz.role.assign`).',
    },
    404: { description: 'No such user, or no such role.' },
    409: { description: 'The account is not waiting for approval.' },
  },
});

export const rejectRoute = createRoute({
  method: 'post',
  path: '/users/{id}/reject',
  permission: 'core.identity.user.reject',
  audit: true,
  request: { params: idParam },
  responses: {
    200: ok('The account is rejected and soft-deleted.', decision),
    404: { description: 'No such user.' },
    409: { description: 'The account is not waiting for approval.' },
  },
});

export const firstAdminRoute = createRoute({
  method: 'post',
  path: '/bootstrap/first-admin',
  public: true,
  publicReason:
    'The first administrator of a fresh install has no account yet; the single-use token printed at start-up is the credential. Rate limited (strict).',
  rateLimit: 'strict',
  request: { body: json(redeemFirstRunInput) },
  responses: {
    201: ok(
      'The administrator was created. Sign in with the password.',
      z.object({ user: userSchema }),
    ),
    401: { description: 'The token is unknown, used or expired.' },
    409: { description: 'The username or email address is taken (the token is not used up).' },
  },
});

const startedSchema = z.object({ authorizationUrl: z.url() });

export const bootstrapStatusRoute = createRoute({
  method: 'get',
  path: '/bootstrap/status',
  public: true,
  publicReason:
    'The start page of a fresh install must know, before anybody can sign in, whether to offer the first-admin form. It answers one boolean, which is false for ever once an administrator exists; the form still needs the single-use token from the server console.',
  responses: {
    200: ok(
      'Whether the instance has no administrator yet.',
      z.object({ needsFirstAdmin: z.boolean() }),
    ),
  },
});

const publicProviderSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  /** SHA-256 of the icon file, shown at `GET /files/{hash}`; absent without an icon. */
  iconHash: z.string().optional(),
});

export const listOidcProvidersRoute = createRoute({
  method: 'get',
  path: '/auth/oidc/providers',
  public: true,
  publicReason:
    'The sign-in page lists the providers before anybody is signed in. It returns the id, the display name and the icon hash of each, which are what a button shows; the issuer and the client id stay private.',
  request: { query: paginationQuery() },
  responses: {
    200: ok(
      'The providers a person may sign in with, in the order of the setting.',
      listEnvelope(publicProviderSchema),
    ),
  },
});

export const oidcStartRoute = createRoute({
  method: 'post',
  path: '/auth/oidc/{provider}/start',
  public: true,
  publicReason:
    'Signing in is what makes a caller known. It only creates a login state and returns the provider URL. Rate limited (strict).',
  rateLimit: 'strict',
  request: { params: oidcProviderParam },
  responses: {
    200: ok('Send the browser to `authorizationUrl`. The login cookie is set.', startedSchema),
    404: { description: 'No such sign-in provider.' },
    502: { description: 'The provider could not be reached.' },
  },
});

export const oidcLinkRoute = createRoute({
  method: 'post',
  path: '/auth/oidc/{provider}/link',
  permission: 'core.identity.auth-method.link',
  rateLimit: 'strict',
  request: { params: oidcProviderParam },
  responses: {
    200: ok('Send the browser to `authorizationUrl`. The login cookie is set.', startedSchema),
    403: { description: 'The caller is using an access token, not a session.' },
    404: { description: 'No such sign-in provider.' },
    502: { description: 'The provider could not be reached.' },
  },
});

export const oidcCallbackRoute = createRoute({
  method: 'get',
  path: '/auth/oidc/{provider}/callback',
  public: true,
  publicReason:
    'The provider redirects the browser here to finish a login this browser started; the single-use state and the login cookie are the credential. It needs no session. Rate limited (strict).',
  rateLimit: 'strict',
  request: { params: oidcProviderParam, query: oidcCallbackQuery },
  responses: {
    302: {
      description:
        'A browser (it asks for `text/html`) is redirected when the sign-in failed too: to the sign-in page with `?error=<code>`, a fixed code (`account-pending`, `state-invalid`, `provider-denied`, `provider-unavailable`, `verification-failed`, `not-allowed`, `already-linked`), never text of the provider (ADR 0029). Signed in (or linked), with the session cookie set when signing in. When an account already holds the verified address the provider asserted, nothing is linked and nobody is signed in: the account holder is mailed a link, and the redirect goes to the sign-in page with `?notice=check-mail`, the same whether or not a mail was sent (ADR 0026).',
    },
    400: {
      description:
        'The state is unknown, expired, used or from another browser, or the provider refused. Answered to a client that does not ask for `text/html`; a browser is redirected (see 302).',
    },
    401: {
      description:
        'The id_token did not pass validation, or the account may not sign in. Not for a browser (see 302).',
    },
    403: { description: 'The account is waiting for approval.' },
    404: { description: 'No such sign-in provider.' },
    409: { description: 'The sign-in is already linked to an account.' },
    502: { description: 'The provider could not be reached or answered unexpectedly.' },
  },
});

export const confirmOidcLinkRoute = createRoute({
  method: 'post',
  path: '/account/oidc-link/confirm',
  permission: 'core.identity.auth-method.link',
  rateLimit: 'strict',
  request: { body: json(confirmOidcLinkInput) },
  responses: {
    200: ok(
      "The sign-in provider is linked to the caller's account.",
      z.object({ provider: z.string(), name: z.string() }),
    ),
    400: {
      description:
        'The link is not valid, has been used, has expired, or belongs to another account.',
    },
    401: {
      description:
        'Not signed in, or not recently: the problem type is `reauthentication-required` (ADR 0025).',
    },
    403: { description: 'The caller is using an access token, not a session.' },
    409: { description: 'The sign-in is already linked to an account.' },
    422: { description: 'The body is not valid.' },
  },
});

const LINK_400 = { description: 'The link is not valid, has been used or has expired.' };

export const resetRequestRoute = createRoute({
  method: 'post',
  path: '/auth/password-reset',
  public: true,
  publicReason:
    'Someone who forgot their password has no session. The answer is the same for every address, and the link goes to the mailbox only. Rate limited (strict), and each address is mailed a few times an hour.',
  rateLimit: 'strict',
  request: { body: json(resetRequestInput) },
  responses: {
    202: ok(
      'Accepted. Nothing says whether the address is known.',
      z.object({ accepted: z.literal(true) }),
    ),
    403: { description: 'Local accounts are turned off.' },
  },
});

export const resetConfirmRoute = createRoute({
  method: 'post',
  path: '/auth/password-reset/confirm',
  public: true,
  publicReason:
    'The single-use token from the mail is the credential, and the person has no session. Rate limited (strict).',
  rateLimit: 'strict',
  request: { body: json(resetConfirmInput) },
  responses: {
    204: { description: 'The password is set and every session of the account is over.' },
    400: LINK_400,
    403: { description: 'Local accounts are turned off.' },
  },
});

export const verifyEmailRoute = createRoute({
  method: 'post',
  path: '/auth/verify-email',
  public: true,
  publicReason:
    'The single-use token from the mail is the credential; the link may be opened on another device than the one signed in. Rate limited (strict).',
  rateLimit: 'strict',
  request: { body: json(verifyEmailInput) },
  responses: { 204: { description: 'The address is confirmed.' }, 400: LINK_400 },
});

export const changePasswordRoute = createRoute({
  method: 'post',
  path: '/account/password',
  permission: 'core.identity.password.change',
  rateLimit: 'strict', // checks the current password, and hashes the new one
  request: { body: json(changePasswordInput) },
  responses: {
    204: { description: 'The password is changed. Every session, this one included, is over.' },
    403: { description: 'The caller uses an access token, or local accounts are off.' },
    409: { description: 'The account has no password.' },
    422: { description: 'The current password is wrong, or the new one breaks the rules.' },
  },
});

export const resendVerificationRoute = createRoute({
  method: 'post',
  path: '/account/email/verification',
  permission: 'core.identity.email.verify',
  rateLimit: 'strict',
  responses: {
    202: ok(
      'A mail is on its way, if the address may still be mailed.',
      z.object({ accepted: z.literal(true) }),
    ),
    403: { description: 'The caller uses an access token, not a session.' },
    409: { description: 'The address is already confirmed, or the account has none.' },
  },
});

const profileSchema = z.object({
  username: z.string(),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  /** The address a change was asked for and nobody has confirmed yet. */
  pendingEmail: z.string().nullable(),
  /** Plain text. Show it as text, never as HTML. */
  bio: z.string().nullable(),
  /** SHA-256 of the avatar file, shown at `GET /files/{hash}`; `null` without an avatar. */
  avatarHash: z.string().nullable(),
});

export const getProfileRoute = createRoute({
  method: 'get',
  path: '/account/profile',
  permission: 'core.identity.profile.read',
  responses: {
    200: ok("The caller's own profile.", profileSchema),
    403: { description: 'The caller uses an access token, not a session.' },
  },
});

export const updateProfileRoute = createRoute({
  method: 'patch',
  path: '/account/profile',
  permission: 'core.identity.profile.update',
  request: { body: json(updateProfileInput) },
  responses: {
    200: ok(
      'The profile after the change. A new `email` is `pendingEmail` until the mailed link is opened.',
      profileSchema,
    ),
    403: { description: 'The caller uses an access token, not a session.' },
    422: {
      description: 'A field breaks the rules, an unknown field was sent, or nothing changes.',
    },
    429: { description: 'Too many address changes.' },
  },
});

const imageBody = {
  required: true as const,
  description:
    'The image as the request body (PNG, JPEG, WebP, GIF or SVG). Its `Content-Type` is ignored: the type is determined from the content, and the file is checked and rewritten before it is stored.',
  content: {
    'application/octet-stream': {
      schema: z.string().openapi({ type: 'string', format: 'binary' }),
    },
  },
};

export const setAvatarRoute = createRoute({
  method: 'put',
  path: '/account/avatar',
  permission: 'core.identity.avatar.update',
  rateLimit: 'strict',
  maxBodyBytes: MAX_UPLOAD_BYTES,
  request: { body: imageBody },
  responses: {
    200: ok('The profile with the new avatar.', profileSchema),
    403: { description: 'The caller uses an access token, not a session.' },
    413: { description: 'The body is larger than the upload ceiling.' },
    422: { description: 'The file is empty, too big, not a supported image, or damaged.' },
  },
});

export const removeAvatarRoute = createRoute({
  method: 'delete',
  path: '/account/avatar',
  permission: 'core.identity.avatar.update',
  responses: {
    200: ok('The profile without an avatar (also when there was none).', profileSchema),
    403: { description: 'The caller uses an access token, not a session.' },
  },
});

const REAUTH_401 = {
  description:
    'Not signed in. On a route that needs a recent authentication the problem type is `reauthentication-required`: confirm the password (`POST /account/reauthenticate`) or sign in again at the provider (`POST /account/reauthenticate/oidc/{provider}`), then repeat the request.',
};

const sessionSchema = z.object({
  id: z.string(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  /** The session of this request. */
  current: z.boolean(),
});

export const listSessionsRoute = createRoute({
  method: 'get',
  path: '/account/sessions',
  permission: 'core.identity.session.manage',
  request: { query: paginationQuery() },
  responses: {
    200: ok(
      "The caller's own sessions that are not over, newest first. Times and a marker for this session only: nothing about a device or an address is stored.",
      listEnvelope(sessionSchema),
    ),
    403: { description: 'The caller uses an access token, not a session.' },
  },
});

export const endSessionRoute = createRoute({
  method: 'delete',
  path: '/account/sessions/{id}',
  permission: 'core.identity.session.manage',
  audit: true,
  request: { params: idParam },
  responses: {
    204: {
      description:
        'The session is over. When it was the session of this request, its cookie is cleared.',
    },
    401: REAUTH_401,
    403: { description: 'The caller uses an access token, not a session.' },
    404: {
      description:
        "No such session of the caller. Another user's session id answers exactly like an unknown one.",
    },
  },
});

export const reauthenticateRoute = createRoute({
  method: 'post',
  path: '/account/reauthenticate',
  permission: 'core.identity.session.manage',
  rateLimit: 'strict', // checks the password
  audit: true,
  request: { body: json(reauthenticateInput) },
  responses: {
    204: { description: 'The session counts as freshly authenticated.' },
    401: REAUTH_401,
    403: { description: 'The caller uses an access token, not a session.' },
    409: { description: 'The account has no password: re-authenticate at the provider.' },
    422: { description: 'The password is wrong.' },
  },
});

export const reauthenticateOidcRoute = createRoute({
  method: 'post',
  path: '/account/reauthenticate/oidc/{provider}',
  permission: 'core.identity.session.manage',
  rateLimit: 'strict',
  audit: true,
  request: { params: oidcProviderParam },
  responses: {
    200: ok(
      "Send the browser to `authorizationUrl` (it asks for a login now, `prompt=login`, `max_age=0`). The login cookie is set. The provider's callback finishes it and sets the session's authentication time; it sends no new session cookie.",
      startedSchema,
    ),
    403: { description: 'The caller uses an access token, not a session.' },
    404: { description: 'No such provider, or the account has no sign-in at it.' },
    502: { description: 'The provider could not be reached.' },
  },
});

const revokedSchema = z.object({ revoked: z.int().min(0) });

export const revokeUserSessionsRoute = createRoute({
  method: 'post',
  path: '/users/{id}/sessions/revoke',
  permission: 'core.identity.session.manage-any',
  audit: true,
  request: { params: idParam },
  responses: {
    200: ok(
      'Every open session of the user is over. `revoked` is how many were open.',
      revokedSchema,
    ),
    404: { description: 'No such user.' },
  },
});

export const revokeAllSessionsRoute = createRoute({
  method: 'post',
  path: '/system/sessions/revoke-all',
  permission: 'core.identity.session.manage-any',
  audit: true,
  responses: {
    200: ok(
      "Every open session of every user is over, **except the caller's own**, so the administrator who does it is not locked out. `revoked` is how many were open.",
      revokedSchema,
    ),
  },
});

const roleSchema = z.object({
  key: z.string(),
  label: z.string(),
  system: z.boolean(),
  /** Admin lists every permission a loaded module declares. */
  permissions: z.array(z.string()),
});

export const listRolesRoute = createRoute({
  method: 'get',
  path: '/roles',
  permission: 'core.identity.role.read',
  request: { query: paginationQuery() },
  responses: {
    200: ok('The roles, by key.', listEnvelope(roleSchema)),
    403: { description: 'Needs `core.identity.role.read` and `core.authz.role.read`.' },
  },
});

export const assignRoleRoute = createRoute({
  method: 'post',
  path: '/users/{id}/roles',
  permission: 'core.identity.role.assign',
  audit: { body: true },
  request: { params: idParam, body: json(assignRoleInput) },
  responses: {
    200: ok(
      'The user holds the role. `changed` is false when they already did.',
      z.object({ id: z.string(), role: z.string(), changed: z.boolean() }),
    ),
    403: { description: 'Needs both role.assign permissions, or it is your own account.' },
    404: { description: 'No such user, or no such role.' },
  },
});

export const removeRoleRoute = createRoute({
  method: 'delete',
  path: '/users/{id}/roles/{role}',
  permission: 'core.identity.role.assign',
  audit: true,
  request: { params: roleParam },
  responses: {
    204: { description: 'The user does not hold the role (also when they never did).' },
    403: { description: 'Needs both role.assign permissions, or it is your own account.' },
    404: { description: 'No such user, or no such role.' },
    409: { description: 'The last Admin cannot be removed.' },
  },
});

const tokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  expiresAt: z.iso.datetime().nullable(),
  lastUsedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
// The only response that ever carries a secret: the one that creates or replaces a token.
const createdTokenSchema = tokenSchema.extend({ token: z.string() });

export const listTokensRoute = createRoute({
  method: 'get',
  path: '/tokens',
  permission: 'core.identity.token.read',
  request: { query: paginationQuery() },
  responses: {
    200: ok("The caller's access tokens, without their secrets.", listEnvelope(tokenSchema)),
    403: { description: 'The caller is using an access token, not a session.' },
  },
});

export const createTokenRoute = createRoute({
  method: 'post',
  path: '/tokens',
  permission: 'core.identity.token.manage',
  audit: true,
  rateLimit: 'strict', // each token costs an argon2id hash
  request: { body: json(createTokenInput) },
  responses: {
    201: ok('The token. `token` is shown this once.', createdTokenSchema),
    403: { description: 'The caller is using an access token, not a session.' },
    409: { description: 'The name is taken, or the caller has too many tokens.' },
  },
});

export const revokeTokenRoute = createRoute({
  method: 'delete',
  path: '/tokens/{id}',
  permission: 'core.identity.token.manage',
  audit: true,
  request: { params: idParam },
  responses: {
    204: { description: 'The token is revoked (also when it already was).' },
    403: { description: 'The caller is using an access token, not a session.' },
    404: { description: "No such token of the caller's." },
  },
});

export const rotateTokenRoute = createRoute({
  method: 'post',
  path: '/tokens/{id}/rotate',
  permission: 'core.identity.token.manage',
  audit: true,
  rateLimit: 'strict', // each token costs an argon2id hash
  request: { params: idParam, body: json(rotateTokenInput) },
  responses: {
    200: ok('The new token. The old one no longer works.', createdTokenSchema),
    403: { description: 'The caller is using an access token, not a session.' },
    404: { description: "No such token of the caller's." },
  },
});

export const listUserTokensRoute = createRoute({
  method: 'get',
  path: '/users/{id}/tokens',
  permission: 'core.identity.token.manage-any',
  request: { params: idParam, query: paginationQuery() },
  responses: {
    200: ok(
      "The user's open access tokens, without their secrets. A token is revoked with `DELETE /tokens/{id}`.",
      listEnvelope(tokenSchema),
    ),
    403: { description: 'The caller is using an access token, not a session.' },
    404: { description: 'No such user.' },
  },
});

const adminUserView = (found: AdminUser) => ({
  id: found.id,
  username: found.username,
  displayName: found.displayName,
  email: found.email,
  emailVerified: found.emailVerified,
  status: found.status,
  createdAt: found.createdAt.toISOString(),
});

const tokenView = (token: TokenInfo) => ({
  id: token.id,
  name: token.name,
  prefix: token.prefix,
  scopes: token.scopes,
  expiresAt: token.expiresAt?.toISOString() ?? null,
  lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
  createdAt: token.createdAt.toISOString(),
});
const createdTokenView = (created: CreatedToken) => ({
  ...tokenView(created),
  token: created.token,
});

const sessionView = (item: SessionSummary) => ({
  id: item.id,
  createdAt: item.createdAt.toISOString(),
  lastSeenAt: item.lastSeenAt.toISOString(),
  current: item.current,
});

const view = (user: {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  status: 'pending' | 'active' | 'rejected' | 'deactivated';
}) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  emailVerified: user.emailVerified,
  status: user.status,
});

export function registerIdentityRoutes(
  r: RouteRegistrar,
  {
    accounts,
    approval,
    bootstrap,
    oidc,
    oidcLink,
    profile,
    recovery,
    roles,
    sessionAdmin,
    tokens,
    userAdmin,
  }: IdentityRoutesServices,
) {
  r.internal(registerRoute, (async (c) => {
    // The same answer whether the account was created or the address was taken: nothing of the
    // new account is returned (register without revealing).
    await accounts.register(c.req.valid('json'));
    c.header('cache-control', 'no-store');
    return c.json({ accepted: true as const }, 202);
  }) satisfies RouteHandler<typeof registerRoute, AppEnv>);

  r.internal(loginRoute, (async (c) => {
    const result = await accounts.login(c.req.valid('json'), readSessionCookie(c), {
      clientIp: c.get('clientIp'),
    });
    writeSessionCookie(c, result.sessionId, result.expiresAt);
    c.header('cache-control', 'no-store');
    return c.json({ user: view(result.user), csrfToken: result.csrfToken }, 200);
  }) satisfies RouteHandler<typeof loginRoute, AppEnv>);

  r.internal(logoutRoute, (async (c) => {
    await accounts.logout(c.get('actor'), readSessionCookie(c));
    clearSessionCookie(c);
    return c.body(null, 204);
  }) satisfies RouteHandler<typeof logoutRoute, AppEnv>);

  r.internal(logoutAllRoute, (async (c) => {
    const revoked = await accounts.logoutAll(c.get('actor'));
    clearSessionCookie(c);
    return c.json({ revoked }, 200);
  }) satisfies RouteHandler<typeof logoutAllRoute, AppEnv>);

  r.internal(listSessionsRoute, (async (c) => {
    const query = c.req.valid('query');
    const { sessions, total } = await accounts.listSessions(c.get('actor'), query);
    c.header('cache-control', 'no-store');
    return c.json(paginate(query, total, sessions.map(sessionView)), 200);
  }) satisfies RouteHandler<typeof listSessionsRoute, AppEnv>);

  r.internal(endSessionRoute, (async (c) => {
    const { current } = await accounts.endSession(c.get('actor'), c.req.valid('param').id);
    if (current) clearSessionCookie(c);
    return c.body(null, 204);
  }) satisfies RouteHandler<typeof endSessionRoute, AppEnv>);

  r.internal(reauthenticateRoute, (async (c) => {
    await accounts.reauthenticate(c.get('actor'), c.req.valid('json'));
    c.header('cache-control', 'no-store');
    return c.body(null, 204);
  }) satisfies RouteHandler<typeof reauthenticateRoute, AppEnv>);

  r.internal(reauthenticateOidcRoute, (async (c) => {
    const started = await oidc.startReauthentication(c.get('actor'), c.req.valid('param').provider);
    writeLoginCookie(c, started.cookie.value, started.cookie.maxAgeSeconds);
    c.header('cache-control', 'no-store');
    return c.json({ authorizationUrl: started.authorizationUrl }, 200);
  }) satisfies RouteHandler<typeof reauthenticateOidcRoute, AppEnv>);

  r.internal(revokeUserSessionsRoute, (async (c) => {
    const revoked = await sessionAdmin.revokeUser(c.get('actor'), c.req.valid('param').id);
    return c.json({ revoked }, 200);
  }) satisfies RouteHandler<typeof revokeUserSessionsRoute, AppEnv>);

  r.internal(revokeAllSessionsRoute, (async (c) => {
    return c.json({ revoked: await sessionAdmin.revokeEverything(c.get('actor')) }, 200);
  }) satisfies RouteHandler<typeof revokeAllSessionsRoute, AppEnv>);

  r.internal(meRoute, (async (c) => {
    const { user, roles, csrfToken } = await accounts.me(c.get('actor'), readSessionCookie(c));
    c.header('cache-control', 'no-store');
    return c.json({ user: view(user), roles, csrfToken }, 200);
  }) satisfies RouteHandler<typeof meRoute, AppEnv>);

  r.internal(listPendingRoute, (async (c) => {
    const query = c.req.valid('query');
    const { users, total } = await approval.listPending(c.get('actor'), query);
    return c.json(
      paginate(
        query,
        total,
        users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
      ),
      200,
    );
  }) satisfies RouteHandler<typeof listPendingRoute, AppEnv>);

  r.internal(listUsersRoute, (async (c) => {
    const { dir, ...query } = c.req.valid('query');
    const { users, total } = await userAdmin.list(c.get('actor'), { ...query, direction: dir });
    return c.json(paginate(query, total, users.map(adminUserView)), 200);
  }) satisfies RouteHandler<typeof listUsersRoute, AppEnv>);

  // After `/users/pending` above: that path is not an id.
  r.internal(getUserRoute, (async (c) => {
    const found = await userAdmin.get(c.get('actor'), c.req.valid('param').id);
    return c.json(adminUserView(found), 200);
  }) satisfies RouteHandler<typeof getUserRoute, AppEnv>);

  r.internal(listUserRolesRoute, (async (c) => {
    const query = c.req.valid('query');
    const keys = await roles.rolesOf(c.get('actor'), c.req.valid('param').id);
    const page = keys.slice(query.page * query.pageSize, (query.page + 1) * query.pageSize);
    return c.json(
      paginate(
        query,
        keys.length,
        page.map((key) => ({ key })),
      ),
      200,
    );
  }) satisfies RouteHandler<typeof listUserRolesRoute, AppEnv>);

  r.internal(listUserTokensRoute, (async (c) => {
    const query = c.req.valid('query');
    const result = await tokens.listFor(c.get('actor'), c.req.valid('param').id, query);
    c.header('cache-control', 'no-store');
    return c.json(paginate(query, result.total, result.tokens.map(tokenView)), 200);
  }) satisfies RouteHandler<typeof listUserTokensRoute, AppEnv>);

  r.internal(deactivateUserRoute, (async (c) => {
    const deactivated = await userAdmin.deactivate(c.get('actor'), c.req.valid('param').id);
    return c.json(adminUserView(deactivated), 200);
  }) satisfies RouteHandler<typeof deactivateUserRoute, AppEnv>);

  r.internal(approveRoute, (async (c) => {
    const { id } = c.req.valid('param');
    // The body is optional; `valid('json')` is `{}` for none.
    const body = c.req.valid('json') as { role?: string } | undefined;
    const status = await approval.approve(c.get('actor'), id, { role: body?.role });
    return c.json({ id, status }, 200);
  }) satisfies RouteHandler<typeof approveRoute, AppEnv>);

  r.internal(rejectRoute, (async (c) => {
    const { id } = c.req.valid('param');
    return c.json({ id, status: await approval.reject(c.get('actor'), id) }, 200);
  }) satisfies RouteHandler<typeof rejectRoute, AppEnv>);

  r.internal(listRolesRoute, (async (c) => {
    const query = c.req.valid('query');
    const all = await roles.list(c.get('actor'));
    const page = all.slice(query.page * query.pageSize, (query.page + 1) * query.pageSize);
    return c.json(paginate(query, all.length, page), 200);
  }) satisfies RouteHandler<typeof listRolesRoute, AppEnv>);

  r.internal(assignRoleRoute, (async (c) => {
    const { id } = c.req.valid('param');
    const { role } = c.req.valid('json');
    const changed = await roles.assign(c.get('actor'), id, role);
    return c.json({ id, role, changed }, 200);
  }) satisfies RouteHandler<typeof assignRoleRoute, AppEnv>);

  r.internal(removeRoleRoute, (async (c) => {
    const { id, role } = c.req.valid('param');
    await roles.remove(c.get('actor'), id, role);
    return c.body(null, 204);
  }) satisfies RouteHandler<typeof removeRoleRoute, AppEnv>);

  r.internal(firstAdminRoute, (async (c) => {
    const admin = await bootstrap.redeemFirstRunToken(c.req.valid('json'));
    c.header('cache-control', 'no-store');
    return c.json({ user: view(admin) }, 201);
  }) satisfies RouteHandler<typeof firstAdminRoute, AppEnv>);

  r.internal(bootstrapStatusRoute, (async (c) => {
    c.header('cache-control', 'no-store');
    return c.json({ needsFirstAdmin: await bootstrap.needsFirstAdmin() }, 200);
  }) satisfies RouteHandler<typeof bootstrapStatusRoute, AppEnv>);

  r.internal(listOidcProvidersRoute, (async (c) => {
    const query = c.req.valid('query');
    const all = await oidc.listProviders();
    const page = all.slice(query.page * query.pageSize, (query.page + 1) * query.pageSize);
    c.header('cache-control', 'no-store');
    return c.json(paginate(query, all.length, page), 200);
  }) satisfies RouteHandler<typeof listOidcProvidersRoute, AppEnv>);

  r.internal(oidcStartRoute, (async (c) => {
    const started = await oidc.start(c.req.valid('param').provider);
    writeLoginCookie(c, started.cookie.value, started.cookie.maxAgeSeconds);
    c.header('cache-control', 'no-store');
    return c.json({ authorizationUrl: started.authorizationUrl }, 200);
  }) satisfies RouteHandler<typeof oidcStartRoute, AppEnv>);

  r.internal(oidcLinkRoute, (async (c) => {
    const started = await oidc.startLink(c.get('actor'), c.req.valid('param').provider);
    writeLoginCookie(c, started.cookie.value, started.cookie.maxAgeSeconds);
    c.header('cache-control', 'no-store');
    return c.json({ authorizationUrl: started.authorizationUrl }, 200);
  }) satisfies RouteHandler<typeof oidcLinkRoute, AppEnv>);

  r.internal(oidcCallbackRoute, (async (c) => {
    const query = c.req.valid('query');
    // The login cookie is spent whatever the outcome; a failed callback cannot be retried.
    const verifier = readLoginCookie(c);
    clearLoginCookie(c);
    c.header('cache-control', 'no-store');
    c.header('referrer-policy', 'no-referrer');
    let done;
    try {
      done = await oidc.complete({
        providerId: c.req.valid('param').provider,
        state: query.state,
        code: query.code,
        error: query.error,
        verifier,
        previousSessionId: readSessionCookie(c),
      });
    } catch (error) {
      // A browser that came from the provider is sent to the sign-in page with a fixed code (ADR 0029);
      // anything else (a script, a test client) keeps the problem answer. Nothing but the code leaves.
      const code = loginErrorCode(error, query.error !== undefined);
      if (code === undefined || !(c.req.header('accept') ?? '').includes('text/html')) throw error;
      return c.redirect(oidc.loginErrorLanding(code), 302);
    }
    // A re-authentication changes the session in the database; the browser keeps its cookie.
    if (done.kind === 'login') writeSessionCookie(c, done.sessionId, done.expiresAt);
    // Always a fixed page: no caller-supplied target, so no open redirect. A sign-in that found an
    // account holding the address ends on the sign-in page with a notice, signed in as nobody.
    return c.redirect(done.kind === 'check-mail' ? oidc.checkMailLanding : oidc.landing, 302);
  }) satisfies RouteHandler<typeof oidcCallbackRoute, AppEnv>);

  r.internal(confirmOidcLinkRoute, (async (c) => {
    const linked = await oidcLink.confirm(c.get('actor'), c.req.valid('json'));
    c.header('cache-control', 'no-store');
    return c.json(linked, 200);
  }) satisfies RouteHandler<typeof confirmOidcLinkRoute, AppEnv>);

  r.internal(listTokensRoute, (async (c) => {
    const query = c.req.valid('query');
    const result = await tokens.list(c.get('actor'), query);
    return c.json(paginate(query, result.total, result.tokens.map(tokenView)), 200);
  }) satisfies RouteHandler<typeof listTokensRoute, AppEnv>);

  r.internal(createTokenRoute, (async (c) => {
    const created = await tokens.create(c.get('actor'), c.req.valid('json'));
    c.header('cache-control', 'no-store');
    return c.json(createdTokenView(created), 201);
  }) satisfies RouteHandler<typeof createTokenRoute, AppEnv>);

  r.internal(revokeTokenRoute, (async (c) => {
    await tokens.revoke(c.get('actor'), c.req.valid('param').id);
    return c.body(null, 204);
  }) satisfies RouteHandler<typeof revokeTokenRoute, AppEnv>);

  r.internal(rotateTokenRoute, (async (c) => {
    const rotated = await tokens.rotate(
      c.get('actor'),
      c.req.valid('param').id,
      c.req.valid('json'),
    );
    c.header('cache-control', 'no-store');
    return c.json(createdTokenView(rotated), 200);
  }) satisfies RouteHandler<typeof rotateTokenRoute, AppEnv>);

  r.internal(resetRequestRoute, (async (c) => {
    await recovery.requestReset(c.req.valid('json'));
    c.header('cache-control', 'no-store');
    return c.json({ accepted: true as const }, 202);
  }) satisfies RouteHandler<typeof resetRequestRoute, AppEnv>);

  r.internal(resetConfirmRoute, (async (c) => {
    await recovery.confirmReset(c.req.valid('json'));
    c.header('cache-control', 'no-store');
    return c.body(null, 204);
  }) satisfies RouteHandler<typeof resetConfirmRoute, AppEnv>);

  r.internal(verifyEmailRoute, (async (c) => {
    await recovery.confirmEmail(c.req.valid('json'));
    c.header('cache-control', 'no-store');
    return c.body(null, 204);
  }) satisfies RouteHandler<typeof verifyEmailRoute, AppEnv>);

  r.internal(changePasswordRoute, (async (c) => {
    await recovery.changePassword(c.get('actor'), c.req.valid('json'));
    // Every session is over, this one too: the browser's cookie goes with it.
    clearSessionCookie(c);
    c.header('cache-control', 'no-store');
    return c.body(null, 204);
  }) satisfies RouteHandler<typeof changePasswordRoute, AppEnv>);

  r.internal(resendVerificationRoute, (async (c) => {
    await recovery.resendVerification(c.get('actor'));
    return c.json({ accepted: true as const }, 202);
  }) satisfies RouteHandler<typeof resendVerificationRoute, AppEnv>);

  r.internal(getProfileRoute, (async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await profile.get(c.get('actor')), 200);
  }) satisfies RouteHandler<typeof getProfileRoute, AppEnv>);

  r.internal(updateProfileRoute, (async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await profile.update(c.get('actor'), c.req.valid('json')), 200);
  }) satisfies RouteHandler<typeof updateProfileRoute, AppEnv>);

  r.internal(setAvatarRoute, (async (c) => {
    // The body is capped by the route (`maxBodyBytes`); the service checks the caller and the file.
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    c.header('cache-control', 'no-store');
    return c.json(await profile.setAvatar(c.get('actor'), bytes), 200);
  }) satisfies RouteHandler<typeof setAvatarRoute, AppEnv>);

  r.internal(removeAvatarRoute, (async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await profile.removeAvatar(c.get('actor')), 200);
  }) satisfies RouteHandler<typeof removeAvatarRoute, AppEnv>);
}
