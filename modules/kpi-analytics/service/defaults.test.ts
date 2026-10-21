// The defaults preference `kpi.analytics.defaults`: the pure parse (table-driven and fast-check) and the service that reads a person's own.
import { Invalid } from '@scorpion/contracts';
import { makeMembership, makeOrganisation, makeService } from '@scorpion/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { useAnalytics } from '../test/harness.ts';
import { analyticsWorld, rejection, uniq } from '../test/world.ts';
import { ALL_CATEGORIES, parseDefaults } from './defaults.ts';
import { RANGES } from './range.ts';

const SERVICE = '0198f3a8-5b21-7d40-9c1e-2a7f6b3d9e10';
const categories = new Set(['Usage', 'Technical']);

describe('parseDefaults', () => {
  const rows: [string, unknown, unknown][] = [
    ['nothing stored', undefined, { range: '1y', category: 'all' }],
    ['null', null, { range: '1y', category: 'all' }],
    ['not an object', 'x', { range: '1y', category: 'all' }],
    ['an array', [1], { range: '1y', category: 'all' }],
    [
      'a full value',
      { service: SERVICE, range: '6m', category: 'Usage' },
      { service: SERVICE, range: '6m', category: 'Usage' },
    ],
    ['no range is repaired to 1y', { category: 'Usage' }, { range: '1y', category: 'Usage' }],
    ['an unknown range is repaired', { range: '5y' }, { range: '1y', category: 'all' }],
    ['all is a range', { range: 'all' }, { range: 'all', category: 'all' }],
    ['an unknown category is dropped', { category: 'Gone' }, { range: '1y', category: 'all' }],
    ['all is a category', { category: ALL_CATEGORIES }, { range: '1y', category: 'all' }],
    ['a service that is no id is dropped', { service: 'abc' }, { range: '1y', category: 'all' }],
    ['a service of the wrong type', { service: 5 }, { range: '1y', category: 'all' }],
    [
      'an upper-case id is lower-cased',
      { service: SERVICE.toUpperCase() },
      { service: SERVICE, range: '1y', category: 'all' },
    ],
    ['unknown keys are not carried', { extra: 1, range: '2y' }, { range: '2y', category: 'all' }],
  ];
  it.each(rows)('%s', (_name, raw, expected) => {
    expect(parseDefaults(raw, categories)).toEqual(expected);
  });

  it('never throws and always yields a valid value, whatever is stored', () => {
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        const result = parseDefaults(raw, categories);
        expect(RANGES).toContain(result.range);
        expect(result.category === 'all' || categories.has(result.category)).toBe(true);
        if (result.service !== undefined) expect(result.service).toMatch(/^[0-9a-f-]{36}$/);
        expect(parseDefaults(result, categories)).toEqual(result);
      }),
      { numRuns: 500 },
    );
    fc.assert(
      fc.property(
        fc.record(
          { service: fc.anything(), range: fc.anything(), category: fc.anything() },
          { requiredKeys: [] },
        ),
        (raw) => {
          expect(() => parseDefaults(raw, categories)).not.toThrow();
        },
      ),
    );
  });
});

describe("defaults(actor): a person's own", () => {
  const h = useAnalytics();

  it('is the default range and category and no service for a person with nothing stored and no provider', async () => {
    const w = await analyticsWorld(await h.start());
    expect(await w.analytics.defaults(w.people.plain)).toEqual({
      service: null,
      range: '1y',
      category: 'all',
    });
  });

  it('is the stored value, with the service it names while it exists', async () => {
    const w = await analyticsWorld(await h.start());
    await w.settings.preferences.set(w.people.plain, 'kpi.analytics.defaults', {
      service: w.svc.id,
      range: '2y',
      category: 'Technical',
    });
    expect(await w.analytics.defaults(w.people.plain)).toEqual({
      service: w.svc.id,
      range: '2y',
      category: 'Technical',
    });
    // another person's defaults are not read
    expect((await w.analytics.defaults(w.people.admin)).range).toBe('1y');
  });

  it('refuses a bad range, a bad service and an unknown key when it is stored (422)', async () => {
    const w = await analyticsWorld(await h.start());
    for (const bad of [{ range: '5y' }, { service: 'abc' }, { category: '' }, { extra: 1 }])
      expect(
        await rejection(w.settings.preferences.set(w.people.plain, 'kpi.analytics.defaults', bad)),
      ).toBeInstanceOf(Invalid);
  });

  it('drops a stored service that no longer exists and a category that left the vocabulary', async () => {
    const w = await analyticsWorld(await h.start());
    await w.settings.preferences.set(w.people.plain, 'kpi.analytics.defaults', {
      service: SERVICE,
      category: 'Retired',
    });
    expect(await w.analytics.defaults(w.people.plain)).toEqual({
      service: null,
      range: '1y',
      category: 'all',
    });
  });

  it("takes, with no service stored, the first service of the person's providers by name, and none of a provider they do not belong to", async () => {
    const w = await analyticsWorld(await h.start());
    const other = await makeOrganisation(w.pool, { type: 'provider' });
    const second = await makeOrganisation(w.pool, { type: 'provider' });
    const stranger = await makeService(w.pool, {
      provider: other.id,
      name: 'A first by name, but not theirs',
    });
    const zed = await makeService(w.pool, { provider: second.id, name: uniq('Zed service') });
    const alpha = await makeService(w.pool, { provider: second.id, name: uniq('Alpha service') });
    await makeMembership(w.pool, {
      organisationId: second.id,
      userId: w.people.plain.userId,
      state: 'approved',
    });
    expect(await w.analytics.defaultServiceOfAsSystem(w.people.plain.userId)).toBe(alpha.id);
    expect((await w.analytics.defaults(w.people.plain)).service).toBe(alpha.id);
    expect([alpha.id, zed.id]).not.toContain(stranger.id);
    // a requested membership gives no tie
    const third = await makeOrganisation(w.pool, { type: 'provider' });
    await makeService(w.pool, { provider: third.id, name: uniq('A') });
    await makeMembership(w.pool, {
      organisationId: third.id,
      userId: w.people.admin.userId,
      state: 'requested',
    });
    expect(await w.analytics.defaultServiceOfAsSystem(w.people.admin.userId)).toBeNull();
  });
});
