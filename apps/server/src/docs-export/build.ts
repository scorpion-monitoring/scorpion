// Turns what `collect.ts` read into the files of the export (ADR-0047). Pure: the same input gives the same bytes, and every file is checked
// against `schema.ts` before it is returned. Rows are sorted by their key; the order inside a JSON Schema is the one of its keys, sorted.
import { generateV1Document } from '@scorpion/contracts';
import { ENV_SECRETS, envSchema, type ModuleManifest } from '@scorpion/kernel';
import { z } from 'zod';
import { collectRoutes } from '../collect-routes.ts';
import { flagsOf, SERVER_COMMANDS } from '../commands.ts';
import type { DefinedProfile, LoadedModule, PlannedProfile } from './collect.ts';
import { byString, stableJson } from './json.ts';
import { checkFile, EXPORT_SCHEMA_VERSION } from './schema.ts';

export interface JourneyInput {
  id: string;
  slug: string;
  title: string;
  file: string;
  steps: string[];
  problems: string[];
}

export interface ScreenshotInput {
  path: string;
  journey: string;
  number: number;
  slug: string;
  theme: 'light' | 'dark';
}

export interface ExportInput {
  scorpionVersion: string;
  modules: LoadedModule[];
  profiles: DefinedProfile[];
  planned: PlannedProfile[];
  journeys: JourneyInput[];
  screenshots: ScreenshotInput[];
  firstRelease: (dirName: string) => string | null;
}

/** A file of the export, by its path. `json` is the content of a JSON file; `bytes` a binary one (a picture). */
export type ExportFile = { path: string; json: unknown } | { path: string; bytes: 'screenshot' };

type Json = Record<string, unknown>;

/** JSON Schema of a Zod schema, as the knowledge base draws it: draft 2020-12, the input side, nothing that cannot be written as `{}`. */
export function jsonSchemaOf(schema: z.ZodType): Json {
  const result = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Json;
  delete result.$schema;
  return result;
}

const sortedBy = <T>(rows: T[], key: (row: T) => string): T[] =>
  [...rows].sort((a, b) => byString(key(a), key(b)));

function settingRows(modules: LoadedModule[]) {
  const settings: unknown[] = [];
  const schemas: unknown[] = [];
  for (const { id, manifest } of modules) {
    if (!manifest.settings) continue;
    const schema = jsonSchemaOf(manifest.settings);
    schemas.push({ module: id, schema });
    const required = new Set((schema.required as string[] | undefined) ?? []);
    const properties = (schema.properties ?? {}) as Record<string, Json>;
    for (const [key, property] of Object.entries(properties)) {
      settings.push({
        module: id,
        key,
        title: (property.title as string | undefined) ?? null,
        description: (property.description as string | undefined) ?? null,
        required: required.has(key),
        default: property.default ?? null,
        schema: property,
      });
    }
  }
  return {
    settings: sortedBy(
      settings as { module: string; key: string }[],
      (row) => `${row.module}\0${row.key}`,
    ),
    schemas: sortedBy(schemas as { module: string }[], (row) => row.module),
  };
}

function eventRows(modules: LoadedModule[]) {
  const rows = new Map<
    string,
    { name: string; module: string; payloadSchema: Json | null; subscribers: Set<string> }
  >();
  for (const { id, manifest } of modules) {
    for (const [name, schema] of Object.entries(manifest.events?.emits ?? {})) {
      rows.set(name, {
        name,
        module: id,
        payloadSchema: jsonSchemaOf(schema),
        subscribers: new Set(),
      });
    }
  }
  for (const { id, manifest } of modules) {
    for (const name of Object.keys(manifest.events?.on ?? {})) {
      const row = rows.get(name) ?? {
        name,
        module: 'kernel',
        payloadSchema: null,
        subscribers: new Set<string>(),
      };
      row.subscribers.add(id);
      rows.set(name, row);
    }
  }
  return sortedBy(
    [...rows.values()].map((row) => ({ ...row, subscribers: [...row.subscribers].sort(byString) })),
    (row) => row.name,
  );
}

