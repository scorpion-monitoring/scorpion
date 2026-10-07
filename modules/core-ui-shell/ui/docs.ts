import type { UiLoadContext } from '@scorpion/contracts';

export interface DocsOperation {
  method: string;
  path: string;
  summary: string;
  public: boolean;
  permission: string | null;
}

export interface DocsData {
  operations: DocsOperation[];
}

const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

/**
 * The operations of the public API of this build (v1), from the OpenAPI document the build generated
 * (`pnpm openapi:generate`). Sorted by path then method, so the page is stable. v1 has no routes before
 * M8; the page then says so.
 */
export function loadDocs({ publicApi }: UiLoadContext): DocsData {
  const operations: DocsOperation[] = [];
  for (const [path, item] of Object.entries(publicApi.paths ?? {})) {
    for (const method of METHODS) {
      const operation = item[method] as
        | { summary?: string; description?: string; 'x-public'?: boolean; 'x-permission'?: string }
        | undefined;
      if (!operation) continue;
      operations.push({
        method,
        path,
        summary: operation.summary ?? operation.description ?? '',
        public: operation['x-public'] === true,
        permission: operation['x-permission'] ?? null,
      });
    }
  }
  operations.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  return { operations };
}
