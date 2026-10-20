// What the reporting reminder asks (M10 sprint 5): for each provider, the services that lack a value for a mandatory indicator in a
// month. Pure: the job reads the services, the effective KPI sets and the measurements and hands them here, so the rule is one
// tested function and no test depends on a clock or a database.
//
// The rule: a service is **missing** when one indicator of its effective KPI set *now* has the necessity `mandatory` and has no
// measurement for the month. The set now, not the set the month had (plan §11): an indicator the service has dropped is not asked
// for, though its measurements stay; a measurement of such an indicator does not stand in for another. A service with no KPI set has
// no mandatory indicator and so nothing missing. A service with two providers is named to each of them (the data model allows it,
// the seed role says one; see the README).
import { daysInMonth } from './period.ts';

export interface NamedIndicator {
  id: string;
  name: string;
}

/** One service as the job read it. */
export interface ReminderCandidate {
  serviceId: string;
  name: string;
  /** The organisations in the role provider; an empty list means nobody is asked. */
  providerIds: readonly string[];
  /** The indicators of the effective set now whose necessity is the mandatory term. */
  mandatory: readonly NamedIndicator[];
  /** The ids of the indicators that have a value for the month (any indicator, a dropped one included). */
  present: readonly string[];
}

export interface MissingService {
  serviceId: string;
  name: string;
  /** The mandatory indicators without a value, by name without case, then id. */
  missing: NamedIndicator[];
}

export interface ProviderMissing {
  providerId: string;
  /** By name without case, then id. */
  services: MissingService[];
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase());
const byNameThenId = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  byName(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The providers that have at least one service with a mandatory indicator and no value, by provider id; each with its services. */
export function selectMissing(candidates: readonly ReminderCandidate[]): ProviderMissing[] {
  const byProvider = new Map<string, MissingService[]>();
  for (const candidate of candidates) {
    const present = new Set(candidate.present);
    const missing = candidate.mandatory.filter((indicator) => !present.has(indicator.id));
    if (missing.length === 0) continue;
    const entry: MissingService = {
      serviceId: candidate.serviceId,
      name: candidate.name,
      missing: [...missing].sort(byNameThenId),
    };
    for (const providerId of new Set(candidate.providerIds)) {
      const list = byProvider.get(providerId) ?? [];
      list.push(entry);
      byProvider.set(providerId, list);
    }
  }
  return [...byProvider.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([providerId, services]) => ({
      providerId,
      services: [...services].sort(
        (a, b) =>
          byName(a, b) || (a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0),
      ),
    }));
}

/**
 * The month before the one `now` is in, in UTC: `month` is `YYYY-MM` (the link and the mail), `period` the last day of it
 * (how a measurement is keyed). January gives December of the year before.
 */
export function previousMonth(now: Date): { month: string; period: string } {
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth(); // 0-based: the month before is this value as a 1-based number
  if (month === 0) {
    year -= 1;
    month = 12;
  }
  const mm = String(month).padStart(2, '0');
  const yyyy = String(year).padStart(4, '0');
  return {
    month: `${yyyy}-${mm}`,
    period: `${yyyy}-${mm}-${String(daysInMonth(year, month)).padStart(2, '0')}`,
  };
}
