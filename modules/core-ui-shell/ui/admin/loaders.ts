// What the administration pages of roles and settings need before they render. They run on the server, after
// the permission check, and **throw** when they cannot get their data (defect 12).
import type { UiLoadContext } from '@scorpion/contracts';
import { ApiError, unwrap } from '@scorpion/contracts/client';
import type { PermissionInfo } from './groups.ts';

/** The API's largest page: every list here is short enough to read whole. */
const ALL = '100';

export interface RoleView {
  key: string;
  label: string;
  system: boolean;
  /** What the role holds; Admin holds every permission a loaded module declares. */
  permissions: string[];
}

export interface RolesData {
  roles: RoleView[];
  /** Every permission a loaded module declares (what Admin holds), with its module and description. */
  all: PermissionInfo[];
}

export async function loadRoles({ api }: UiLoadContext): Promise<RolesData> {
  const [roles, permissions] = await Promise.all([
    unwrap(api.GET('/roles', { params: { query: { pageSize: ALL } } })),
    unwrap(api.GET('/permissions', { params: { query: { pageSize: '500' } } })),
  ]);
  return { roles: roles.result, all: permissions.result };
}

export interface SettingsModuleRow {
  module: string;
  version: number;
  updatedAt: string | null;
}

export interface SettingsIndexData {
  modules: SettingsModuleRow[];
}

export async function loadSettingsIndex({ api }: UiLoadContext): Promise<SettingsIndexData> {
  const { result } = await unwrap(api.GET('/settings', { params: { query: { pageSize: ALL } } }));
  return {
    modules: result.map(({ module, version, updatedAt }) => ({ module, version, updatedAt })),
  };
}

export interface SettingsFormData {
  module: string;
  version: number;
  values: Record<string, unknown>;
  schema: Record<string, unknown>;
}

/** The settings of one module and the JSON Schema of its form. */
export async function loadSettingsModule({
  api,
  params,
}: UiLoadContext): Promise<SettingsFormData> {
  const path = { module: params.module! };
  const [current, schema] = await Promise.all([
    unwrap(api.GET('/settings/{module}', { params: { path } })),
    unwrap(api.GET('/settings/{module}/schema', { params: { path } })),
  ]);
  return {
    module: current.module,
    version: current.version,
    values: current.values,
    schema,
  };
}

/** The branding part of the settings of core.settings, with the schema of that part only. */
export async function loadBranding(context: UiLoadContext): Promise<SettingsFormData> {
  const data = await loadSettingsModule({ ...context, params: { module: 'core.settings' } });
  const properties = data.schema.properties as Record<string, unknown> | undefined;
  const branding = properties?.branding;
  if (typeof branding !== 'object' || branding === null) {
    throw new ApiError(404, {
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'This instance has no branding settings.',
    });
  }
  // Keep the definitions that the part may refer to.
  return {
    ...data,
    schema: { ...(branding as Record<string, unknown>), $defs: data.schema.$defs },
  };
}

export interface SecretRow {
  name: string;
  updatedAt: string;
}

export interface SecretsData {
  secrets: SecretRow[];
}

export async function loadSecrets({ api }: UiLoadContext): Promise<SecretsData> {
  const { result } = await unwrap(api.GET('/secrets', { params: { query: { pageSize: ALL } } }));
  return { secrets: result.map(({ name, updatedAt }) => ({ name, updatedAt })) };
}

export interface VocabularyRow {
  id: string;
  description: string;
  terms: number;
  activeTerms: number;
}

export interface TermRow {
  key: string;
  labels: Record<string, string>;
  sortOrder: number;
  active: boolean;
  seeded: boolean;
}

export interface VocabulariesData {
  vocabularies: VocabularyRow[];
  /** The vocabulary the address asks for, or the first one. */
  selected: string | null;
  terms: TermRow[];
}

export async function loadVocabularies({ api, url }: UiLoadContext): Promise<VocabulariesData> {
  const { result } = await unwrap(
    api.GET('/vocabularies', { params: { query: { pageSize: ALL } } }),
  );
  const asked = url.searchParams.get('vocabulary');
  const selected =
    result.find((vocabulary) => vocabulary.id === asked)?.id ?? result[0]?.id ?? null;
  if (selected === null) return { vocabularies: result, selected, terms: [] };
  const terms = await unwrap(
    api.GET('/vocabularies/{vocabulary}/terms', {
      params: {
        path: { vocabulary: selected },
        // Deactivated terms are for those who may change them; the API refuses the flag to anyone else.
        query: { pageSize: '500', includeInactive: 'true' },
      },
    }),
  ).catch(async (error: unknown) => {
    if (error instanceof ApiError && error.status === 403) {
      return unwrap(
        api.GET('/vocabularies/{vocabulary}/terms', {
          params: { path: { vocabulary: selected }, query: { pageSize: '500' } },
        }),
      );
    }
    throw error;
  });
  return {
    vocabularies: result,
    selected,
    terms: terms.result.map(({ key, labels, sortOrder, active, seeded }) => ({
      key,
      labels,
      sortOrder,
      active,
      seeded,
    })),
  };
}
