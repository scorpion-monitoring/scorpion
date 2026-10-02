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
import { clearSessionCookie, readSessionCookie, writeSessionCookie } from './cookie.ts';
import type { AccountService } from './service/accounts.ts';
import type { ApprovalService } from './service/approval.ts';
import type { CreatedToken, TokenInfo, TokenService } from './service/tokens.ts';
import { createTokenInput, loginInput, registerInput, rotateTokenInput } from './validation.ts';

export interface IdentityRoutesServices {
  accounts: AccountService;
  approval: ApprovalService;
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
  { accounts, approval, tokens }: IdentityRoutesServices,
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
}
