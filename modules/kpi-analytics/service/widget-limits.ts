// The limits of a widget's configuration, apart from the Zod schemas (`widget-config.ts`) so the browser half can use them without loading Zod.

/** The most KPIs whose state a trends chart keeps in all its lists together; 14 short ids and the rest of a configuration fit 400 bytes. */
export const MAX_SERIES_STATES = 14;
/** The longest category key a configuration holds (the vocabulary's keys are short words). */
export const MAX_CATEGORY_LENGTH = 32;
/** A KPI in a configuration: the last 12 hex digits of its id. */
export const SHORT_ID = /^[0-9a-f]{12}$/;

/** The windows a widget offers; the module's own list, kept here so the browser half can use it without the server code. */
export const RANGES = ['3m', '6m', '1y', '2y', 'all'] as const;
