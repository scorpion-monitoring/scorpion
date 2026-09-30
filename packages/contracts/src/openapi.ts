import { OpenAPIHono } from '@hono/zod-openapi';
import { describeRoute, type AppRoute } from './route.ts';

export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
  /** Server URLs, for example the origin plus the base path plus `/api/v1`. */
  servers?: string[];
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
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
    info: { title: info.title, version: info.version, description: info.description },
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
