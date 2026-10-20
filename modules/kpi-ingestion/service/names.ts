// Which indicator a person or a program means (M10 sprint 2). The legacy API named an indicator by its **name** (`kpi`), a file
// names it by a column header, a form by its id. One pure function turns a reference into the id of an indicator of the service's
// effective KPI set, or says why it cannot: `POST /api/v1/measurements` uses it per item, and the file adapters of sprint 3 use it
// per column, so a name means the same thing on every path in. It reads nothing: the caller hands it the effective set.

/** An indicator of the effective KPI set of a service: what a reference is matched against. */
export interface IndicatorChoice {
  indicatorId: string;
  name: string;
}

export type IndicatorRefResult = { ok: true; indicatorId: string } | { ok: false; problem: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A name without case and without the difference between composed and decomposed letters. */
const fold = (text: string) => text.normalize('NFC').toLowerCase();

/**
 * The id of the indicator `reference` names among `choices` (the effective KPI set of one service):
 *
 *  1. an **id** (a UUID, any case) of a choice;
 *  2. otherwise a **name without case** (surrounding spaces ignored; `é` composed or decomposed is the same letter) that exactly
 *     one choice has.
 *
 * Refused, each with a sentence that never repeats the input: not a text, empty, a name that no choice has (including a real
 * indicator the service does not report), and a name that **more than one** choice has (two indicators whose names differ only in
 * case; the sentence says to use the id). Pure.
 */
export function resolveIndicatorRef(
  choices: readonly IndicatorChoice[],
  reference: unknown,
): IndicatorRefResult {
  if (typeof reference !== 'string' || reference.trim() === '')
    return { ok: false, problem: 'must be the name or the id of an indicator' };
  const wanted = reference.trim();
  if (UUID.test(wanted)) {
    const byId = choices.find(
      (choice) => choice.indicatorId.toLowerCase() === wanted.toLowerCase(),
    );
    if (byId) return { ok: true, indicatorId: byId.indicatorId };
  }
  const folded = fold(wanted);
  const named = choices.filter((choice) => fold(choice.name.trim()) === folded);
  if (named.length === 1) return { ok: true, indicatorId: named[0]!.indicatorId };
  if (named.length > 1)
    return {
      ok: false,
      problem: 'matches more than one KPI of this service: use the id of the indicator',
    };
  return { ok: false, problem: 'is not one of the KPIs of this service' };
}
