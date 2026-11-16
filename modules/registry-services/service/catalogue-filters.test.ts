// The look of the catalogues' faceted search (sprint 3 of M12a, items 6 and Q4), over real Postgres: the setting
// is read by both list answers; the upgrade step at start stores `sidebar` for an instance that already has
// services and the default for a new one, once, never over an administrator's choice; and only an administrator
// may change it.
import { Forbidden } from '@scorpion/contracts';
import { makeOrganisation, makeService } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CATALOGUE_FILTERS } from '../settings-schema.ts';
import { useServices, type ServicesStarted } from '../test/harness.ts';

const h = useServices();

const stored = async (s: ServicesStarted) =>
  (
    await s.pool.query<{ value: Record<string, unknown>; version: number }>(
      `select value, version from settings_setting where module_id = 'registry.services'`,
    )
  ).rows[0];

/** The database as an instance from before sprint 3 left it: settings without the key. */
const forgetLook = (s: ServicesStarted) =>
  s.pool.query(
    `update settings_setting set value = value - 'catalogueFilters' where module_id = 'registry.services'`,
  );

describe('the upgrade step (decision Q4)', () => {
  it('stores the default for a new instance when the kernel starts', async () => {
    const s = await h.start();
    expect((await stored(s))?.value).toEqual({ catalogueFilters: DEFAULT_CATALOGUE_FILTERS });
    expect(await s.services.catalogueFilters()).toBe(DEFAULT_CATALOGUE_FILTERS);
  });

  it('keeps sidebar for an instance that has services, and keeps its other stored settings', async () => {
    const s = await h.start();
    await s.configure({ exposeContactPoint: false, allowPublic: true });
    await forgetLook(s);
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    await makeService(s.pool, { provider: provider.id });
    expect(await s.services.upgradeCatalogueFiltersAsSystem()).toBe('seeded');
    expect((await stored(s))?.value).toEqual({
      exposeContactPoint: false,
      allowPublic: true,
      catalogueFilters: 'sidebar',
    });
    expect(await s.services.catalogueFilters()).toBe('sidebar');
  });

  it('runs once: a second start, or a second process, finds the key and changes nothing', async () => {
    const s = await h.start();
    const before = await stored(s);
    const events = (await s.events()).length;
    expect(await s.services.upgradeCatalogueFiltersAsSystem()).toBe('kept');
    expect(await stored(s)).toEqual(before);
    expect(await s.events()).toHaveLength(events);
  });

  it('never overwrites the look an administrator chose', async () => {
    const s = await h.start();
    await s.configure({ catalogueFilters: 'bar' });
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    await makeService(s.pool, { provider: provider.id });
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
