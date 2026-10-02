import { Conflict, Forbidden, Invalid, NotFound, Unauthorized } from '@scorpion/contracts';
import { KernelStartupError } from '@scorpion/kernel';
import { makeVocabulary } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { breakOutbox, termsInUse, useSettings } from '../test/harness.ts';
import { collectDefinitions } from './vocabularies.ts';

const harness = useSettings();
const ANONYMOUS = { kind: 'anonymous' } as const;

async function setup(options: Parameters<typeof harness.start>[0] = {}) {
  const started = await harness.start(options);
  return {
    ...started,
    admin: await started.actorOf('admin'),
    member: await started.actorOf('user'),
    nobody: await started.actorOf(),
    service: started.settings.vocabularies,
  };
}

const keys = (terms: { key: string }[]) => terms.map((term) => term.key);
const changes = async (pool: { query: (text: string) => Promise<{ rows: unknown[] }> }) =>
  (
    (await pool.query(
      "select payload from kernel_outbox where name = 'settings.vocabulary.changed@1' order by id",
    )) as { rows: { payload: Record<string, string> }[] }
  ).rows.map((row) => row.payload);

describe('the built-in vocabularies (seeds)', () => {
  it('has the five vocabularies of FEATURES, with the values of the legacy app', async () => {
    const { settings } = await setup();
    expect(keys(await settings.listTerms('stage'))).toEqual(['DEV', 'DEMO', 'PROD', 'TERM']);
    expect(keys(await settings.listTerms('thematic-category'))).toEqual([
      'Bibliographic',
      'Usage',
      'Technical',
      'Satisfaction',
    ]);
    expect(keys(await settings.listTerms('necessity'))).toEqual([
      'mandatory',
      'recommended',
      'optional',
    ]);
    expect(keys(await settings.listTerms('sender-type'))).toEqual(['System', 'Reviewer']);
    expect(keys(await settings.listTerms('aggregate'))).toEqual(['sum', 'avg', 'min', 'max']);
  });

  it('adds TERM as a stage (defect 9) with a label', async () => {
    const { settings } = await setup();
    const term = (await settings.listTerms('stage')).find((t) => t.key === 'TERM');
    expect(term).toMatchObject({ label: 'Terminated', active: true });
  });

  it("is idempotent: a second start changes nothing, and keeps an administrator's edit", async () => {
    const first = await setup();
    await first.service.updateTerm(first.admin, 'stage', 'PROD', {
      labels: { en: 'Operational' },
      sortOrder: 99,
    });
    const before = await first.kernel.pool.query(
      'select * from settings_vocabulary_term order by vocabulary_id, key',
    );
    const second = await harness.start({ databaseUrl: first.databaseUrl });
    const after = await second.kernel.pool.query(
      'select * from settings_vocabulary_term order by vocabulary_id, key',
    );
    expect(after.rows).toEqual(before.rows);
    expect(await second.settings.listTerms('stage', { locale: 'en' })).toContainEqual(
      expect.objectContaining({ key: 'PROD', label: 'Operational', sortOrder: 99 }),
    );
  });

  it('adds a term a module newly declares, without touching the others', async () => {
    const first = await setup();
    await first.kernel.pool.query(
      "delete from settings_vocabulary_term where vocabulary_id = 'stage' and key = 'DEMO'",
    );
    const second = await harness.start({ databaseUrl: first.databaseUrl });
    expect(keys(await second.settings.listTerms('stage'))).toEqual(['DEV', 'DEMO', 'PROD', 'TERM']);
  });

  it('takes the terms and the usage check of a module that declares a vocabulary', async () => {
    const { settings } = await setup();
    expect(await settings.listTerms('fix.widgets.size', { locale: 'de' })).toEqual([
      expect.objectContaining({ key: 'L', label: 'Large', sortOrder: 5 }),
      expect.objectContaining({ key: 'S', label: 'Klein', sortOrder: 10 }),
      expect.objectContaining({ key: 'M', label: 'Medium', sortOrder: 20 }),
    ]);
  });
});

