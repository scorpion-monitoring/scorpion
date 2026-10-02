// The settings port (ADR 0017). The kernel owns the registry `kernel.settingsStore`; `core.settings`
// contributes the one entry. Every module reads its own validated, defaulted settings through
// `ctx.settings`. Without a store the port yields the defaults of the module's schema, so a profile
// that does not include `core.settings` keeps working.
import { z } from 'zod';
import type { Logger } from './logger.ts';

export const SETTINGS_STORE_REGISTRY = 'kernel.settingsStore';

/** Where stored settings come from. The store caches; the kernel parses on every read. */
export interface SettingsStore {
  /** The stored JSON of one module, or `undefined` when nothing was stored. */
  read(moduleId: string): Promise<unknown>;
}

export const settingsStoreEntrySchema = z.strictObject({
  read: z.custom<SettingsStore['read']>(
    (value) => typeof value === 'function',
    'expected a function',
  ),
});

/** What `ctx.settings` is: the settings of the module that owns the context. */
export interface SettingsPort<T = unknown> {
  /**
   * The module's settings as its manifest schema parses them, defaults applied. A stored key that
   * the schema now rejects falls back to its default and is logged (key names only); the other
   * keys keep their stored values. Resolves to `{}` for a module that declares no schema.
   */
  get(): Promise<T>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface ResolvedSettings {
  value: unknown;
  /** Top-level keys of the stored value that were ignored because the schema rejects them. */
  dropped: string[];
}

/**
 * Parses a stored value with the module's schema. A key the schema rejects (a value of a type it no
 * longer accepts, a key it no longer knows) is dropped and the key falls back to its default, so one
 * stale key never turns a whole module's configuration into the defaults, and never into an error.
 * Throws only when even the empty object is not valid (a required setting that was never stored).
 */
export function resolveSettings(schema: z.ZodType, stored: unknown): ResolvedSettings {
  const candidate: Record<string, unknown> = isPlainObject(stored) ? { ...stored } : {};
  const dropped: string[] = [];
  for (let attempt = 0; attempt <= Object.keys(candidate).length + 1; attempt += 1) {
    const parsed = schema.safeParse(candidate);
    if (parsed.success) return { value: parsed.data, dropped };
    const bad = new Set<string>();
    for (const issue of parsed.error.issues) {
      if (issue.code === 'unrecognized_keys') {
        for (const key of issue.keys) bad.add(key);
      } else if (typeof issue.path[0] === 'string') {
        bad.add(issue.path[0]);
      }
    }
    const removable = [...bad].filter((key) => key in candidate);
    if (removable.length === 0) break;
    for (const key of removable) {
      delete candidate[key];
      dropped.push(key);
    }
  }
  const empty = schema.safeParse({});
  if (empty.success)
    return { value: empty.data, dropped: Object.keys(isPlainObject(stored) ? stored : {}) };
  throw new Error(
    `The settings have no valid value: ${empty.error.issues
      .map((issue) => issue.path.map(String).join('.') || '(root)')
      .join(', ')} must be set`,
  );
}

export interface SettingsPortOptions {
  moduleId: string;
  schema: z.ZodType | undefined;
  /** The store, once the module that provides it has built its services; else the defaults apply. */
  store: () => SettingsStore | undefined;
  log: Logger;
}

/** The port behind `ctx.settings` of one module. */
export function createSettingsPort(options: SettingsPortOptions): SettingsPort {
  const { moduleId, schema, store, log } = options;
  const warned = new Set<string>();
  return {
    async get() {
      if (!schema) return Object.freeze({});
      const source = store();
      if (!source) return resolveSettings(schema, undefined).value;
      const { value, dropped } = resolveSettings(schema, await source.read(moduleId));
      const signature = dropped.join(',');
      if (dropped.length > 0 && !warned.has(signature)) {
        warned.add(signature);
        // Names only: a stored value could be anything.
        log.warn(
          { module: moduleId, keys: dropped },
          'stored settings the schema rejects were ignored; their defaults apply',
        );
      }
      return value;
    },
  };
}
