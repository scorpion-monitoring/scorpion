// The HTTP routes of core.settings. Thin: Zod parses, one service call, the result is mapped.
// All of them are internal routes (`/api/internal/...`) for the admin UI. No response carries the
// value of a secret.
import {
  createRoute,
  listEnvelope,
  pageOffset,
  paginate,
  paginationQuery,
  z,
  type AppEnv,
  type RouteHandler,
} from '@scorpion/contracts';
import type { RouteRegistrar } from '@scorpion/kernel';
import type { PreferencesService, PreferenceView } from './service/preferences.ts';
import {
  PERMISSION_PREFERENCE_READ,
  PERMISSION_PREFERENCE_WRITE,
  PERMISSION_SECRET_WRITE,
  PERMISSION_SETTINGS_READ,
  PERMISSION_SETTINGS_WRITE,
} from './service/permissions.ts';
import {
  MAX_SECRET_LENGTH,
  type SecretStatus,
  type SecretsAdminService,
} from './service/secrets.ts';
import type { SettingsAdminService, SettingsView } from './service/settings.ts';

export interface SettingsRoutesServices {
  settings: SettingsAdminService;
  secrets: SecretsAdminService;
  preferences: PreferencesService;
}

const json = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { 'application/json': { schema } },
});
const ok = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: { 'application/json': { schema } },
});

// The module id is a dotted lower-case id; the bound keeps a path parameter from being a payload.
const moduleParam = z.object({ module: z.string().min(1).max(100) });
const secretParam = z.object({ name: z.string().min(1).max(200) });
const preferenceParam = z.object({ key: z.string().min(1).max(200) });

const settingsSchema = z.object({
  module: z.string(),
  version: z.number().int(),
  values: z.record(z.string(), z.unknown()),
  updatedAt: z.iso.datetime().nullable(),
  updatedBy: z.string().nullable(),
});

/** A body of settings: a version to compare and the whole object to store. Size is bounded by the body limit. */
const updateSettingsInput = z.strictObject({
  version: z.number().int().min(0).max(2_147_483_647),
  values: z.record(z.string().max(100), z.unknown()),
});

const secretSchema = z.object({
  name: z.string(),
  set: z.literal(true),
  updatedAt: z.iso.datetime(),
});
const setSecretInput = z.strictObject({ value: z.string().min(1).max(MAX_SECRET_LENGTH) });

const preferenceSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  updatedAt: z.iso.datetime(),
});
const setPreferenceInput = z.strictObject({ value: z.unknown() });

export const listSettingsRoute = createRoute({
  method: 'get',
  path: '/settings',
  permission: PERMISSION_SETTINGS_READ,
  request: { query: paginationQuery() },
  responses: {
    200: ok(
      'The settings of every module that has some, with defaults applied. Secrets are never included.',
      listEnvelope(settingsSchema),
    ),
  },
});

export const getSettingsRoute = createRoute({
  method: 'get',
  path: '/settings/{module}',
  permission: PERMISSION_SETTINGS_READ,
  request: { params: moduleParam },
  responses: {
    200: ok('The settings of one module and the version to send back when saving.', settingsSchema),
    404: { description: 'No such module, or it has no settings.' },
  },
});

export const settingsSchemaRoute = createRoute({
  method: 'get',
  path: '/settings/{module}/schema',
  permission: PERMISSION_SETTINGS_READ,
  request: { params: moduleParam },
  responses: {
    200: ok(
      'The JSON Schema of the module’s settings, for the admin form.',
      z.record(z.string(), z.unknown()),
    ),
    404: { description: 'No such module, or it has no settings.' },
  },
});

export const updateSettingsRoute = createRoute({
  method: 'put',
  path: '/settings/{module}',
  permission: PERMISSION_SETTINGS_WRITE,
  request: { params: moduleParam, body: json(updateSettingsInput) },
  responses: {
    200: ok('The saved settings.', settingsSchema),
    404: { description: 'No such module, or it has no settings.' },
    409: { description: 'The settings changed since `version` was read.' },
  },
});

export const listSecretsRoute = createRoute({
  method: 'get',
  path: '/secrets',
  permission: PERMISSION_SETTINGS_READ,
  request: { query: paginationQuery() },
  responses: {
    200: ok('The names of the stored secrets. Never a value.', listEnvelope(secretSchema)),
  },
});

export const setSecretRoute = createRoute({
  method: 'put',
  path: '/secrets/{name}',
  permission: PERMISSION_SECRET_WRITE,
  rateLimit: 'strict',
  request: { params: secretParam, body: json(setSecretInput) },
  responses: {
    200: ok(
      'The secret is stored. The value is not returned and cannot be read back.',
      secretSchema,
    ),
  },
});

export const removeSecretRoute = createRoute({
  method: 'delete',
  path: '/secrets/{name}',
  permission: PERMISSION_SECRET_WRITE,
  request: { params: secretParam },
  responses: {
    204: { description: 'The secret is removed.' },
    404: { description: 'There is no such secret.' },
  },
});

