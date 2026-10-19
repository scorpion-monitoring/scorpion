// `resolveIndicatorRef`: which indicator of a service's effective KPI set a reference means. The one function the legacy `kpi` of
// `POST /api/v1/measurements` and the column headers of the file adapters (sprint 3) both use. Table-driven; pure.
import { describe, expect, it } from 'vitest';
import { resolveIndicatorRef, type IndicatorChoice } from './names.ts';

// built from code points: an editor or a formatter may turn an escape into the raw character
const E_ACUTE = String.fromCharCode(0xe9);
const COMBINING_ACUTE = String.fromCharCode(0x301);
const A = '0198f3a8-9e03-7a52-b4c7-81d05f2e6a47';
const B = '0198f3a8-9e03-7a52-b4c7-81d05f2e6a48';
const C = '0198f3a8-9e03-7a52-b4c7-81d05f2e6a49';
const D = '0198f3a8-9e03-7a52-b4c7-81d05f2e6a4a';
const choices: IndicatorChoice[] = [
  { indicatorId: A, name: 'Page views' },
  { indicatorId: B, name: `Caf${E_ACUTE} visits` },
  { indicatorId: C, name: 'Uptime' },
  { indicatorId: D, name: 'uptime' },
];

describe('resolveIndicatorRef', () => {
  it.each([
    ['an id', A, A],
    ['an id in capitals', A.toUpperCase(), A],
    ['an id with spaces around it', `  ${A}  `, A],
    ['a name', 'Page views', A],
    ['a name in other case', 'PAGE VIEWS', A],
    ['a name with spaces around it', '  page views ', A],
    ['a name with a composed é', `Caf${E_ACUTE} visits`, B],
    ['a name with a decomposed é', `Cafe${COMBINING_ACUTE} visits`, B],
    ['an id of an indicator whose name is another one’s', C, C],
  ])('finds the indicator for %s', (_, reference, id) => {
    expect(resolveIndicatorRef(choices, reference)).toEqual({ ok: true, indicatorId: id });
  });

  it.each([
    ['an empty text', ''],
    ['spaces', '   '],
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['an object', {}],
    ['a list', ['Page views']],
  ])('says what is wanted for %s', (_, reference) => {
    expect(resolveIndicatorRef(choices, reference)).toEqual({
      ok: false,
      problem: 'must be the name or the id of an indicator',
    });
  });

  it('refuses a name or an id that no choice has, without repeating it', () => {
    for (const reference of ['Downloads', 'Page view', '0198f3a8-0000-7a52-b4c7-81d05f2e6a47']) {
      const found = resolveIndicatorRef(choices, reference);
      expect(found).toEqual({ ok: false, problem: 'is not one of the KPIs of this service' });
      if (!found.ok) expect(found.problem).not.toContain(reference);
    }
  });

  it('refuses a name that two choices have (they differ only in case), and still takes either by id', () => {
    expect(resolveIndicatorRef(choices, 'uptime')).toEqual({
      ok: false,
      problem: 'matches more than one KPI of this service: use the id of the indicator',
    });
    expect(resolveIndicatorRef(choices, 'UPTIME')).toMatchObject({ ok: false });
    expect(resolveIndicatorRef(choices, C)).toEqual({ ok: true, indicatorId: C });
    expect(resolveIndicatorRef(choices, D)).toEqual({ ok: true, indicatorId: D });
  });

  it('knows nothing of an empty set: every reference is unknown', () => {
    expect(resolveIndicatorRef([], 'Page views')).toEqual({
      ok: false,
      problem: 'is not one of the KPIs of this service',
    });
  });

  it('does not match part of a name, and does not take a name that merely looks like an id', () => {
    expect(resolveIndicatorRef(choices, 'Page')).toMatchObject({ ok: false });
    const odd: IndicatorChoice[] = [{ indicatorId: A, name: B }];
    // `B` is the name of A here and the id of nothing: the name path finds it
    expect(resolveIndicatorRef(odd, B)).toEqual({ ok: true, indicatorId: A });
  });
});