describe('collectDefinitions', () => {
  const entry = (extra: Record<string, unknown>) => ({ id: 'v', description: 'D', ...extra });
  it.each([
    ['an id that is not kebab case', [entry({ id: 'Bad_Id' })], 'id must be'],
    [
      'a term key that starts with a digit',
      [entry({ terms: [{ key: '1a', labels: { en: 'x' } }] })],
      'key',
    ],
    [
      'a term without an English label',
      [entry({ terms: [{ key: 'a', labels: { de: 'x' } }] })],
      'en',
    ],
    ['an empty label', [entry({ terms: [{ key: 'a', labels: { en: ' ' } }] })], 'labels'],
    ['a bad locale', [entry({ terms: [{ key: 'a', labels: { en: 'x', EN_us: 'y' } }] })], 'labels'],
    ['an unknown field', [entry({ colour: 'red' })], 'colour'],
    [
      'the same term twice',
      [
        entry({ terms: [{ key: 'a', labels: { en: 'x' } }] }),
        entry({ terms: [{ key: 'a', labels: { en: 'y' } }] }),
      ],
      'declared twice',
    ],
    ['no description at all', [{ id: 'v', terms: [] }], 'no description'],
  ])('refuses %s', (_name, entries, message) => {
    expect(() => collectDefinitions(entries)).toThrow(KernelStartupError);
    expect(() => collectDefinitions(entries)).toThrow(new RegExp(message));
  });

  it('merges entries of one id: terms add up, one description is enough, usage checks collect', () => {
    const usage = () => Promise.resolve(false);
    const merged = collectDefinitions([
      { id: 'v', description: 'D', terms: [{ key: 'a', labels: { en: 'A' } }] },
      { id: 'v', usage },
      { id: 'v', terms: [{ key: 'b', labels: { en: 'B' }, sortOrder: 1 }] },
    ]).get('v')!;
    expect(merged.terms.map((t) => [t.key, t.sortOrder])).toEqual([
      ['a', 10],
      ['b', 1],
    ]);
    expect(merged.usage).toEqual([usage]);
  });
});

