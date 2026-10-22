// The numbers of the dashboard grid, shared by the widget entry (registries.ts) and the stored document
// (service/dashboard). The grid has one desktop layout of twelve columns (M11 plan §3, decision 8).

/** Columns of the grid. */
export const COLUMNS = 12;
/** The tallest a tile may be, in rows. */
export const MAX_ROWS = 50;
/** The lowest row a stored tile may start at; the packer never needs more (20 tiles of `MAX_ROWS`). */
export const MAX_Y = 1000;
/** Tiles on one dashboard. */
export const MAX_ITEMS = 20;
/** The size of a tile whose widget entry has no `grid` (the cards that predate the grid). */
export const DEFAULT_SIZE = { w: 4, h: 3 } as const;
/** A tile's own configuration, as JSON (UTF-8 bytes). */
export const MAX_CONFIG_BYTES = 400;
/** The stored document, as JSON: the cap of the preference store (`core.settings`). */
export const MAX_DOCUMENT_BYTES = 8 * 1024;
/** The version `serialiseDashboard` writes; `migrate` brings older ones up to it. */
export const CURRENT_VERSION = 1;
/** The slot whose widgets are placed on the dashboard. The other slots (`header`) are not tiles. */
export const DASHBOARD_SLOT = 'dashboard';
/** The id of a tile: 4 to 12 lower-case letters and digits, unique in the document. */
export const INSTANCE_ID = /^[a-z0-9]{4,12}$/;
/** The lowest row any stored tile can have after the packer has moved overlapping tiles down. */
export const MAX_PACKED_Y = MAX_Y + MAX_ITEMS * MAX_ROWS;
