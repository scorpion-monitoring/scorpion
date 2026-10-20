// What the page learns from the registry `ingestion.adapter` (through `GET /kpi/ingestion/adapters`): which files it accepts, which formats have an
// import template, and the name of each way in the person's language. No extension and no format is written in the page. Pure.
import type { Adapter } from './types.ts';

const fileAdapters = (adapters: readonly Adapter[]) =>
  adapters.filter((adapter) => adapter.input === 'file');

/** The extensions the file adapters accept, with a dot, in the order of the adapters, each once (`.csv`, `.tsv`, `.xlsx`). */
export function acceptedExtensions(adapters: readonly Adapter[]): string[] {
  const seen = new Set<string>();
  for (const adapter of fileAdapters(adapters))
    for (const extension of adapter.extensions)
      seen.add(`.${extension.replace(/^\./, '').toLowerCase()}`);
  return [...seen];
}

/** The `accept` attribute of the file input: the extensions and the media types. */
export function acceptAttribute(adapters: readonly Adapter[]): string {
  const types = new Set(fileAdapters(adapters).flatMap((adapter) => adapter.mediaTypes));
  return [...acceptedExtensions(adapters), ...types].join(',');
}

/** The formats that have a template: the adapter's id (what the template route takes) and the extension of the file it writes, upper case. */
export function templateFormats(adapters: readonly Adapter[]): { id: string; label: string }[] {
  return adapters
    .filter((adapter) => adapter.template !== null)
    .map((adapter) => ({
      id: adapter.id,
      label: adapter.template!.replace(/^\./, '').toUpperCase(),
    }));
}

/** The name of an adapter in the language, English as the fallback, the id when the adapter is not known. */
export function adapterLabel(adapters: readonly Adapter[], id: string, locale: string): string {
  const adapter = adapters.find((entry) => entry.id === id);
  if (!adapter) return id;
  return (adapter.labels as Record<string, string | undefined>)[locale] ?? adapter.labels.en;
}

/** The file name a download should have: the one the server named in `Content-Disposition`, else `fallback`. Never a path. */
export function downloadName(header: string | null, fallback: string): string {
  const match = header && /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  const raw = match ? decodeURIComponent(match[1]!) : '';
  const name = raw.split(/[\\/]/).pop()?.trim();
  return name ? name : fallback;
}
