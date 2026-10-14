// The usage checks: a term that a row of this module uses is deactivated and never deleted; one nobody uses
// is deleted. And the save-time checks (`validateTerm`) that refuse an unknown or a deactivated term with a
// 422 that names the path. Real Postgres, the real vocabulary service of core.settings.
import { Invalid } from '@scorpion/contracts';
import { makeIndicator, makeKpiSet } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { useKpi, type KpiStarted } from '../test/harness.ts';
import {
  checkTerms,
  evaluationTermChecks,
  indicatorTermChecks,
  setRowTermChecks,
  setTermChecks,
} from './terms.ts';

const h = useKpi();
let n = 0;
const key = (prefix: string) => `${prefix}${++n}x${Math.random().toString(36).slice(2, 6)}`;

/** Gives a row of this module that uses the term `termKey` of `vocabulary`. */
const USERS: Record<string, (s: KpiStarted, termKey: string) => Promise<unknown>> = {
  'kpi.unit': (s, unit) => makeIndicator(s.pool, { unit }),
  'kpi.measured-by': (s, term) => makeIndicator(s.pool, { measuredBy: [term] }),
  'kpi.automation-tool': (s, term) => makeIndicator(s.pool, { canBeAutomatedBy: [term] }),
  'kpi.service-category': (s, rimoCategory) => makeKpiSet(s.pool, { rimoCategory }),
  'thematic-category': (s, thematic) => makeIndicator(s.pool, { thematic }),
  necessity: async (s, necessity) => {
    const indicator = await makeIndicator(s.pool);
    return makeKpiSet(s.pool, { indicators: [{ indicatorId: indicator.id, necessity }] });
  },
  aggregate: async (s, aggregate) => {
    const indicator = await makeIndicator(s.pool);
    return makeKpiSet(s.pool, {
      indicators: [{ indicatorId: indicator.id, necessity: 'mandatory' }],
      evaluation: { indicatorId: indicator.id, aggregate },
    });
  },
};

describe('the usage checks', () => {
  describe.each(Object.keys(USERS))('%s', (vocabulary) => {
    it('deactivates a term a row uses and keeps it valid for that row', async () => {
      const s = await h.start();
      const admin = await s.actor('admin');
      const termKey = key('used');
      await s.settings.vocabularies.createTerm(admin, vocabulary, {
        key: termKey,
        labels: { en: 'Used' },
      });
      await USERS[vocabulary]!(s, termKey);

      const result = await s.settings.vocabularies.removeTerm(admin, vocabulary, termKey);
      expect(result.outcome).toBe('deactivated');
      expect(result.term?.active).toBe(false);
      // Not offered for anything new, still accepted for the row that has it.
      await expect(
        s.settings.validateTerm(vocabulary, termKey, { path: 'x' }),
      ).rejects.toMatchObject({ status: 422 });
      await expect(
        s.settings.validateTerm(vocabulary, termKey, { allowInactive: true }),
      ).resolves.toBeUndefined();
    });

    it('deletes a term of the administrator that nothing uses', async () => {
      const s = await h.start();
      const admin = await s.actor('admin');
      const termKey = key('free');
      await s.settings.vocabularies.createTerm(admin, vocabulary, {
        key: termKey,
        labels: { en: 'Free' },
      });
      const result = await s.settings.vocabularies.removeTerm(admin, vocabulary, termKey);
      expect(result).toEqual({ outcome: 'deleted', term: null });
      await expect(s.settings.validateTerm(vocabulary, termKey)).rejects.toMatchObject({
        status: 422,
      });
    });
  });

  it('deactivates a seeded term and never deletes it, used or not', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    const result = await s.settings.vocabularies.removeTerm(admin, 'kpi.unit', 'second');
    expect(result.outcome).toBe('deactivated');
    await s.kernel.migrate();
    const units = await s.settings.listTerms('kpi.unit', { includeInactive: true });
    expect(units.find((term) => term.key === 'second')?.active).toBe(false);
  });

  it('asks only about its own rows: a unit in use does not hold a measured-by term of the same key', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    const shared = key('same');
    for (const vocabulary of ['kpi.unit', 'kpi.measured-by'])
      await s.settings.vocabularies.createTerm(admin, vocabulary, {
        key: shared,
        labels: { en: 'Same' },
      });
    await makeIndicator(s.pool, { unit: shared });
    expect(
      (await s.settings.vocabularies.removeTerm(admin, 'kpi.measured-by', shared)).outcome,
    ).toBe('deleted');
    expect((await s.settings.vocabularies.removeTerm(admin, 'kpi.unit', shared)).outcome).toBe(
      'deactivated',
    );
  });

  it('holds a term in two rows until neither exists is not claimed: the check is a presence test', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    const termKey = key('twice');
    await s.settings.vocabularies.createTerm(admin, 'thematic-category', {
      key: termKey,
      labels: { en: 'Twice' },
    });
    await makeIndicator(s.pool, { thematic: termKey });
    await makeIndicator(s.pool, { thematic: termKey });
    expect(
      (await s.settings.vocabularies.removeTerm(admin, 'thematic-category', termKey)).outcome,
    ).toBe('deactivated');
  });
});