describe('reading', () => {
  it('lists the vocabularies with their counts, and the terms in order (a User may)', async () => {
    const { service, member } = await setup();
    const all = await service.list(member);
    expect(all.map((v) => v.id)).toEqual([
      'aggregate',
      'fix.widgets.size',
      'necessity',
      'sender-type',
      'stage',
      'thematic-category',
    ]);
    expect(all.find((v) => v.id === 'stage')).toMatchObject({ terms: 4, activeTerms: 4 });
    expect(keys(await service.listTerms(member, 'stage'))).toEqual(['DEV', 'DEMO', 'PROD', 'TERM']);
  });

  it('answers NotFound for a vocabulary nobody declares', async () => {
    const { service, member, settings } = await setup();
    await expect(service.listTerms(member, 'nope')).rejects.toBeInstanceOf(NotFound);
    await expect(settings.listTerms('nope')).rejects.toBeInstanceOf(NotFound);
  });

  it('hides deactivated terms from a User, and shows them to whoever may write', async () => {
    const { service, admin, member } = await setup();
    await service.updateTerm(admin, 'stage', 'DEMO', { active: false });
    expect(keys(await service.listTerms(member, 'stage'))).toEqual(['DEV', 'PROD', 'TERM']);
    expect(keys(await service.listTerms(admin, 'stage', { includeInactive: true }))).toEqual([
      'DEV',
      'DEMO',
      'PROD',
      'TERM',
    ]);
    await expect(
      service.listTerms(member, 'stage', { includeInactive: true }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it('denies a user without roles and an anonymous caller', async () => {
    const { service, nobody } = await setup();
    await expect(service.list(nobody)).rejects.toBeInstanceOf(Forbidden);
    await expect(service.listTerms(nobody, 'stage')).rejects.toBeInstanceOf(Forbidden);
    await expect(service.list(ANONYMOUS)).rejects.toBeInstanceOf(Unauthorized);
  });
});

describe('validateTerm', () => {
  it('accepts an active term, refuses an unknown one and one that is deactivated', async () => {
    const { settings, service, admin } = await setup();
    await expect(settings.validateTerm('stage', 'PROD')).resolves.toBeUndefined();
    await expect(settings.validateTerm('stage', 'LIVE', { path: 'stage' })).rejects.toMatchObject({
      status: 422,
      errors: [{ path: 'stage', message: expect.stringContaining('not a term') as unknown }],
    });
    await service.updateTerm(admin, 'stage', 'PROD', { active: false });
    await expect(settings.validateTerm('stage', 'PROD')).rejects.toBeInstanceOf(Invalid);
    await expect(
      settings.validateTerm('stage', 'PROD', { allowInactive: true }),
    ).resolves.toBeUndefined();
  });

  it('is case sensitive, like the keys that are stored', async () => {
    const { settings } = await setup();
    await expect(settings.validateTerm('stage', 'prod')).rejects.toBeInstanceOf(Invalid);
  });
});

describe('creating a term', () => {
  it('adds it after the last one, active, not seeded, and says so in an event without labels', async () => {
    const { service, admin, kernel } = await setup();
    const term = await service.createTerm(admin, 'stage', {
      key: 'BETA',
      labels: { en: 'Beta', de: 'Beta-Phase' },
    });
    expect(term).toMatchObject({ key: 'BETA', sortOrder: 50, active: true, seeded: false });
    expect(keys(await service.listTerms(admin, 'stage'))).toEqual([
      'DEV',
      'DEMO',
      'PROD',
      'TERM',
      'BETA',
    ]);
    const [event] = await changes(kernel.pool);
    expect(event).toEqual({ vocabulary: 'stage', key: 'BETA', change: 'created' });
    expect(JSON.stringify(event)).not.toContain('Beta-Phase');
  });

  it.each([
    ['a key that is not allowed', { key: 'a b', labels: { en: 'x' } }],
    ['a missing English label', { key: 'X', labels: { de: 'x' } }],
    ['an unknown field', { key: 'X', labels: { en: 'x' }, seeded: true }],
    ['a sort order that is not a whole number', { key: 'X', labels: { en: 'x' }, sortOrder: 1.5 }],
  ])('refuses %s with 422 and writes nothing', async (_name, input) => {
    const { service, admin, kernel } = await setup();
    await expect(service.createTerm(admin, 'stage', input)).rejects.toBeInstanceOf(Invalid);
    expect((await service.listTerms(admin, 'stage')).length).toBe(4);
    expect(await changes(kernel.pool)).toEqual([]);
  });

  it('refuses a key that exists, also a deactivated one', async () => {
    const { service, admin } = await setup();
    await expect(
      service.createTerm(admin, 'stage', { key: 'PROD', labels: { en: 'Again' } }),
    ).rejects.toBeInstanceOf(Conflict);
    await service.updateTerm(admin, 'stage', 'DEMO', { active: false });
    await expect(
      service.createTerm(admin, 'stage', { key: 'DEMO', labels: { en: 'Again' } }),
    ).rejects.toBeInstanceOf(Conflict);
  });

  it('refuses a vocabulary nobody declares', async () => {
    const { service, admin } = await setup();
    await expect(
      service.createTerm(admin, 'nope', { key: 'X', labels: { en: 'x' } }),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it('is denied to a User, a user without roles and an anonymous caller, and writes nothing', async () => {
    const { service, member, nobody, kernel } = await setup();
    const input = { key: 'EVIL', labels: { en: 'x' } };
    await expect(service.createTerm(member, 'stage', input)).rejects.toBeInstanceOf(Forbidden);
    await expect(service.createTerm(nobody, 'stage', input)).rejects.toBeInstanceOf(Forbidden);
    await expect(service.createTerm(ANONYMOUS, 'stage', input)).rejects.toBeInstanceOf(
      Unauthorized,
    );
    expect(
      (await kernel.pool.query("select 1 from settings_vocabulary_term where key = 'EVIL'")).rows,
    ).toEqual([]);
    expect(await changes(kernel.pool)).toEqual([]);
  });

  it('rolls the term back when its event cannot be written', async () => {
    const { service, admin, kernel } = await setup();
    const restore = await breakOutbox(kernel.pool);
    await expect(
      service.createTerm(admin, 'stage', { key: 'X', labels: { en: 'x' } }),
    ).rejects.toThrow();
    await restore();
    expect((await service.listTerms(admin, 'stage')).length).toBe(4);
  });

  it('gives two concurrent creations different sort orders and refuses the duplicate', async () => {
    const { service, admin } = await setup();
    const results = await Promise.allSettled([
      service.createTerm(admin, 'stage', { key: 'A1', labels: { en: 'a' } }),
      service.createTerm(admin, 'stage', { key: 'A2', labels: { en: 'a' } }),
      service.createTerm(admin, 'stage', { key: 'A2', labels: { en: 'b' } }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(2);
    const orders = (await service.listTerms(admin, 'stage')).map((t) => t.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });
});

describe('updating a term', () => {
  it('changes labels and order, not the key, and reports what happened', async () => {
    const { service, admin, kernel } = await setup();
    await service.updateTerm(admin, 'stage', 'DEV', { labels: { en: 'Dev', de: 'Entwicklung' } });
    await service.updateTerm(admin, 'stage', 'TERM', { sortOrder: 1 });
    await service.updateTerm(admin, 'stage', 'DEMO', { active: false });
    await service.updateTerm(admin, 'stage', 'DEMO', { active: true });
    expect(keys(await service.listTerms(admin, 'stage'))).toEqual(['TERM', 'DEV', 'DEMO', 'PROD']);
    expect((await changes(kernel.pool)).map((c) => c.change)).toEqual([
      'updated',
      'updated',
      'deactivated',
      'activated',
    ]);
  });

  it('writes and emits nothing for a patch that changes nothing', async () => {
    const { service, admin, kernel } = await setup();
    await service.updateTerm(admin, 'stage', 'DEV', {
      labels: { en: 'Development' },
      sortOrder: 10,
    });
    expect(await changes(kernel.pool)).toEqual([]);
  });

  it.each([
    ['an empty patch', {}],
    ['a new key', { key: 'OTHER' }],
    ['a seeded flag', { seeded: false }],
    ['labels without English', { labels: { de: 'x' } }],
  ])('refuses %s', async (_name, patch) => {
    const { service, admin } = await setup();
    await expect(service.updateTerm(admin, 'stage', 'DEV', patch)).rejects.toBeInstanceOf(Invalid);
  });

  it('answers NotFound for a term or vocabulary that does not exist', async () => {
    const { service, admin } = await setup();
    await expect(
      service.updateTerm(admin, 'stage', 'NOPE', { active: false }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      service.updateTerm(admin, 'nope', 'DEV', { active: false }),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it('is denied without the write permission', async () => {
    const { service, member, nobody, kernel } = await setup();
    await expect(
      service.updateTerm(member, 'stage', 'DEV', { active: false }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      service.updateTerm(nobody, 'stage', 'DEV', { active: false }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      service.updateTerm(ANONYMOUS, 'stage', 'DEV', { active: false }),
    ).rejects.toBeInstanceOf(Unauthorized);
    expect(
      (await kernel.pool.query("select active from settings_vocabulary_term where key = 'DEV'"))
        .rows,
    ).toEqual([{ active: true }]);
  });

  it('rolls back when the event cannot be written', async () => {
    const { service, admin, kernel } = await setup();
    const restore = await breakOutbox(kernel.pool);
    await expect(service.updateTerm(admin, 'stage', 'DEV', { active: false })).rejects.toThrow();
    await restore();
    expect(
      (await kernel.pool.query("select active from settings_vocabulary_term where key = 'DEV'"))
        .rows,
    ).toEqual([{ active: true }]);
  });
});

describe('removing a term', () => {
  it("deletes a term of the administrator's own that nothing uses", async () => {
    const { service, admin, kernel } = await setup();
    await service.createTerm(admin, 'stage', { key: 'BETA', labels: { en: 'Beta' } });
    const result = await service.removeTerm(admin, 'stage', 'BETA');
    expect(result).toEqual({ outcome: 'deleted', term: null });
    expect(keys(await service.listTerms(admin, 'stage', { includeInactive: true }))).not.toContain(
      'BETA',
    );
    expect((await changes(kernel.pool)).map((c) => c.change)).toEqual(['created', 'deleted']);
  });

  it('deactivates instead when a module says the term is in use', async () => {
    const { service, admin, member } = await setup();
    await service.createTerm(admin, 'stage', { key: 'BETA', labels: { en: 'Beta' } });
    termsInUse.add('stage:BETA');
    const result = await service.removeTerm(admin, 'stage', 'BETA');
    expect(result).toMatchObject({ outcome: 'deactivated', term: { key: 'BETA', active: false } });
    expect(keys(await service.listTerms(member, 'stage'))).not.toContain('BETA');
    expect(keys(await service.listTerms(admin, 'stage', { includeInactive: true }))).toContain(
      'BETA',
    );
    // Asking again is the same answer, and writes no second event.
    expect((await service.removeTerm(admin, 'stage', 'BETA')).outcome).toBe('deactivated');
  });

  it('never deletes a term a module declared: it is deactivated, and the next start does not bring it back', async () => {
    const { service, admin, databaseUrl } = await setup();
    expect((await service.removeTerm(admin, 'stage', 'TERM')).outcome).toBe('deactivated');
    const restarted = await harness.start({ databaseUrl });
    expect(keys(await restarted.settings.listTerms('stage'))).toEqual(['DEV', 'DEMO', 'PROD']);
    expect(keys(await restarted.settings.listTerms('stage', { includeInactive: true }))).toContain(
      'TERM',
    );
  });

  it("checks the usage of a vocabulary's own terms too", async () => {
    const { service, admin } = await setup();
    await service.createTerm(admin, 'fix.widgets.size', {
      key: 'XL',
      labels: { en: 'Extra large' },
    });
    termsInUse.add('fix.widgets.size:XL');
    expect((await service.removeTerm(admin, 'fix.widgets.size', 'XL')).outcome).toBe('deactivated');
  });

  it('answers NotFound, and is denied without the write permission', async () => {
    const { service, admin, member, nobody, kernel } = await setup();
    await expect(service.removeTerm(admin, 'stage', 'NOPE')).rejects.toBeInstanceOf(NotFound);
    await expect(service.removeTerm(member, 'stage', 'DEV')).rejects.toBeInstanceOf(Forbidden);
    await expect(service.removeTerm(nobody, 'stage', 'DEV')).rejects.toBeInstanceOf(Forbidden);
    await expect(service.removeTerm(ANONYMOUS, 'stage', 'DEV')).rejects.toBeInstanceOf(
      Unauthorized,
    );
    expect(
      (await kernel.pool.query("select active from settings_vocabulary_term where key = 'DEV'"))
        .rows,
    ).toEqual([{ active: true }]);
  });

  it('rolls a deletion back when the event cannot be written', async () => {
    const { service, admin, kernel } = await setup();
    await service.createTerm(admin, 'stage', { key: 'BETA', labels: { en: 'Beta' } });
    const restore = await breakOutbox(kernel.pool);
    await expect(service.removeTerm(admin, 'stage', 'BETA')).rejects.toThrow();
    await restore();
    expect(keys(await service.listTerms(admin, 'stage'))).toContain('BETA');
  });
});

describe('the factory', () => {
  it('makes terms that the service reads in order', async () => {
    const { kernel, admin, service } = await setup();
    await makeVocabulary(kernel.pool, {
      id: 'stage',
      terms: [{ key: 'EXTRA', label: 'Extra', sortOrder: 5 }],
    });
    expect(keys(await service.listTerms(admin, 'stage'))[0]).toBe('EXTRA');
  });
});
