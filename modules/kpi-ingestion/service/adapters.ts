// The registry `ingestion.adapter` (ADR-0041, plan §7 item 1). An adapter turns what a person or a program gives (a file, or the
// values of a form) into rows `{ indicator, period, value }` and problems; it never writes. `upsertBatch` writes, so every adapter
// goes through the one path and a new one (a REST pull, Matomo) is a contribution, not a change of this module. The service never
// asks an adapter's id: it asks what the entry says it accepts and whether its `sniff` recognises the bytes.
import { z } from '@scorpion/contracts';
import {
  MAX_ECHO,
  PREVIEW_ROWS,
  echo,
  echoHeader,
  mapTable,
  type ColumnMapping,
  type ParsedRow,
  type Table,
  type TableProblem,
  type TargetIndicator,
} from './table.ts';

export const ADAPTER_REGISTRY = 'ingestion.adapter';

/** What an adapter is given besides the input: the service's effective KPI set (so a column can be matched by name) and the clock. */
export interface AdapterContext {
  indicators: readonly TargetIndicator[];
  /** "Now", injected. */
  clock: () => Date;
}

export interface AdapterInput {
  /** The file's bytes (a file adapter). Never stored. */
  bytes?: Uint8Array;
  /** The sanitised file name, a hint for the extension. */
  fileName?: string | null;
  /** The sheet to read (a workbook adapter): a name; the first sheet when absent. */
  sheet?: string;
  /** The values of a form (the form adapter). */
  form?: { period: string; values: Record<string, string> };
  /** The column mapping the person chose; absent means "propose one from the header". */
  mapping?: Record<string, unknown>;
}

export interface AdapterOutput {
  /** The header of the file as the page shows it (cut, unescaped); empty for a form. */
  header: string[];
  /** The first rows of the table as the page shows them (cells cut at 64 characters), and the file row of each. */
  preview: { rows: string[][]; rowNumbers: number[] };
  /** How many data rows the table has. */
  totalRows: number;
  /** One entry per header column. */
  targets: (string | null)[];
  mapping: ColumnMapping;
  proposed: boolean;
  missing: string[];
  rows: ParsedRow[];
  problems: TableProblem[];
}

const key = z
  .string()
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'must be a lower-case key')
  .max(32);
const fn = <T>() =>
  z.custom<T>((value) => typeof value === 'function', { message: 'expected a function' });
const extension = z.string().regex(/^[a-z0-9]{1,8}$/, 'must be an extension without the dot');
const mediaType = z
  .string()
  .regex(/^[a-z]+\/[a-z0-9.+-]+(; ?[a-z-]+=[a-z0-9-]+)?$/, 'must be a media type');

/** The entry of the registry; validated at start, so a bad contribution stops the start and does not fail at the first upload. */
export const adapterEntrySchema = z.strictObject({
  id: key,
  labels: z.strictObject({
    en: z.string().min(1).max(100),
    de: z.string().min(1).max(100).optional(),
  }),
  /** What the adapter takes: the bytes of a file, or the values of a form. */
  input: z.enum(['file', 'values']),
  /** The extensions and media types of the files it reads (empty for a form). */
  accepts: z.strictObject({
    extensions: z.array(extension).max(10),
    mediaTypes: z.array(mediaType).max(10),
  }),
  /** Whether the bytes look like this adapter's format (a file adapter). The content decides, the extension is a hint. */
  sniff: fn<(bytes: Uint8Array) => boolean>().optional(),
  parse:
    fn<(input: AdapterInput, context: AdapterContext) => AdapterOutput | Promise<AdapterOutput>>(),
  /** Writes the import template from rows of text (already escaped); present when the adapter has one. */
  template: z
    .strictObject({
      extension,
      contentType: mediaType,
      write: fn<(rows: string[][]) => Promise<Uint8Array>>(),
    })
    .optional(),
});
export type AdapterEntry = z.output<typeof adapterEntrySchema>;

/** The entries as an index; two with the same id stop the start. */
export function indexAdapters(entries: readonly AdapterEntry[]): Map<string, AdapterEntry> {
  const index = new Map<string, AdapterEntry>();
  for (const entry of entries) {
    if (index.has(entry.id))
      throw new Error(`kpi.ingestion: two ingestion adapters have the id "${entry.id}"`);
    index.set(entry.id, entry);
  }
  return index;
}

/**
 * The adapter that reads a file: the content decides and the extension is a hint. The named adapter is used when it recognises the
 * bytes; otherwise the first file adapter that does (an XLSX saved as `.csv` is read as a workbook, a CSV named `.xlsx` as text).
 * `undefined` when nothing does: a file that is neither is a problem, not a 500.
 */
export function chooseFileAdapter(
  adapters: ReadonlyMap<string, AdapterEntry>,
  requested: string | undefined,
  bytes: Uint8Array,
): AdapterEntry | undefined {
  const files = [...adapters.values()].filter((entry) => entry.input === 'file');
  const recognises = (entry: AdapterEntry) => entry.sniff?.(bytes) ?? true;
  const named = requested ? files.find((entry) => entry.id === requested) : undefined;
  if (named && recognises(named)) return named;
  return files.find((entry) => entry.sniff !== undefined && recognises(entry));
}

/** The file extension of a (sanitised) name, lower case, without the dot. */
export function extensionOf(fileName: string | null | undefined): string | undefined {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName ?? '');
  return match?.[1]?.toLowerCase();
}

/** What a file adapter returns when it could read nothing: its problems and an empty table. */
export function failed(problems: TableProblem[]): AdapterOutput {
  return {
    header: [],
    preview: { rows: [], rowNumbers: [] },
    totalRows: 0,
    targets: [],
    mapping: {},
    proposed: true,
    missing: [],
    rows: [],
    problems,
  };
}

/**
 * The shared end of every file adapter: a table (and the problems found while reading it) becomes the mapped rows, the mapping
 * and the preview. A table with no header cell at all is an empty file.
 */
export function fromTable(
  table: Table | undefined,
  readProblems: readonly TableProblem[],
  input: AdapterInput,
  context: AdapterContext,
): AdapterOutput {
  if (!table || table.header.length === 0)
    return failed([
      ...readProblems,
      ...(readProblems.length === 0 ? [{ row: 0, column: 0, code: 'empty-file' as const }] : []),
    ]);
  const mapped = mapTable(table, context.indicators, input.mapping);
  return {
    header: echoHeader(table.header),
    preview: {
      rows: table.rows.slice(0, PREVIEW_ROWS).map((cells) => cells.map(echo)),
      rowNumbers: table.rowNumbers.slice(0, PREVIEW_ROWS),
    },
    totalRows: table.rows.length,
    targets: mapped.targets,
    mapping: mapped.mapping,
    proposed: mapped.proposed,
    missing: mapped.missing,
    rows: mapped.rows,
    problems: [...readProblems, ...mapped.problems],
  };
}

export { MAX_ECHO };
