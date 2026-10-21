// The dashboard document of one person and the pure functions around it (M11 plan §3). The document is
// stored as the user preference `core.ui-shell.dashboard` and is never trusted: `parseDashboard` turns
// whatever is stored into a valid dashboard and says what it dropped, and never throws. No clock, no
// database, no I/O: every function here is a function of its arguments.
import { pack } from '@scorpion/contracts/dashboard-layout';
import { z } from 'zod';
import {
  COLUMNS,
  CURRENT_VERSION,
  DASHBOARD_SLOT,
  DEFAULT_SIZE,
  INSTANCE_ID,
  MAX_CONFIG_BYTES,
  MAX_DOCUMENT_BYTES,
  MAX_ITEMS,
  MAX_ROWS,
  MAX_Y,
} from '../../grid.ts';
import type { WidgetEntry } from '../../registries.ts';

/** One tile: an instance of a widget, where it sits and its own configuration. */
export interface DashboardItem {
  /** The instance id: unique in the document, chosen by the browser. */
  id: string;
  /** The id of a `ui.widget` entry. */
  widget: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, unknown>;
}

export interface Dashboard {
  version: typeof CURRENT_VERSION;
  items: DashboardItem[];
}

/** The part of a widget entry the document functions read. */
export type PlaceableWidget = Pick<
  WidgetEntry,
  'id' | 'slot' | 'order' | 'permission' | 'public' | 'grid' | 'configSchema'
>;

export interface DashboardContext {
  /** The `ui.widget` registry. */
  entries: readonly PlaceableWidget[];
  /** Whether the caller holds the permission an entry names (the permission is the widget's, not the dashboard's). */
  may: (entry: PlaceableWidget) => boolean;
}

export type DropReason =
  | 'invalid-item'
  | 'duplicate-id'
  | 'unknown-widget'
  | 'not-permitted'
  | 'singleton-repeated'
  | 'document-too-large';

/** Why a whole stored document was replaced by the default one. */
export type ResetReason = 'invalid' | 'too-many-items' | 'newer-version';

export interface ParsedDashboard {
  items: DashboardItem[];
  /** What was left out. `id` is the tile's instance id, or `#<position>` when it has no usable one. */
  dropped: { id: string; reason: DropReason }[];
  /** The stored document was replaced by the default dashboard. */
  reset: boolean;
  resetReason?: ResetReason;
}

/**
 * The shape the preference store checks (so `PUT /preferences/core.ui-shell.dashboard` cannot store junk
 * either). It is deliberately looser than a valid dashboard: counts, ranges, ids, overlaps and widgets
 * are what `parseDashboard` repairs on every read. Unknown keys are dropped.
 */