describe('the save-time term checks', () => {
  it('accept active terms', async () => {
    const s = await h.start();
    await expect(
      checkTerms(s.settings, [
        ...indicatorTermChecks({ thematic: 'Usage', unit: 'second' }),
        ...setTermChecks({ rimoCategory: 'Web_API' }),
        ...setRowTermChecks([{ necessity: 'mandatory' }, { necessity: 'optional' }]),
        ...evaluationTermChecks({ aggregate: 'avg' }),
      ]),
    ).resolves.toBeUndefined();
  });

  it('ask for nothing when an optional term is not given', () => {
    expect(indicatorTermChecks({ thematic: 'Usage', unit: null })).toHaveLength(1);
    expect(setTermChecks({ rimoCategory: null })).toEqual([]);
    expect(setTermChecks({})).toEqual([]);
  });

  it('refuse an unknown term with a 422 that names the path', async () => {
    const s = await h.start();
    const failure = await checkTerms(
      s.settings,
      indicatorTermChecks({ thematic: 'Nonsense' }),
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Invalid);
    expect((failure as Invalid).errors).toEqual([
      expect.objectContaining({
        path: 'thematic',
        message: expect.stringContaining('Nonsense') as string,
      }),
    ]);
  });

  it('refuse a deactivated term for a new value and accept it when the row keeps it', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    await s.settings.vocabularies.updateTerm(admin, 'kpi.unit', 'byte', { active: false });
    const checks = (kept?: Set<string>) =>
      indicatorTermChecks({ thematic: 'Usage', unit: 'byte' }, kept);
    await expect(checkTerms(s.settings, checks())).rejects.toMatchObject({
      status: 422,
      errors: [
        expect.objectContaining({
          path: 'unit',
          message: expect.stringContaining('no longer') as string,
        }),
      ],
    });
    await expect(checkTerms(s.settings, checks(new Set(['unit'])))).resolves.toBeUndefined();
  });

  it('refuse a necessity of "" and an unknown necessity, naming the row (defect 14)', async () => {
    const s = await h.start();
    const failure = await checkTerms(
      s.settings,
      setRowTermChecks([{ necessity: 'mandatory' }, { necessity: '' }, { necessity: 'urgent' }]),
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Invalid);
    expect((failure as Invalid).errors?.map((problem) => problem.path)).toEqual([
      'indicators[1].necessity',
      'indicators[2].necessity',
    ]);
  });

  it('refuse a deactivated aggregate, a deactivated service category and an unknown means, all in one answer', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    await s.settings.vocabularies.updateTerm(admin, 'aggregate', 'sum', { active: false });
    await s.settings.vocabularies.updateTerm(admin, 'kpi.service-category', 'Script', {
      active: false,
    });
    const failure = await checkTerms(s.settings, [
      ...evaluationTermChecks({ aggregate: 'sum' }),
      ...setTermChecks({ rimoCategory: 'Script' }),
      ...indicatorTermChecks({
        thematic: 'Usage',
        measuredBy: ['ghost'],
        canBeAutomatedBy: ['phantom'],
      }),
    ]).catch((error: unknown) => error);
    expect((failure as Invalid).errors?.map((problem) => problem.path)).toEqual([
      'aggregate',
      'rimoCategory',
      'measuredBy[0]',
      'canBeAutomatedBy[0]',
    ]);
  });

  it('let a kept means of an update pass and check a new one', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    await s.settings.vocabularies.createTerm(admin, 'kpi.measured-by', {
      key: 'logs',
      labels: { en: 'Logs' },
    });
    await s.settings.vocabularies.updateTerm(admin, 'kpi.measured-by', 'logs', { active: false });
    const checks = indicatorTermChecks(
      { thematic: 'Usage', measuredBy: ['logs'] },
      new Set(['measuredBy:logs']),
    );
    await expect(checkTerms(s.settings, checks)).resolves.toBeUndefined();
    await expect(
      checkTerms(s.settings, indicatorTermChecks({ thematic: 'Usage', measuredBy: ['logs'] })),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('pass through an error that is not a refused term', async () => {
    const boom = new Error('database is down');
    await expect(
      checkTerms({ validateTerm: () => Promise.reject(boom) }, [
        { vocabulary: 'necessity', key: 'mandatory', path: 'x' },
      ]),
    ).rejects.toBe(boom);
  });
});
