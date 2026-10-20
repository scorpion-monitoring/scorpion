// The rule of the reporting reminder as a pure function (plan §9 tests): all present, one missing, no KPI set, a dropped KPI, a
// service of two providers, a year end. No database, no clock.
import { describe, expect, it } from 'vitest';
import { previousMonth, selectMissing, type ReminderCandidate } from './reminder-select.ts';

const A = '00000000-0000-7000-8000-00000000000a';
const B = '00000000-0000-7000-8000-00000000000b';
const ind = (id: string, name = id.toUpperCase()) => ({ id, name });

const svc = (serviceId: string, over: Partial<ReminderCandidate> = {}): ReminderCandidate => ({
  serviceId,
  name: `Service ${serviceId}`,
  providerIds: [A],
  mandatory: [ind('i1'), ind('i2')],
  present: [],
  ...over,
});

/** `[providerId, [[serviceId, [indicator ids]]]]`, the shape the cases below compare. */
const shape = (candidates: ReminderCandidate[]) =>
  selectMissing(candidates).map((p) => [
    p.providerId,
    p.services.map((s) => [s.serviceId, s.missing.map((m) => m.id)]),
  ]);

describe('selectMissing', () => {
  it.each<[string, ReminderCandidate[], unknown]>([
    ['nothing at all', [], []],
    [
      'all mandatory values present: nothing is missing',
      [svc('s1', { present: ['i1', 'i2'] })],
      [],
    ],
    [
      'one value missing: the service and that indicator',
      [svc('s1', { present: ['i1'] })],
      [[A, [['s1', ['i2']]]]],
    ],
    ['no value at all: every mandatory indicator', [svc('s1')], [[A, [['s1', ['i1', 'i2']]]]]],
    [
      'a service with no KPI set has no mandatory indicator, so nothing is missing',
      [svc('s1', { mandatory: [], present: [] })],
      [],
    ],
    [
      'a service whose set has only recommended and optional indicators has nothing mandatory',
      [svc('s1', { mandatory: [], present: ['x'] })],
      [],
    ],
    [
      'a dropped KPI is not asked for: its stored value is not mandatory now, and it stands in for no other',
      // `gone` has a measurement but is no longer in the set; the one mandatory indicator left has none.
      [svc('s1', { mandatory: [ind('i2')], present: ['gone'] })],
      [[A, [['s1', ['i2']]]]],
    ],
    [
      'a dropped KPI that was the only gap: the service is complete now',
      [svc('s1', { mandatory: [ind('i1')], present: ['i1', 'gone'] })],
      [],
    ],
    [
      'a value for an indicator that is not mandatory does not count for a mandatory one',
      [svc('s1', { mandatory: [ind('i1')], present: ['optional'] })],
      [[A, [['s1', ['i1']]]]],
    ],
    [
      'two providers: each is asked about its own services only',
      [
        svc('s1', { providerIds: [A], present: ['i1'] }),
        svc('s2', { providerIds: [B], present: ['i2'] }),
      ],
      [
        [A, [['s1', ['i2']]]],
        [B, [['s2', ['i1']]]],
      ],
    ],
    [
      'a service of two providers is named to each of them, once',
      [svc('s1', { providerIds: [A, B, A], present: ['i1'] })],
      [
        [A, [['s1', ['i2']]]],
        [B, [['s1', ['i2']]]],
      ],
    ],
    [
      'a provider with one complete and one incomplete service is asked about the incomplete one only',
      [svc('s1', { present: ['i1', 'i2'] }), svc('s2', { present: ['i2'] })],
      [[A, [['s2', ['i1']]]]],
    ],
    ['a service with no provider asks nobody', [svc('s1', { providerIds: [] })], []],
  ])('%s', (_name, candidates, expected) => {
    expect(shape(candidates)).toEqual(expected);
  });

  it('orders providers by id, services by name without case then id, and indicators by name without case then id', () => {
    const out = selectMissing([
      svc('s3', {
        name: 'beta',
        providerIds: [B],
        mandatory: [ind('z', 'Zeta'), ind('a', 'alpha')],
      }),
      svc('s2', { name: 'Alpha', providerIds: [A] }),
      svc('s1', { name: 'alpha', providerIds: [A] }),
      svc('s4', { name: 'Beta', providerIds: [A] }),
    ]);
    expect(out.map((p) => p.providerId)).toEqual([A, B]);
    expect(out[0]!.services.map((s) => s.serviceId)).toEqual(['s1', 's2', 's4']);
    expect(out[1]!.services[0]!.missing.map((m) => m.name)).toEqual(['alpha', 'Zeta']);
  });

  it('does not change its input', () => {
    const input = [svc('s1', { providerIds: [A, B] })];
    const copy = structuredClone(input);
    selectMissing(input);
    expect(input).toEqual(copy);
  });
});

describe('previousMonth', () => {
  it.each([
    ['2026-10-06T06:00:00Z', '2026-09', '2026-09-30'],
    ['2026-03-06T06:00:00Z', '2026-02', '2026-02-28'],
    ['2024-03-06T06:00:00Z', '2024-02', '2024-02-29'],
    ['2100-03-06T06:00:00Z', '2100-02', '2100-02-28'],
    ['2000-03-06T06:00:00Z', '2000-02', '2000-02-29'],
    ['2026-05-06T06:00:00Z', '2026-04', '2026-04-30'],
    ['2026-08-06T06:00:00Z', '2026-07', '2026-07-31'],
    // A year end: the month before January is December of the year before.
    ['2026-01-06T06:00:00Z', '2025-12', '2025-12-31'],
    ['2026-01-01T00:00:00Z', '2025-12', '2025-12-31'],
    ['2026-12-28T23:59:59Z', '2026-11', '2026-11-30'],
    // The month is the UTC one: late on the 31st of January in UTC is still January.
    ['2026-02-01T00:00:00Z', '2026-01', '2026-01-31'],
  ])('%s → %s', (now, month, period) => {
    expect(previousMonth(new Date(now))).toEqual({ month, period });
  });
});