export const listPreferencesRoute = createRoute({
  method: 'get',
  path: '/preferences',
  permission: PERMISSION_PREFERENCE_READ,
  request: { query: paginationQuery() },
  responses: { 200: ok('The caller’s own stored preferences.', listEnvelope(preferenceSchema)) },
});

export const setPreferenceRoute = createRoute({
  method: 'put',
  path: '/preferences/{key}',
  permission: PERMISSION_PREFERENCE_WRITE,
  request: { params: preferenceParam, body: json(setPreferenceInput) },
  responses: {
    200: ok('The caller’s preference is stored.', preferenceSchema),
    404: { description: 'No module registered such a preference.' },
  },
});

export const removePreferenceRoute = createRoute({
  method: 'delete',
  path: '/preferences/{key}',
  permission: PERMISSION_PREFERENCE_WRITE,
  request: { params: preferenceParam },
  responses: {
    204: { description: 'The preference is back to its default (also when it was never set).' },
    404: { description: 'No module registered such a preference.' },
  },
});

const settingsView = (view: SettingsView) => ({
  module: view.module,
  version: view.version,
  values: view.values as Record<string, unknown>,
  updatedAt: view.updatedAt?.toISOString() ?? null,
  updatedBy: view.updatedBy,
});
const secretView = (secret: SecretStatus) => ({
  name: secret.name,
  set: secret.set,
  updatedAt: secret.updatedAt.toISOString(),
});
const preferenceView = (preference: PreferenceView) => ({
  key: preference.key,
  value: preference.value,
  updatedAt: preference.updatedAt.toISOString(),
});

export function registerSettingsRoutes(
  r: RouteRegistrar,
  { settings, secrets, preferences }: SettingsRoutesServices,
) {
  r.internal(listSettingsRoute, (async (c) => {
    const query = c.req.valid('query');
    const all = await settings.list(c.get('actor'));
    const page = all.slice(pageOffset(query), pageOffset(query) + query.pageSize);
    return c.json(paginate(query, all.length, page.map(settingsView)), 200);
  }) satisfies RouteHandler<typeof listSettingsRoute, AppEnv>);

  r.internal(getSettingsRoute, (async (c) => {
    const view = await settings.get(c.get('actor'), c.req.valid('param').module);
    return c.json(settingsView(view), 200);
  }) satisfies RouteHandler<typeof getSettingsRoute, AppEnv>);

  r.internal(settingsSchemaRoute, (async (c) => {
    return c.json(await settings.jsonSchema(c.get('actor'), c.req.valid('param').module), 200);
  }) satisfies RouteHandler<typeof settingsSchemaRoute, AppEnv>);

  r.internal(updateSettingsRoute, (async (c) => {
    const view = await settings.update(
      c.get('actor'),
      c.req.valid('param').module,
      c.req.valid('json'),
    );
    return c.json(settingsView(view), 200);
  }) satisfies RouteHandler<typeof updateSettingsRoute, AppEnv>);

  r.internal(listSecretsRoute, (async (c) => {
    const query = c.req.valid('query');
    const all = await secrets.list(c.get('actor'));
    const page = all.slice(pageOffset(query), pageOffset(query) + query.pageSize);
    return c.json(paginate(query, all.length, page.map(secretView)), 200);
  }) satisfies RouteHandler<typeof listSecretsRoute, AppEnv>);

  r.internal(setSecretRoute, (async (c) => {
    const stored = await secrets.set(
      c.get('actor'),
      c.req.valid('param').name,
      c.req.valid('json').value,
    );
    c.header('cache-control', 'no-store');
    return c.json(secretView(stored), 200);
  }) satisfies RouteHandler<typeof setSecretRoute, AppEnv>);

  r.internal(removeSecretRoute, (async (c) => {
    await secrets.remove(c.get('actor'), c.req.valid('param').name);
    return c.body(null, 204);
  }) satisfies RouteHandler<typeof removeSecretRoute, AppEnv>);

  r.internal(listPreferencesRoute, (async (c) => {
    const query = c.req.valid('query');
    const all = await preferences.list(c.get('actor'));
    const page = all.slice(pageOffset(query), pageOffset(query) + query.pageSize);
    return c.json(paginate(query, all.length, page.map(preferenceView)), 200);
  }) satisfies RouteHandler<typeof listPreferencesRoute, AppEnv>);

  r.internal(setPreferenceRoute, (async (c) => {
    const stored = await preferences.set(
      c.get('actor'),
      c.req.valid('param').key,
      c.req.valid('json').value,
    );
    return c.json(preferenceView(stored), 200);
  }) satisfies RouteHandler<typeof setPreferenceRoute, AppEnv>);

  r.internal(removePreferenceRoute, (async (c) => {
    await preferences.remove(c.get('actor'), c.req.valid('param').key);
    return c.body(null, 204);
  }) satisfies RouteHandler<typeof removePreferenceRoute, AppEnv>);
}
