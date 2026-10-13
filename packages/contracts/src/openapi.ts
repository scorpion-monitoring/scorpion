import { OpenAPIHono } from '@hono/zod-openapi';
import { describeRoute, type AppRoute } from './route.ts';

export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
  /** Who to ask about the API: OpenAPI's `info.contact`; empty fields are left out. */
  contact?: { name?: string; email?: string; url?: string };
  /** Server URLs, for example the origin plus the base path plus `/api/v1`. */
  servers?: string[];
}

export interface OpenApiDocument {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
    contact?: { name?: string; email?: string; url?: string };
  };
  servers?: { url: string }[];
  paths?: Record<string, Record<string, unknown>>;
  components?: Record<string, unknown>;
}

/** An OpenAPI 3.1 document for a set of routes. Routes that share a method and path are an error. */
export function generateOpenApiDocument(
  routes: readonly AppRoute[],
  info: OpenApiInfo,
): OpenApiDocument {
  const app = new OpenAPIHono();
  const seen = new Set<string>();
  for (const route of routes) {
    const key = describeRoute(route);
    if (seen.has(key)) throw new Error(`Route ${key} is defined twice`);
    seen.add(key);
    app.openapi(route as never, (() => new Response(null)) as never);
  }
  const document = app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: {
      title: info.title,
      version: info.version,
      description: info.description,
      ...(info.contact && Object.keys(info.contact).length > 0 ? { contact: info.contact } : {}),
    },
    servers: info.servers?.map((url) => ({ url })),
  });
  // Record who may call what, next to the standard OpenAPI fields.
  for (const route of routes) {
    const path = route.path;
    const operation = (
      document.paths?.[path] as Record<string, Record<string, unknown>> | undefined
    )?.[route.method];
    if (operation) {
      if (route.public === true) operation['x-public'] = true;
      else if (route.permission) operation['x-permission'] = route.permission;
    }
  }
  return document as unknown as OpenApiDocument;
}

/**
 * The title and description of the public API's document when no administrator changed them. The
 * committed document (`pnpm openapi:generate`) and the runtime one (`public-api`) both start here, so
 * with default settings they are the same document.
 */
export const V1_DOCUMENT_DEFAULTS = {
  title: 'Public API',
  description: 'The public API, version 1.',
} as const;

/** The OpenAPI document of the public API (v1) for the given routes. */
export function generateV1Document(
  routes: readonly AppRoute[],
  info: Partial<Pick<OpenApiInfo, 'title' | 'description' | 'contact' | 'servers'>> = {},
): OpenApiDocument {
  return generateOpenApiDocument(routes, {
    title: info.title || V1_DOCUMENT_DEFAULTS.title,
    version: '1',
    description: info.description || V1_DOCUMENT_DEFAULTS.description,
    contact: info.contact,
    servers: info.servers,
  });
}