export const storedDashboardSchema = z.object({
  version: z.number().int().min(1).max(10_000),
  items: z
    .array(
      z.object({
        id: z.string().max(64),
        widget: z.string().max(100),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
        config: z.record(z.string().max(64), z.unknown()),
      }),
    )
    .max(100),
});

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text).length;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** The JSON of a value, or `undefined` when it has none (a cycle, a bigint). */
function jsonOf(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

// ---- versions ------------------------------------------------------------------------------------------

/** One step per old version, each bringing a document of version `n` to `n + 1`. Version 1 has none yet. */
const STEPS: Record<number, (document: Record<string, unknown>) => Record<string, unknown>> = {};

/**
 * Brings a document of `version` up to `CURRENT_VERSION`, or `undefined` for a version nobody knows: a newer
 * one (written by a newer build; it is refused, not guessed) or one that is not a version at all.
 */
export function migrate(
  version: unknown,
  document: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (typeof version !== 'number' || !Number.isInteger(version)) return undefined;
  if (version < 1 || version > CURRENT_VERSION) return undefined;
  let current = document;
  for (let at = version; at < CURRENT_VERSION; at += 1) {
    const step = STEPS[at];
    if (!step) return undefined;
    current = { ...step(current), version: at + 1 };
  }
  return current;
}

// The packer is shared with the browser (`@scorpion/contracts`), so a layout the grid sends is one the repair leaves alone.
export { pack };

// ---- one tile ------------------------------------------------------------------------------------------

function limitsOf(entry: PlaceableWidget) {
  const grid = entry.grid;
  return {
    minW: grid?.minW ?? 1,
    maxW: Math.min(grid?.maxW ?? COLUMNS, COLUMNS),
    minH: grid?.minH ?? 1,
    maxH: Math.min(grid?.maxH ?? MAX_ROWS, MAX_ROWS),
    w: grid?.w ?? DEFAULT_SIZE.w,
    h: grid?.h ?? DEFAULT_SIZE.h,
  };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** A whole number inside `low..high`; the fallback when the value is not a finite number. */
function whole(value: unknown, low: number, high: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return clamp(Math.round(value), low, high);
}

/** What a widget's `configSchema` gives for no configuration at all: its defaults. `{}` when it has none. */
function defaultConfig(entry: PlaceableWidget): Record<string, unknown> {
  const schema = entry.configSchema;
  if (!schema) return {};
  for (const probe of [{}, undefined]) {
    try {
      const result = schema.safeParse(probe);
      if (result.success && isPlainObject(result.data)) {
        const text = jsonOf(result.data);
        if (text !== undefined && bytes(text) <= MAX_CONFIG_BYTES) {
          return JSON.parse(text) as Record<string, unknown>;
        }
      }
    } catch {
      // a schema that throws has no defaults to offer
    }
  }
  return {};
}

/** The configuration the widget's schema accepts, defaults applied; its defaults when the stored one fails. */
function repairConfig(entry: PlaceableWidget, config: unknown): Record<string, unknown> {
  const schema = entry.configSchema;
  if (!schema) return {};
  if (!isPlainObject(config)) return defaultConfig(entry);
  const stored = jsonOf(config);
  if (stored === undefined || bytes(stored) > MAX_CONFIG_BYTES) return defaultConfig(entry);
  try {
    const result = schema.safeParse(config);
    if (!result.success || !isPlainObject(result.data)) return defaultConfig(entry);
    const text = jsonOf(result.data);
    if (text === undefined || bytes(text) > MAX_CONFIG_BYTES) return defaultConfig(entry);
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return defaultConfig(entry);
  }
}

const isPlaceable = (entry: PlaceableWidget | undefined): entry is PlaceableWidget =>
  entry !== undefined && entry.slot === DASHBOARD_SLOT;

// ---- repairing a list of tiles -------------------------------------------------------------------------

type RawItem = z.output<typeof storedDashboardSchema>['items'][number];

/** The document as it is stored: the version and the tiles, in this key order, nothing else. */
function documentOf(items: readonly DashboardItem[]): string {
  return JSON.stringify({
    version: CURRENT_VERSION,
    items: items.map(({ id, widget, x, y, w, h, config }) => ({ id, widget, x, y, w, h, config })),
  });
}

/**
 * The tiles a dashboard may show out of what was stored: unknown widgets, widgets the caller may not see, a
 * repeated singleton, a bad or repeated id are left out (and listed); sizes are clamped to the widget's limits,
 * a tile is moved inside the grid, a configuration that fails its schema becomes the widget's defaults,
 * overlaps are moved down, and the last tiles go when the document would still not fit its cap.
 */
function repair(
  raw: readonly RawItem[],
  context: DashboardContext,
): Omit<ParsedDashboard, 'reset'> {
  const byId = new Map(context.entries.map((entry) => [entry.id, entry]));
  const dropped: ParsedDashboard['dropped'] = [];
  const seen = new Set<string>();
  const singletons = new Set<string>();
  const kept: DashboardItem[] = [];

  raw.forEach((item, position) => {
    if (!INSTANCE_ID.test(item.id)) {
      dropped.push({ id: `#${position}`, reason: 'invalid-item' });
      return;
    }
    if (seen.has(item.id)) {
      dropped.push({ id: item.id, reason: 'duplicate-id' });
      return;
    }
    seen.add(item.id);
    const entry = byId.get(item.widget);
    if (!isPlaceable(entry)) {
      dropped.push({ id: item.id, reason: 'unknown-widget' });
      return;
    }
    if (!context.may(entry)) {
      dropped.push({ id: item.id, reason: 'not-permitted' });
      return;
    }
    if (entry.grid?.singleton === true) {
      if (singletons.has(entry.id)) {
        dropped.push({ id: item.id, reason: 'singleton-repeated' });
        return;
      }
      singletons.add(entry.id);
    }
    const limits = limitsOf(entry);
    const w = whole(item.w, limits.minW, limits.maxW, clamp(limits.w, limits.minW, limits.maxW));
    const h = whole(item.h, limits.minH, limits.maxH, clamp(limits.h, limits.minH, limits.maxH));
    kept.push({
      id: item.id,
      widget: entry.id,
      x: whole(item.x, 0, COLUMNS - w, 0),
      y: whole(item.y, 0, MAX_Y, 0),
      w,
      h,
      config: repairConfig(entry, item.config),
    });
  });

  const items = pack(kept);
  while (items.length > 0 && bytes(documentOf(items)) > MAX_DOCUMENT_BYTES) {
    const last = items.pop()!;
    dropped.push({ id: last.id, reason: 'document-too-large' });
  }
  return { items, dropped };
}

// ---- the default dashboard -----------------------------------------------------------------------------

/** A short id from the widget's id, the same every time (a hash, not a random value: the default is stored nowhere). */
function defaultInstanceId(widget: string, taken: ReadonlySet<string>): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < widget.length; i += 1) {
    hash = Math.imul(hash ^ widget.charCodeAt(i), 0x01000193) >>> 0;
  }
  let id = `d${hash.toString(36).padStart(7, '0')}`;
  while (taken.has(id)) id = `${id.slice(0, 11)}x`;
  return id;
}

