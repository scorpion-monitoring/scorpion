// What the membership card of the dashboard says about the person's own rows (`GET /account/memberships`). Pure, so it is unit tested.

/** The fields of an own row the card needs. */
export interface OwnRow {
  state: string;
  organisation: { abbreviation: string; name: string };
}

/** The person's own side: the organisations whose answer they wait for (by name), and how many they belong to. */
export interface OwnView {
  /** The names of the first `MAX_NAMED_REQUESTS` waiting requests. */
  requested: string[];
  /** How many of the person's requests wait for a decision. */
  waiting: number;
  member: number;
}

/** The card lists at most this many waiting requests by name; the count says the rest. */
export const MAX_NAMED_REQUESTS = 5;

export function ownView(rows: readonly OwnRow[]): OwnView {
  const waiting = rows.filter((row) => row.state === 'requested');
  return {
    waiting: waiting.length,
    requested: waiting
      .map((row) => row.organisation.name || row.organisation.abbreviation)
      .slice(0, MAX_NAMED_REQUESTS),
    member: rows.filter((row) => row.state === 'approved').length,
  };
}
