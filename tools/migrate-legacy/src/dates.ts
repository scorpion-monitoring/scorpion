// The dates of legacy measurements. InfluxDB stores a time; the API and the S3 backups print it with Python's `str()`
// (`2023-01-01 00:00:00+00:00`). A point written as `YYYY-MM` sits on the first of the month at midnight; a point written
// with a full date (the legacy route accepts both) sits on that day. The new model keeps one value per month.

export interface LegacyDate {
  /** `YYYY-MM`, the month the point counts for. */
  month: string;
  year: number;
  /** 1 to 12. */
  monthNumber: number;
  day: number;
  /** The instant, for "the latest point in the month wins". */
  time: number;
  /** On the first of the month at midnight UTC, as a `YYYY-MM` point is stored. */
  firstOfMonth: boolean;
}

// `YYYY-MM-DD`, then optionally a time with a `T` or a space, optional fractions, and an offset (`Z` or `±HH:MM`).
const DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Parses a legacy date; `undefined` for anything that is not a real calendar date in one of the shapes above. */
export function parseLegacyDate(value: string): LegacyDate | undefined {
  const match = DATE.exec(value.trim());
  if (!match) return undefined;
  const [, y, m, d, hh = '00', mm = '00', ss = '00', zone = 'Z'] = match;
  const year = Number(y);
  const monthNumber = Number(m);
  const day = Number(d);
  if (monthNumber < 1 || monthNumber > 12 || day < 1) return undefined;
  if (day > new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()) return undefined;
  if (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) return undefined;
  const offset =
    zone === 'Z' ? 'Z' : zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const time = Date.parse(`${y}-${m}-${d}T${hh}:${mm}:${ss}${offset}`);
  if (Number.isNaN(time)) return undefined;
  // The month of the instant in UTC: a point at 23:00-01:00 on the last day belongs to the next month, as InfluxDB has it.
  const at = new Date(time);
  const utcYear = at.getUTCFullYear();
  const utcMonth = at.getUTCMonth() + 1;
  return {
    month: `${String(utcYear).padStart(4, '0')}-${String(utcMonth).padStart(2, '0')}`,
    year: utcYear,
    monthNumber: utcMonth,
    day: at.getUTCDate(),
    time,
    firstOfMonth:
      at.getUTCDate() === 1 &&
      at.getUTCHours() === 0 &&
      at.getUTCMinutes() === 0 &&
      at.getUTCSeconds() === 0,
  };
}
