// The registry `biblio.citationSource` (ADR-0056, plan §4): where citation counts come from. An entry says whether it is on
// for the current settings and fetches the counts of a batch of DOIs; it never writes. The refresh asks every entry that is
// on and stores what each answers under its id, so a new source (Crossref, Europe PMC) is a contribution of another module,
// not a change here. Nothing in this module branches on an entry's id.
import { z } from '@scorpion/contracts';
import type { OpenAlex, OpenAlexFailure } from '@scorpion/integrations';
import type { BibliometricsSettings } from '../settings-schema.ts';

export const CITATION_SOURCE_REGISTRY = 'biblio.citationSource';

/** The name of the optional OpenAlex key in the secrets store (`pnpm scorpion set-secret bibliometrics.openalex-api-key`). */
export const OPENALEX_KEY_SECRET = 'bibliometrics.openalex-api-key';

/** The most DOIs the refresh hands an entry at once (OpenAlex's limit of values in one OR filter). */
export const SOURCE_BATCH_SIZE = 100;

/** Why a source could not answer for some DOIs: a fixed code of at most 32 characters, never a URL, a key or a body. */
export type SourceFailure = OpenAlexFailure | (string & {});

export interface SourceCounts {
  /** The count by normalised DOI, for the DOIs the source knows. */
  counts: ReadonlyMap<string, number>;
  /** The DOIs the source answered for and does not know. */
  notFound: readonly string[];
  /** The DOIs it could not answer for, with the reason. */
  failed: readonly { dois: readonly string[]; reason: SourceFailure }[];
}

export interface FetchCountsOptions {
  signal?: AbortSignal | undefined;
}

const fn = <T>() =>
  z.custom<T>((value) => typeof value === 'function', { message: 'expected a function' });

/** The entry of the registry; validated at start, so a bad contribution stops the start. */
export const citationSourceEntrySchema = z.strictObject({
  /** Stored with every run and snapshot: lower case, at most 32 characters. */
  id: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,31}$/, 'must be a lower-case key of at most 32 characters'),
  /** Shown with the counts ("not found in OpenAlex"). */
  label: z.string().min(1).max(100),
  /** Whether the source is asked with these settings. The module's `enabled` is checked before any entry is asked. */
  enabled: fn<(settings: BibliometricsSettings) => boolean>(),
  /** The counts of at most 100 normalised DOIs. A failure is in `failed`; a throw counts as a failure of the whole batch. */
  fetchCounts:
    fn<(dois: readonly string[], options: FetchCountsOptions) => Promise<SourceCounts>>(),
});
export type CitationSourceEntry = z.output<typeof citationSourceEntrySchema>;

/** The entries in registry order; two with the same id stop the start. */
export function indexSources(entries: readonly CitationSourceEntry[]): CitationSourceEntry[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id))
      throw new Error(`bibliometrics: two citation sources have the id "${entry.id}"`);
    seen.add(entry.id);
  }
  return [...entries];
}

export interface OpenAlexSourceDeps {
  /** The adapter for the key stored now (or none). Built per batch, so a key set or removed applies at the next batch. */
  client: (apiKey: string | undefined) => OpenAlex;
  /** The stored key, if any (`getSecret` of core.settings). */
  apiKey: () => Promise<string | undefined>;
}

/** The built-in entry: OpenAlex, on whenever lookups are on (it is free and needs no account). */
export function openAlexSource(deps: () => OpenAlexSourceDeps): CitationSourceEntry {
  return {
    id: 'openalex',
    label: 'OpenAlex',
    enabled: (settings) => settings.enabled,
    async fetchCounts(dois, options) {
      const { client, apiKey } = deps();
      return client(await apiKey()).citedByCount(dois, { signal: options.signal });
    },
  };
}
