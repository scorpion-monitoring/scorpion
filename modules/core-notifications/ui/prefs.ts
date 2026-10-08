// The notification preference form as plain functions: which switches the person sees, and what is stored.
// The stored value (`notifications.preferences`) is an object `{ category: { email?, inApp? } }` in which a
// missing switch means "on"; saving replaces the whole object, so a category this profile does not know
// (stored under an older profile) is carried over, never dropped.
export interface Category {
  category: string;
  description: { en: string; de: string } | null;
  /** Every template of the category is mandatory: its switches do nothing and are shown locked. */
  mandatory: boolean;
  templates: string[];
}

export type Stored = Record<string, { email?: boolean; inApp?: boolean }>;

export interface Row {
  category: string;
  mandatory: boolean;
  email: boolean;
  inApp: boolean;
}

/** The stored value if it has the shape this form writes; anything else is "nothing stored". */
export function storedOf(value: unknown): Stored {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Stored = {};
  for (const [category, entry] of Object.entries(value)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { email, inApp } = entry as Record<string, unknown>;
    out[category] = {
      ...(typeof email === 'boolean' ? { email } : {}),
      ...(typeof inApp === 'boolean' ? { inApp } : {}),
    };
  }
  return out;
}

export function rowsOf(categories: readonly Category[], stored: Stored): Row[] {
  return categories.map(({ category, mandatory }) => ({
    category,
    mandatory,
    // A mandatory category is on whatever is stored.
    email: mandatory || stored[category]?.email !== false,
    inApp: mandatory || stored[category]?.inApp !== false,
  }));
}

/** What to store: only the switches that are off (a missing one means on), plus the categories the form does not show. */
export function valueOf(rows: readonly Row[], previous: Stored): Stored {
  const shown = new Set(rows.map((row) => row.category));
  const value: Stored = {};
  for (const [category, entry] of Object.entries(previous)) {
    if (!shown.has(category)) value[category] = entry;
  }
  for (const row of rows) {
    if (row.mandatory) continue;
    const off = {
      ...(row.email ? {} : { email: false }),
      ...(row.inApp ? {} : { inApp: false }),
    };
    if (Object.keys(off).length > 0) value[row.category] = off;
  }
  return value;
}

export const sameRows = (a: readonly Row[], b: readonly Row[]): boolean =>
  a.length === b.length &&
  a.every(
    (row, i) =>
      row.email === b[i]!.email && row.inApp === b[i]!.inApp && row.category === b[i]!.category,
  );

/** The text of a category in the language of the page, English when there is none for it. */
export function describe(category: Category, locale: string): string | undefined {
  const text = category.description;
  if (!text) return undefined;
  return locale === 'de' ? text.de : text.en;
}

export interface Link {
  href: string;
  /** Another site: the page opens it in a new tab with no opener. */
  external: boolean;
}

/**
 * The address of an inbox item's link, or `undefined` when it is not a plain http(s) address (a stored
 * `javascript:` address must never become a link). An address on this site is returned as a path, so the
 * page stays in the application under its base path.
 */
export function linkOf(link: string | null, origin: string): Link | undefined {
  if (!link) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(link, origin);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  if (parsed.origin === origin) {
    return { href: `${parsed.pathname}${parsed.search}${parsed.hash}`, external: false };
  }
  return { href: parsed.href, external: true };
}
