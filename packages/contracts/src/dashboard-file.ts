// The file a person exports their dashboard to and imports it from (M13c, ADR-0055). The browser writes it from the
// document it holds; the server reads it at `POST /ui/dashboard/import`, checks the structure with its own Zod schema and
// repairs the tiles for the importing person. Pure: no Zod, no Svelte, no I/O, so both sides can use it.
//
// The file carries nothing personal: no instance, user or time inside (the date is only in the file name).

/** What `format` says in every dashboard file. */
export const DASHBOARD_FILE_FORMAT = 'scorpion.dashboard';
/** The version of the dashboard document the export writes (the `CURRENT_VERSION` of `core.ui-shell`). */
export const DASHBOARD_FILE_VERSION = 1;
/** The largest file the page reads before it sends anything: far more than a dashboard of 8 KiB needs. */
export const MAX_DASHBOARD_FILE_BYTES = 64 * 1024;

export interface DashboardFileItem {
  id: string;
  widget: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, unknown>;
}

export interface DashboardFile {
  format: typeof DASHBOARD_FILE_FORMAT;
  version: number;
  items: DashboardFileItem[];
}

/** The file for these tiles: the known keys only, in this order, so two exports of one dashboard are the same bytes. */
export function dashboardFile(items: readonly DashboardFileItem[]): DashboardFile {
  return {
    format: DASHBOARD_FILE_FORMAT,
    version: DASHBOARD_FILE_VERSION,
    items: items.map(({ id, widget, x, y, w, h, config }) => ({ id, widget, x, y, w, h, config })),
  };
}

/** `dashboard-2026-11-24.json`, from the local date of `now`. */
export function dashboardFileName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `dashboard-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

export type ReadDashboardFile =
  | { ok: true; file: DashboardFile }
  | { ok: false; reason: 'too-large' | 'not-json' | 'not-dashboard' | 'newer-version' };

/**
 * The first look the page takes at a chosen file, so an obvious mistake is named before anything is sent: too large,
 * not JSON, not a dashboard file, or made by a newer Scorpion. The server checks everything again.
 */
export function readDashboardFile(text: string): ReadDashboardFile {
  if (new TextEncoder().encode(text).length > MAX_DASHBOARD_FILE_BYTES) {
    return { ok: false, reason: 'too-large' };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'not-dashboard' };
  }
  const file = value as Record<string, unknown>;
  if (
    file.format !== DASHBOARD_FILE_FORMAT ||
    typeof file.version !== 'number' ||
    !Number.isInteger(file.version) ||
    file.version < 1 ||
    !Array.isArray(file.items)
  ) {
    return { ok: false, reason: 'not-dashboard' };
  }
  if (file.version > DASHBOARD_FILE_VERSION) return { ok: false, reason: 'newer-version' };
  return { ok: true, file: file as unknown as DashboardFile };
}
