// Defect 10 (FEATURES §5): the legacy dashboard took "no duration" to mean "no date filter", had a thematic filter list that was not the one of the
// defaults dialog, and opened on an arbitrary first service. Never weaken or delete this test.
//
//  1. no range is repaired to the default and **applied**;
//  2. `all` is a value, chosen explicitly, never the absence of one;
//  3. the thematic filter list of the reads (the dashboard) and of the defaults is **one** vocabulary read: a change of the vocabulary changes both;
//  4. no service chosen means "none", never an arbitrary first service.
import { makeMembership, makeOrganisation, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { parseDefaults } from './service/defaults.ts';
import { DEFAULT_RANGE, repairRange } from './service/range.ts';
import { useAnalytics } from './test/harness.ts';
import { analyticsWorld, paths, rejection, uniq } from './test/world.ts';

const h = useAnalytics();
const FIRST = { page: 0, pageSize: 50 };

describe('defect 10: the range', () => {
  it('repairs a missing range to the default and applies it, so an old value is not in the window', async () => {
    const w = await analyticsWorld(await h.start());
    await w.put(w.ind.downloads, '2024-01-31', 1);
    await w.put(w.ind.downloads, '2026-05-31', 2);
    expect(DEFAULT_RANGE).toBe('1y');
    for (const missing of [undefined, null, '', 5, {}, 'forever'] as const)
      expect(repairRange(missing)).toBe('1y');
    expect(parseDefaults({}, new Set()).range).toBe('1y');
    const result = await w.analytics.series(w.people.plain, { service: w.svc.id }, FIRST);
    expect(result.range).toBe('1y');
    expect(result.months).toHaveLength(12);
    const downloads = result.rows.find((row) => row.indicatorId === w.ind.downloads.id)!;
    expect(downloads.points.filter((p) => p.value !== null).map((p) => p.value)).toEqual([2]);
    const summary = await w.analytics.summary(w.people.plain, { service: w.svc.id }, FIRST);
    expect(summary.range).toBe('1y');
    expect(summary.rows.find((row) => row.indicatorId === w.ind.downloads.id)!.change).toBeNull();
  });

  it('refuses a range that is not one (never reads it as "no filter"), and `all` is explicit and reaches the old value', async () => {
    const w = await analyticsWorld(await h.start());
    await w.put(w.ind.downloads, '2024-01-31', 1);
    await w.put(w.ind.downloads, '2026-05-31', 2);
    for (const bad of ['', 'none', 'ALL', '0', 'unlimited'])
      expect(
        paths(
          await rejection(
            w.analytics.series(w.people.plain, { service: w.svc.id, range: bad }, FIRST),
          ),
        ),
      ).toEqual(['query:range']);
    const all = await w.analytics.series(
      w.people.plain,
      { service: w.svc.id, range: 'all' },
      FIRST,
    );
    expect(all.range).toBe('all');
    expect(all.months).toHaveLength(120);
    const downloads = all.rows.find((row) => row.indicatorId === w.ind.downloads.id)!;
    expect(downloads.points.filter((p) => p.value !== null).map((p) => p.value)).toEqual([1, 2]);
    expect(
      (
        await w.analytics.summary(w.people.plain, { service: w.svc.id, range: 'all' }, FIRST)
      ).rows.find((row) => row.indicatorId === w.ind.downloads.id)!.change,
    ).toBe(100);
  });
});

describe('defect 10: the thematic filter list is one vocabulary read', () => {
  it('shows a term added to the vocabulary in the filter of the reads and in the defaults, and drops it from both when it goes', async () => {
    const w = await analyticsWorld(await h.start());
    const key = uniq('Policy').replace(/[^A-Za-z0-9_-]/g, '-');
    const reads = (category: string) =>
      w.analytics.series(w.people.plain, { service: w.svc.id, category }, FIRST);
    const defaults = async () => {
      await w.settings.preferences.set(w.people.plain, 'kpi.analytics.defaults', { category: key });
      return (await w.analytics.defaults(w.people.plain)).category;
    };
    const listed = async () =>
      (await w.analytics.categories(w.people.plain)).map((term) => term.key);

    // before: unknown to the list, to the dashboard's filter and to the defaults
    expect(await listed()).not.toContain(key);
    expect(paths(await rejection(reads(key)))).toEqual(['query:category']);
    expect(await defaults()).toBe('all');

    await w.settings.vocabularies.createTerm(w.people.admin, 'thematic-category', {
      key,
      labels: { en: 'Policy' },
    });
    expect(await listed()).toContain(key);
    expect((await reads(key)).rows).toEqual([]); // known now: an empty list, not a 422
    expect(await defaults()).toBe(key);

    await w.settings.vocabularies.updateTerm(w.people.admin, 'thematic-category', key, {
      active: false,
    });
    expect(await listed()).not.toContain(key);
    expect(paths(await rejection(reads(key)))).toEqual(['query:category']);
    expect(await defaults()).toBe('all');
  });

  it('offers the same terms in the same order to both: the list is the vocabulary, not a list of the module', async () => {
    const w = await analyticsWorld(await h.start());
    const terms = await w.settings.listTerms('thematic-category');
    expect((await w.analytics.categories(w.people.plain)).map((term) => term.key)).toEqual(
      terms.map((term) => term.key),
    );
    for (const term of terms) {
      expect(
        (await w.analytics.series(w.people.plain, { service: w.svc.id, category: term.key }, FIRST))
          .range,
      ).toBe('1y');
      await w.settings.preferences.set(w.people.plain, 'kpi.analytics.defaults', {
        category: term.key,
      });
      expect((await w.analytics.defaults(w.people.plain)).category).toBe(term.key);
    }
  });
});

describe('defect 10: no service chosen means none', () => {
  it('has no default service for a person with no provider, however many services the instance has', async () => {
    const w = await analyticsWorld(await h.start());
    const other = await makeOrganisation(w.pool, { type: 'provider' });
    await makeService(w.pool, {
      provider: other.id,
      name: 'Aaa the first service of the instance',
    });
    expect((await w.analytics.defaults(w.people.plain)).service).toBeNull();
    expect(await w.analytics.defaultServiceOfAsSystem(w.people.plain.userId)).toBeNull();
  });

  it('takes, for a member, the first service of their provider by name: the same one every time, not whichever the database returns first', async () => {
    const w = await analyticsWorld(await h.start());
    const org = await makeOrganisation(w.pool, { type: 'provider' });
    const names = ['Mmm', 'Zzz', 'Aaa', 'Kkk'].map((name) => uniq(name));
    const created = [];
    for (const name of names) created.push(await makeService(w.pool, { provider: org.id, name }));
    await makeMembership(w.pool, {
      organisationId: org.id,
      userId: w.people.plain.userId,
      state: 'approved',
    });
    const aaa = created[names.findIndex((name) => name.startsWith('Aaa'))]!;
    for (let again = 0; again < 3; again++)
      expect((await w.analytics.defaults(w.people.plain)).service).toBe(aaa.id);
  });

  it('does not read without a service: the reads name the parameter, they do not pick one', async () => {
    const w = await analyticsWorld(await h.start());
    for (const read of [w.analytics.series, w.analytics.summary] as const)
      expect(
        paths(await rejection(read(w.people.plain, { service: undefined as never }, FIRST))),
      ).toEqual(['query:service']);
  });
});
