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
import type { OidcService } from './service/oidc.ts';
import type { ProfileService } from './service/profile.ts';
import type { RecoveryService } from './service/recovery.ts';
import type { CreatedToken, TokenInfo, TokenService } from './service/tokens.ts';
import {
  changePasswordInput,
  createTokenInput,
  loginInput,
  oidcCallbackQuery,
  oidcProviderParam,
  redeemFirstRunInput,
  registerInput,
  resetConfirmInput,
  resetRequestInput,
  rotateTokenInput,
  updateProfileInput,
  verifyEmailInput,
} from './validation.ts';

export interface IdentityRoutesServices {
  accounts: AccountService;
  approval: ApprovalService;
  bootstrap: BootstrapService;
  oidc: OidcService;
  profile: ProfileService;
  recovery: RecoveryService;
  tokens: TokenService;
}

const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  status: z.enum(['pending', 'active', 'rejected']),
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
    201: ok('The account was created.', z.object({ user: userSchema })),
    403: { description: 'Local accounts are turned off.' },
    409: { description: 'The username or email address is taken.' },
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

const decision = z.object({ id: z.string(), status: z.enum(['pending', 'active', 'rejected']) });

export const approveRoute = createRoute({
  method: 'post',
  path: '/users/{id}/approve',
  permission: 'core.identity.user.approve',
  request: { params: idParam },
  responses: {
    200: ok('The account is active.', decision),
    404: { description: 'No such user.' },
    409: { description: 'The account is not waiting for approval.' },
  },
});

export const rejectRoute = createRoute({
  method: 'post',
  path: '/users/{id}/reject',
  permission: 'core.identity.user.reject',
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
    302: { description: 'Signed in (or linked). The session cookie is set when signing in.' },
    400: {
      description:
        'The state is unknown, expired, used or from another browser, or the provider refused.',
    },
    401: { description: 'The id_token did not pass validation, or the account may not sign in.' },
    403: { description: 'The account is waiting for approval.' },
    404: { description: 'No such sign-in provider.' },
    409: {
      description:
        'The address belongs to an account that has not confirmed it, or the sign-in is already linked.',
    },
    502: { description: 'The provider could not be reached or answered unexpectedly.' },
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
  rateLimit: 'strict', // each token costs an argon2id hash
  request: { params: idParam, body: json(rotateTokenInput) },
  responses: {
    200: ok('The new token. The old one no longer works.', createdTokenSchema),
    403: { description: 'The caller is using an access token, not a session.' },
    404: { description: "No such token of the caller's." },
  },
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

const view = (user: {
  id: string;
  username: string;
  email: string | null;
  emailVerified: boolean;
  status: 'pending' | 'active' | 'rejected';
}) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  emailVerified: user.emailVerified,
  status: user.status,
});

export function registerIdentityRoutes(
  r: RouteRegistrar,
  { accounts, approval, bootstrap, oidc, profile, recovery, tokens }: IdentityRoutesServices,
) {
  r.internal(registerRoute, (async (c) => {
    const user = await accounts.register(c.req.valid('json'));
    return c.json({ user: view(user) }, 201);
  }) satisfies RouteHandler<typeof registerRoute, AppEnv>);

  r.internal(loginRoute, (async (c) => {
    const result = await accounts.login(c.req.valid('json'), readSessionCookie(c));
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

  r.internal(meRoute, (async (c) => {
    const { user, csrfToken } = await accounts.me(c.get('actor'), readSessionCookie(c));
    c.header('cache-control', 'no-store');
    return c.json({ user: view(user), roles: [], csrfToken }, 200);
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

  r.internal(approveRoute, (async (c) => {
    const { id } = c.req.valid('param');
    return c.json({ id, status: await approval.approve(c.get('actor'), id) }, 200);
  }) satisfies RouteHandler<typeof approveRoute, AppEnv>);

  r.internal(rejectRoute, (async (c) => {
    const { id } = c.req.valid('param');
    return c.json({ id, status: await approval.reject(c.get('actor'), id) }, 200);
  }) satisfies RouteHandler<typeof rejectRoute, AppEnv>);

  r.internal(firstAdminRoute, (async (c) => {
    const admin = await bootstrap.redeemFirstRunToken(c.req.valid('json'));
    c.header('cache-control', 'no-store');
    return c.json({ user: view(admin) }, 201);
  }) satisfies RouteHandler<typeof firstAdminRoute, AppEnv>);

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
    const done = await oidc.complete({
      providerId: c.req.valid('param').provider,
      state: query.state,
      code: query.code,
      error: query.error,
      verifier,
      previousSessionId: readSessionCookie(c),
    });
    if (done.kind === 'login') writeSessionCookie(c, done.sessionId, done.expiresAt);
    // Always the application root: no caller-supplied target, so no open redirect.
    return c.redirect(oidc.landing, 302);
  }) satisfies RouteHandler<typeof oidcCallbackRoute, AppEnv>);

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
}