function registryRows(modules: LoadedModule[]) {
  const rows = new Map<
    string,
    {
      name: string;
      owner: string;
      entrySchema: Json | null;
      contributors: { module: string; entries: number }[];
    }
  >();
  for (const { id, manifest } of modules) {
    for (const [name, schema] of Object.entries(manifest.registries ?? {})) {
      rows.set(name, { name, owner: id, entrySchema: jsonSchemaOf(schema), contributors: [] });
    }
  }
  for (const { id, manifest } of modules) {
    for (const [name, entries] of Object.entries(manifest.contributes ?? {})) {
      const row = rows.get(name) ?? { name, owner: 'kernel', entrySchema: null, contributors: [] };
      if (entries.length > 0) row.contributors.push({ module: id, entries: entries.length });
      rows.set(name, row);
    }
  }
  return sortedBy(
    [...rows.values()].map((row) => ({
      ...row,
      contributors: sortedBy(row.contributors, (c) => c.module),
    })),
    (row) => row.name,
  );
}

function jobRows(modules: LoadedModule[]) {
  return sortedBy(
    modules.flatMap(({ id, manifest }) =>
      (manifest.jobs ?? []).map((job) => ({
        name: job.name,
        module: id,
        schedule: job.schedule ?? null,
        retryLimit: job.retry.limit,
        retryDelaySeconds: job.retry.delaySeconds,
        retryBackoff: job.retry.backoff ?? false,
        timeoutSeconds: job.timeoutSeconds,
        dataSchema: job.data ? jsonSchemaOf(job.data) : null,
      })),
    ),
    (row) => row.name,
  );
}

/** The variables the kernel reads (from its Zod schema) and the ones modules declare. Never a value of the environment, never a default of a secret. */
function envRows(modules: LoadedModule[]) {
  const schema = jsonSchemaOf(envSchema);
  const rows: unknown[] = Object.entries((schema.properties ?? {}) as Record<string, Json>).map(
    ([name, property]) => {
      const secret = ENV_SECRETS.includes(name);
      const values = Array.isArray(property.enum) ? (property.enum as string[]) : null;
      // What the schema makes of a variable that is not set: a value (its default), nothing (optional), or an error (required).
      const unset = envSchema.shape[name as keyof typeof envSchema.shape].safeParse(undefined);
      return {
        name,
        module: 'kernel',
        type: typeof property.type === 'string' ? property.type : 'string',
        required: !unset.success,
        default: secret || !unset.success ? null : (unset.data ?? null),
        secret,
        description: (property.description as string | undefined) ?? '',
        values,
      };
    },
  );
  for (const { id, manifest } of modules) {
    for (const [name, def] of Object.entries(manifest.env ?? {})) {
      rows.push({
        name,
        module: id,
        type: 'string',
        required: def.required === true,
        default: null,
        secret: def.secret === true,
        description: def.description,
        values: null,
      });
    }
  }
  return { rows: sortedBy(rows as { name: string }[], (row) => row.name), schema };
}

function cliRows(modules: LoadedModule[]) {
  const rows = SERVER_COMMANDS.map((command) => ({
    name: command.name,
    module: 'server',
    usage: command.usage,
    description: command.description.replaceAll('\n', ' '),
    flags: flagsOf(command.usage),
  }));
  for (const { id, manifest } of modules) {
    for (const command of manifest.commands ?? []) {
      const usage = command.usage ?? command.name;
      rows.push({
        name: command.name,
        module: id,
        usage,
        description: command.description,
        flags: flagsOf(usage),
      });
    }
  }
  return sortedBy(rows, (row) => row.name);
}

function profileRows(input: ExportInput) {
  const rows = [
    ...input.profiles.map((profile) => ({
      name: profile.name,
      status: 'defined' as const,
      modules: sortedBy(
        profile.modules.map((id) => ({ id, inclusion: 'included' as const })),
        (m) => m.id,
      ),
    })),
    ...input.planned.map((profile) => ({
      name: profile.name,
      status: 'planned' as const,
      modules: sortedBy(profile.modules, (m) => m.id),
    })),
  ];
  return sortedBy(rows, (row) => row.name);
}

/** The public API (v1) of each profile, as `GET /api/v1/openapi.json` serves it with the default settings and no `servers`. */
function openapiDocuments(input: ExportInput): Map<string, unknown> {
  const byId = new Map(input.modules.map((module) => [module.id, module.manifest] as const));
  const documents = new Map<string, unknown>();
  for (const profile of input.profiles) {
    const manifests = profile.modules
      .map((id) => byId.get(id))
      .filter((m): m is ModuleManifest => m !== undefined);
    documents.set(profile.name, generateV1Document(collectRoutes(manifests).v1));
  }
  return documents;
}

