// Pure helpers of the section "Publications": how authors, dates and the citation history are shown. No Svelte, so a unit test
// reads them in node (`format.test.ts`).
import type { ChartSpec } from '@scorpion/ui-kit';

/** At most three authors are named; above three, "first author et al.". An empty list names nobody. */
export function authorLine(
  authors: readonly string[],
  etAl: (first: string) => string,
): string | null {
  if (authors.length === 0) return null;
  if (authors.length > 3) return etAl(authors[0]!);
  return authors.join(', ');
}

/**
 * The issued date at the precision the agency knows: `2020` as a year, `2020-09` as month and year, `2020-09-16` as a date. In UTC,
 * so the server and the browser draw the same text.
 */
export function issuedText(issued: string | null | undefined, locale: string): string | null {
  if (!issued) return null;
  const [year, month, day] = issued.split('-').map(Number);
  if (month === undefined) return String(year);
  const date = new Date(Date.UTC(year!, month - 1, day ?? 1));
  const options: Intl.DateTimeFormatOptions =
    day === undefined
      ? { year: 'numeric', month: 'long', timeZone: 'UTC' }
      : { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

/** A day (`2026-06-15`, or a time) as a date in the person's language, in UTC. */
export function dayText(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(iso),
  );
}

/** The minutes to wait, rounded up, at least 1 (a 429's `Retry-After` is in seconds). */
export const waitMinutes = (seconds: number | undefined) =>
  Math.max(1, Math.ceil((seconds ?? 600) / 60));

/** The link of a DOI: `https://doi.org/` and the DOI with each path segment encoded (the DOI's own `/` stays a separator). */
export const doiHref = (doi: string) =>
  `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}`;

/** The history of one source as a line chart: one category per day, oldest first. */
export function historySpec(
  points: readonly { source: string; day: string; citedByCount: number }[],
  source: string | null,
  series: string,
  locale: string,
): ChartSpec | null {
  const mine = points.filter((point) => source === null || point.source === source);
  if (mine.length === 0) return null;
  return {
    type: 'line',
    categories: mine.map((point) => dayText(point.day, locale)),
    series: [{ name: series, values: mine.map((point) => point.citedByCount) }],
  };
}
