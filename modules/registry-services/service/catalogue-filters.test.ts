// The look of the catalogues' faceted search (sprint 3 of M12a, items 6 and Q4), over real Postgres: the setting
// is read by both list answers; the upgrade step at start stores `sidebar` once for an instance with a service from
// before the looks, writes nothing for a new one, never overwrites an administrator's choice; and only an
// administrator may change it.
import { Forbidden } from '@scorpion/contracts';
import { makeOrganisation, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { CATALOGUE_FILTERS_SINCE, DEFAULT_CATALOGUE_FILTERS } from '../settings-schema.ts';
import { useServices, type ServicesStarted } from '../test/harness.ts';

const h = useServices();

const stored = async (s: ServicesStarted) =>
  (
    await s.pool.query<{ value: Record<string, unknown>; version: number }>(
      `select value, version from settings_setting where module_id = 'registry.services'`,
    )
  ).rows[0];

describe('the upgrade step (decision Q4)', () => {
  /** A service of this module's own table, made before the looks came (an instance from before the sprint). */
  async function serviceFromBefore(s: ServicesStarted) {
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    const made = await makeService(s.pool, { provider: provider.id });
    await s.pool.query(`update svc_service set created_at = $2 where id = $1`, [
      made.id,
      new Date(CATALOGUE_FILTERS_SINCE.getTime() - 86_400_000),
    ]);
    return made;
  }

  it('writes nothing for a new instance: the default applies, and the start leaves no event', async () => {
    const s = await h.start();
    expect(await stored(s)).toBeUndefined();
    expect(await s.services.catalogueFilters()).toBe(DEFAULT_CATALOGUE_FILTERS);
    expect(await s.events()).toEqual([]);
  });

  it('keeps sidebar for an instance with a service from before the looks, and keeps its other settings', async () => {
    const s = await h.start();
    await s.configure({ exposeContactPoint: false, allowPublic: true });
    await serviceFromBefore(s);
    expect(await s.services.upgradeCatalogueFiltersAsSystem()).toBe('seeded');
    expect((await stored(s))?.value).toEqual({
      exposeContactPoint: false,
      allowPublic: true,
      catalogueFilters: 'sidebar',
    });
    expect(await s.services.catalogueFilters()).toBe('sidebar');
  });

  it('never pins a new instance whose services came later, however often it starts', async () => {
    const s = await h.start();
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    await makeService(s.pool, { provider: provider.id });
    expect(await s.services.upgradeCatalogueFiltersAsSystem()).toBe('kept');
    expect(await stored(s)).toBeUndefined();
    expect(await s.services.catalogueFilters()).toBe(DEFAULT_CATALOGUE_FILTERS);
  });

  it('runs once: a second start, or a second process, finds the key and changes nothing', async () => {
    const s = await h.start();
    await serviceFromBefore(s);
    expect(await s.services.upgradeCatalogueFiltersAsSystem()).toBe('seeded');
    const before = await stored(s);
    const events = (await s.events()).length;
    expect(await s.services.upgradeCatalogueFiltersAsSystem()).toBe('kept');
    expect(await stored(s)).toEqual(before);
    expect(await s.events()).toHaveLength(events);
  });

  it('never overwrites the look an administrator chose', async () => {
    const s = await h.start();
    await s.configure({ catalogueFilters: 'bar' });
    await serviceFromBefore(s);
    expect(await s.services.upgradeCatalogueFiltersAsSystem()).toBe('kept');
    expect(await s.services.catalogueFilters()).toBe('bar');
  });
});

describe('the setting', () => {
  it('is changed by an administrator and read by the service', async () => {
    const s = await h.start();
    await s.configure({ catalogueFilters: 'bar' });
    expect(await s.services.catalogueFilters()).toBe('bar');
  });

  it('cannot be changed by a signed-in person who is no administrator, and nothing is stored', async () => {
    const s = await h.start();
    await s.configure({ exposeContactPoint: true });
    const plain = await s.actor('user');
    const before = await stored(s);
    await expect(s.configureAs(plain, { catalogueFilters: 'bar' })).rejects.toBeInstanceOf(
      Forbidden,
    );
    expect(await stored(s)).toEqual(before);
    expect(await s.services.catalogueFilters()).toBe(DEFAULT_CATALOGUE_FILTERS);
  });

  it('refuses a look that does not exist', async () => {
    const s = await h.start();
    await expect(s.configure({ catalogueFilters: 'carousel' })).rejects.toMatchObject({
      status: 422,
    });
  });
});
