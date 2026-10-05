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
import { NotFound } from '@scorpion/contracts';
import { LEGAL_PAGES, type BrandingService } from './service/branding.ts';
import type { PreferencesService, PreferenceView } from './service/preferences.ts';
import {
  PERMISSION_PREFERENCE_READ,
  PERMISSION_PREFERENCE_WRITE,
  PERMISSION_SECRET_WRITE,
  PERMISSION_SETTINGS_READ,
  PERMISSION_SETTINGS_WRITE,
  PERMISSION_VOCABULARY_READ,
  PERMISSION_VOCABULARY_WRITE,
} from './service/permissions.ts';
import {
  MAX_SECRET_LENGTH,
  type SecretStatus,
  type SecretsAdminService,
} from './service/secrets.ts';
import type { SettingsAdminService, SettingsView } from './service/settings.ts';
import { labelsSchema, termKeySchema } from './service/vocabularies.ts';
import type { TermView, VocabularyAdminService, VocabularyView } from './service/vocabularies.ts';

export interface SettingsRoutesServices {
  settings: SettingsAdminService;
  secrets: SecretsAdminService;
  preferences: PreferencesService;
  vocabularies: VocabularyAdminService;
  branding: BrandingService;
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

const vocabularyParam = z.object({ vocabulary: z.string().min(1).max(100) });
const termParam = vocabularyParam.extend({ key: z.string().min(1).max(64) });

const vocabularySchema = z.object({
  id: z.string(),
  description: z.string(),
  terms: z.number().int(),
  activeTerms: z.number().int(),
});
const termSchema = z.object({
  key: z.string(),
  labels: z.record(z.string(), z.string()),
  label: z.string().describe('The label for the requested locale, `en` by default.'),
  sortOrder: z.number().int(),
  active: z.boolean(),
  seeded: z.boolean().describe('Declared by a module; such a term is deactivated, never deleted.'),
});
const termsQuery = paginationQuery({ defaultPageSize: 100, maxPageSize: 500 }).extend({
  includeInactive: z
    .stringbool()
    .optional()
    .describe('Also list deactivated terms (needs `core.settings.vocabulary.write`).'),
  locale: z.string().max(35).optional().describe('The locale of `label`. Default `en`.'),
});
const createTermInput = z.strictObject({
  key: termKeySchema,
  labels: labelsSchema,
  sortOrder: z.number().int().optional(),
});
const updateTermInput = z.strictObject({
  labels: labelsSchema.optional(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});

const brandingSchema = z.object({
  productName: z.string(),
  instanceName: z.string(),
  contactEmail: z.string().nullable(),
  imprintUrl: z.string().nullable(),
  logos: z.object({ light: z.string().nullable(), dark: z.string().nullable() }),
  legalPages: z.array(z.enum(LEGAL_PAGES)),
});
const legalSchema = z.object({
  page: z.enum(LEGAL_PAGES),
  title: z.string(),
  html: z.string().describe('Sanitised HTML rendered from the Markdown text.'),
});

export const listVocabulariesRoute = createRoute({
  method: 'get',
  path: '/vocabularies',
  permission: PERMISSION_VOCABULARY_READ,
  request: { query: paginationQuery() },
  responses: {
    200: ok(
      'The vocabularies that loaded modules declare, with their term counts.',
      listEnvelope(vocabularySchema),
    ),
  },
});

export const listTermsRoute = createRoute({
  method: 'get',
  path: '/vocabularies/{vocabulary}/terms',
  permission: PERMISSION_VOCABULARY_READ,
  request: { params: vocabularyParam, query: termsQuery },
  responses: {
    200: ok('The terms in order: sort order, then key.', listEnvelope(termSchema)),
    404: { description: 'No loaded module declares this vocabulary.' },
  },
});

export const createTermRoute = createRoute({
  method: 'post',
  path: '/vocabularies/{vocabulary}/terms',
  permission: PERMISSION_VOCABULARY_WRITE,
  request: { params: vocabularyParam, body: json(createTermInput) },
  responses: {
    201: ok('The term was added.', termSchema),
    404: { description: 'No loaded module declares this vocabulary.' },
    409: { description: 'The vocabulary has a term with this key (also a deactivated one).' },
  },
});

export const updateTermRoute = createRoute({
  method: 'patch',
  path: '/vocabularies/{vocabulary}/terms/{key}',
  permission: PERMISSION_VOCABULARY_WRITE,
  request: { params: termParam, body: json(updateTermInput) },
  responses: {
    200: ok('The term after the change.', termSchema),
    404: { description: 'No such vocabulary or term.' },
  },
});

export const removeTermRoute = createRoute({
  method: 'delete',
  path: '/vocabularies/{vocabulary}/terms/{key}',
  permission: PERMISSION_VOCABULARY_WRITE,
  request: { params: termParam },
  responses: {
    200: ok(
      'A term a module declared, or one that is in use, is deactivated (`outcome: deactivated`, with the term); any other is deleted (`outcome: deleted`).',
      z.object({ outcome: z.enum(['deleted', 'deactivated']), term: termSchema.nullable() }),
    ),
    404: { description: 'No such vocabulary or term.' },
  },
});

export const brandingRoute = createRoute({
  method: 'get',
  path: '/branding',
  public: true,
  publicReason:
    'The sign-in page and every header show the instance name and logo to people who are not signed in; nothing here is private (the sender address is not included).',
  responses: { 200: ok('How the instance presents itself.', brandingSchema) },
});

export const legalRoute = createRoute({
  method: 'get',
  path: '/legal/{page}',
  public: true,
  publicReason:
    'Terms, privacy policy and imprint must be readable without signing in (FEATURES 3.2, the legacy app hid them behind login).',
  request: { params: z.object({ page: z.enum(LEGAL_PAGES) }) },
  responses: {
    200: ok('The page, rendered from Markdown on the server and sanitised.', legalSchema),
    404: { description: 'No text was written for this page.' },
  },
});

const termView = (term: TermView) => ({
  key: term.key,
  labels: term.labels,
  label: term.label,
  sortOrder: term.sortOrder,
  active: term.active,
  seeded: term.seeded,
});
const vocabularyView = (vocabulary: VocabularyView) => ({ ...vocabulary });

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
  { settings, secrets, preferences, vocabularies, branding }: SettingsRoutesServices,
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

  r.internal(listVocabulariesRoute, (async (c) => {
    const query = c.req.valid('query');
    const all = await vocabularies.list(c.get('actor'));
    const page = all.slice(pageOffset(query), pageOffset(query) + query.pageSize);
    return c.json(paginate(query, all.length, page.map(vocabularyView)), 200);
  }) satisfies RouteHandler<typeof listVocabulariesRoute, AppEnv>);

  r.internal(listTermsRoute, (async (c) => {
    const { includeInactive, locale, ...query } = c.req.valid('query');
    const all = await vocabularies.listTerms(c.get('actor'), c.req.valid('param').vocabulary, {
      includeInactive,
      locale,
    });
    const page = all.slice(pageOffset(query), pageOffset(query) + query.pageSize);
    return c.json(paginate(query, all.length, page.map(termView)), 200);
  }) satisfies RouteHandler<typeof listTermsRoute, AppEnv>);

  r.internal(createTermRoute, (async (c) => {
    const term = await vocabularies.createTerm(
      c.get('actor'),
      c.req.valid('param').vocabulary,
      c.req.valid('json'),
    );
    return c.json(termView(term), 201);
  }) satisfies RouteHandler<typeof createTermRoute, AppEnv>);

  r.internal(updateTermRoute, (async (c) => {
    const { vocabulary, key } = c.req.valid('param');
    const term = await vocabularies.updateTerm(
      c.get('actor'),
      vocabulary,
      key,
      c.req.valid('json'),
    );
    return c.json(termView(term), 200);
  }) satisfies RouteHandler<typeof updateTermRoute, AppEnv>);

  r.internal(removeTermRoute, (async (c) => {
    const { vocabulary, key } = c.req.valid('param');
    const result = await vocabularies.removeTerm(c.get('actor'), vocabulary, key);
    return c.json(
      { outcome: result.outcome, term: result.term ? termView(result.term) : null },
      200,
    );
  }) satisfies RouteHandler<typeof removeTermRoute, AppEnv>);

  r.internal(brandingRoute, (async (c) => {
    const { mailFrom, ...open } = await branding.get();
    void mailFrom; // the sender address is not for the public
    c.header('cache-control', 'public, max-age=30');
    return c.json(open, 200);
  }) satisfies RouteHandler<typeof brandingRoute, AppEnv>);

  r.internal(legalRoute, (async (c) => {
    const document = await branding.legal(c.req.valid('param').page);
    if (!document) throw new NotFound('There is no text for this page.');
    c.header('cache-control', 'public, max-age=30');
    return c.json(document, 200);
  }) satisfies RouteHandler<typeof legalRoute, AppEnv>);
}