/**
 * What a person with no stored document sees: the widgets of the dashboard slot that carry a `default`
 * placement and that the caller may see, in `order` (then id), each with its default configuration.
 */
export function defaultDashboard(
  entries: readonly PlaceableWidget[],
  may: (entry: PlaceableWidget) => boolean,
): ParsedDashboard['items'] {
  const taken = new Set<string>();
  const placed: RawItem[] = [];
  for (const entry of [...entries].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
    const at = entry.grid?.default;
    if (!isPlaceable(entry) || at === undefined || !may(entry)) continue;
    const id = defaultInstanceId(entry.id, taken);
    taken.add(id);
    placed.push({ id, widget: entry.id, ...at, config: defaultConfig(entry) });
  }
  return repair(placed.slice(0, MAX_ITEMS), { entries, may }).items;
}

const reset = (context: DashboardContext, resetReason: ResetReason): ParsedDashboard => ({
  items: defaultDashboard(context.entries, context.may),
  dropped: [],
  reset: true,
  resetReason,
});

// ---- the two directions --------------------------------------------------------------------------------

/**
 * A valid dashboard out of whatever was stored. Never throws and never trusts: a document the structure
 * refuses, one with more than 20 tiles, and one of a version this build does not know are replaced by the
 * default dashboard (`reset: true`, with the reason); anything else is repaired tile by tile (see `repair`).
 */
export function parseDashboard(raw: unknown, context: DashboardContext): ParsedDashboard {
  try {
    if (
      isPlainObject(raw) &&
      typeof raw.version === 'number' &&
      Number.isInteger(raw.version) &&
      raw.version > CURRENT_VERSION
    ) {
      return reset(context, 'newer-version');
    }
    const shape = storedDashboardSchema.safeParse(raw);
    if (!shape.success) return reset(context, 'invalid');
    const current = migrate(shape.data.version, shape.data);
    if (!current) return reset(context, 'invalid');
    const { items } = current as z.output<typeof storedDashboardSchema>;
    if (items.length > MAX_ITEMS) return reset(context, 'too-many-items');
    return { ...repair(items, context), reset: false };
  } catch {
    return reset(context, 'invalid');
  }
}

/**
 * The document to store for these tiles: the known keys only, at the current version. A `RangeError` rather
 * than a document the store would refuse: more than 20 tiles, or more than 8 KiB as JSON.
 */
export function serialiseDashboard(items: readonly DashboardItem[]): Dashboard {
  if (items.length > MAX_ITEMS) {
    throw new RangeError(`A dashboard has at most ${MAX_ITEMS} tiles.`);
  }
  const text = documentOf(items);
  if (bytes(text) > MAX_DOCUMENT_BYTES) {
    throw new RangeError(`A dashboard is at most ${MAX_DOCUMENT_BYTES} bytes as JSON.`);
  }
  return JSON.parse(text) as Dashboard;
}