/** Builds the export. Throws, naming every problem, when a journey spec has no steps or a file does not fit its schema. */
export function buildExport(input: ExportInput): Map<string, string | { screenshot: string }> {
  const problems: string[] = [];
  for (const journey of input.journeys) {
    for (const problem of journey.problems) problems.push(`journeys/${journey.file}: ${problem}`);
  }
  const files = new Map<string, unknown>();
  files.set(
    'modules.json',
    input.modules.map((module) => ({
      id: module.id,
      displayName: module.manifest.displayName ?? module.id,
      kind: module.id.startsWith('core.') ? 'core' : 'optional',
      version: module.version,
      package: module.packageName,
      tablePrefix: module.manifest.tablePrefix ?? null,
      dependencies: module.dependencies,
      optionalDependencies: module.optionalDependencies,
      profiles: input.profiles
        .filter((profile) => profile.modules.includes(module.id))
        .map((p) => p.name)
        .sort(byString),
      firstRelease: input.firstRelease(module.dirName),
    })),
  );
  files.set(
    'permissions.json',
    sortedBy(
      input.modules.flatMap((module) =>
        Object.entries(module.manifest.permissions ?? {}).map(([permission, def]) => ({
          id: permission,
          module: module.id,
          scope: def.scope ?? null,
          description: def.description,
        })),
      ),
      (row) => row.id,
    ),
  );
  const { settings, schemas } = settingRows(input.modules);
  files.set('settings.json', settings);
  files.set('settings-schemas.json', schemas);
  files.set('events.json', eventRows(input.modules));
  files.set('registries.json', registryRows(input.modules));
  files.set('jobs.json', jobRows(input.modules));
  const env = envRows(input.modules);
  files.set('env.json', env.rows);
  files.set('env.schema.json', env.schema);
  files.set('cli.json', cliRows(input.modules));
  files.set('profiles.json', profileRows(input));

  const journeys = sortedBy(input.journeys, (journey) => journey.id);
  files.set(
    'journeys.json',
    journeys.map(({ id, slug, title, file, steps }) => ({ id, slug, title, file, steps })),
  );
  files.set(
    'journey-steps.json',
    Object.fromEntries(journeys.map((journey) => [journey.id, journey.steps])),
  );

  const shots = new Map<
    string,
    { journey: string; number: number; slug: string; light?: string; dark?: string }
  >();
  for (const shot of input.screenshots) {
    const key = `${shot.journey}/${shot.number}-${shot.slug}`;
    const row = shots.get(key) ?? { journey: shot.journey, number: shot.number, slug: shot.slug };
    row[shot.theme] = `screenshots/${shot.path}`;
    shots.set(key, row);
  }
  for (const [key, row] of shots) {
    if (!row.light || !row.dark)
      problems.push(`screenshots/${key}: needs a light and a dark picture`);
  }
  files.set(
    'screenshots.json',
    sortedBy(
      [...shots.values()],
      (row) => `${row.journey}/${String(row.number).padStart(2, '0')}-${row.slug}`,
    ),
  );

  const documents = openapiDocuments(input);
  for (const [name, document] of documents) files.set(`openapi/${name}.json`, document);
  const full = documents.get('full') ?? [...documents.values()][0];
  if (full) files.set('openapi.json', full);

  const out = new Map<string, string | { screenshot: string }>();
  for (const [path, content] of files) {
    problems.push(...checkFile(path, content));
    out.set(path, stableJson(content));
  }
  for (const shot of input.screenshots)
    out.set(`screenshots/${shot.path}`, { screenshot: shot.path });
  const info = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    scorpionVersion: input.scorpionVersion,
    profiles: input.profiles.map((profile) => profile.name),
    files: [...out.keys()].sort(byString),
  };
  problems.push(...checkFile('docs-export.json', info));
  out.set('docs-export.json', stableJson(info));
  if (problems.length > 0)
    throw new Error(`The docs export is not valid:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  return new Map([...out.entries()].sort(([a], [b]) => byString(a, b)));
}
