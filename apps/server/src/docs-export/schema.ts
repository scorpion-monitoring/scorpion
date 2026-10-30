// The shape of every file of the docs export (ADR-0047). The builder checks its own output against these before it writes, and the
// tests check the written files again, so a change of a shape is a change of this file and of `EXPORT_SCHEMA_VERSION`.
// A table (`modules.json`, `permissions.json`, ...) is a JSON array of rows, which is what the knowledge base reads (`readGenerated`).
import { z } from 'zod';

/** Raised when a file is removed or a field changes its meaning; adding a field or a file does not raise it. */
export const EXPORT_SCHEMA_VERSION = 1;

const jsonSchema = z.record(z.string(), z.unknown());
const id = z.string().min(1);

export const moduleRow = z.strictObject({
  id,
  displayName: z.string().min(1),
  kind: z.enum(['core', 'optional']),
  version: z.string(),
  package: z.string(),
  tablePrefix: z.string().nullable(),
  /** Module ids the module needs (`dependencies` of its package.json). */
  dependencies: z.array(id),
  /** Module ids it uses when they are there (optional peer dependencies). */
  optionalDependencies: z.array(id),
  /** The defined profiles that include it. */
  profiles: z.array(z.string()),
  /** The first release tag that had the module, from the git history; `null` when the history has no tag for it. */
  firstRelease: z.string().nullable(),
});

export const permissionRow = z.strictObject({
  /** The id the knowledge base checks `<Permission id>` against. */
  id,
  module: id,
  scope: z.string().nullable(),
  description: z.string().min(1),
});

export const settingRow = z.strictObject({
  module: id,
  key: z.string().min(1),
  title: z.string().nullable(),
  description: z.string().nullable(),
  required: z.boolean(),
  /** The default the schema applies; `null` when it has none. */
  default: z.unknown().nullable(),
  /** JSON Schema (draft 2020-12, input side) of the value. */
  schema: jsonSchema,
});

export const settingsSchemaRow = z.strictObject({ module: id, schema: jsonSchema });

export const eventRow = z.strictObject({
  name: z.string().min(1),
  /** The module that emits it (`kernel` for `system.ready`). */
  module: z.string().min(1),
  payloadSchema: jsonSchema.nullable(),
  subscribers: z.array(id),
});

export const registryRow = z.strictObject({
  name: z.string().min(1),
  /** The module that declares it (`kernel` for the registries the kernel owns). */
  owner: z.string().min(1),
  entrySchema: jsonSchema.nullable(),
  contributors: z.array(z.strictObject({ module: id, entries: z.number().int().min(1) })),
});

export const jobRow = z.strictObject({
  name: z.string().min(1),
  module: id,
  schedule: z.string().nullable(),
  retryLimit: z.number().int(),
  retryDelaySeconds: z.number(),
  retryBackoff: z.boolean(),
  timeoutSeconds: z.number(),
  dataSchema: jsonSchema.nullable(),
});

export const envRow = z.strictObject({
  name: z.string().min(1),
  /** `kernel`, or the module that reads it. */
  module: z.string().min(1),
  type: z.string(),
  required: z.boolean(),
  /** The default; `null` when there is none. Never the value of a secret. */
  default: z.unknown().nullable(),
  secret: z.boolean(),
  description: z.string(),
  values: z.array(z.string()).nullable(),
});

export const cliRow = z.strictObject({
  name: z.string().min(1),
  /** `server`, or the module that contributes it. */
  module: z.string().min(1),
  usage: z.string().min(1),
  description: z.string(),
  flags: z.array(
    z.strictObject({ name: z.string(), value: z.string().nullable(), required: z.boolean() }),
  ),
});

export const profileRow = z.strictObject({
  name: z.string().min(1),
  /** `defined`: a file in `profiles/`. `planned`: a column of the architecture's matrix that has no file yet. */
  status: z.enum(['defined', 'planned']),
  modules: z.array(z.strictObject({ id, inclusion: z.enum(['included', 'optional']) })),
});

export const journeyRow = z.strictObject({
  id: z.string().regex(/^j\d{2}$/),
  slug: z.string().min(1),
  title: z.string(),
  file: z.string(),
  steps: z.array(z.string().min(1)).min(1),
});

/** `journey-steps.json`: not a table; the journey id to its step titles, in order. */
export const journeySteps = z.record(
  z.string().regex(/^j\d{2}$/),
  z.array(z.string().min(1)).min(1),
);

export const screenshotRow = z.strictObject({
  journey: z.string().regex(/^j\d{2}$/),
  number: z.number().int(),
  slug: z.string(),
  light: z.string(),
  dark: z.string(),
});

export const exportInfo = z.strictObject({
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  scorpionVersion: z.string(),
  /** The names of the defined profiles. */
  profiles: z.array(z.string()),
  /** Every file of the export except this one, by path. */
  files: z.array(z.string()),
});

export const openapiDocument = z.looseObject({
  openapi: z.string(),
  info: z.looseObject({ title: z.string(), version: z.string() }),
  paths: z.record(z.string(), z.unknown()),
});

/** File name (or folder) to the schema of what is in it; a table's schema is the one of a row. */
export const TABLES = {
  'modules.json': moduleRow,
  'permissions.json': permissionRow,
  'settings.json': settingRow,
  'settings-schemas.json': settingsSchemaRow,
  'events.json': eventRow,
  'registries.json': registryRow,
  'jobs.json': jobRow,
  'env.json': envRow,
  'cli.json': cliRow,
  'profiles.json': profileRow,
  'journeys.json': journeyRow,
  'screenshots.json': screenshotRow,
} as const;

export type TableName = keyof typeof TABLES;

/** The problems of a file's content against its schema (empty when it fits). Any `openapi*.json` is a document. */
export function checkFile(path: string, content: unknown): string[] {
  const issues = (result: { success: boolean; error?: z.ZodError }) =>
    result.success
      ? []
      : result.error!.issues.map((issue) => `${path}: ${issue.path.join('.')}: ${issue.message}`);
  if (path === 'docs-export.json') return issues(exportInfo.safeParse(content));
  if (path === 'journey-steps.json') return issues(journeySteps.safeParse(content));
  if (path === 'openapi.json' || path.startsWith('openapi/'))
    return issues(openapiDocument.safeParse(content));
  if (path === 'env.schema.json') return issues(jsonSchema.safeParse(content));
  const row = TABLES[path as TableName];
  if (!row) return [`${path}: no schema for this file`];
  return issues(z.array(row).safeParse(content));
}
