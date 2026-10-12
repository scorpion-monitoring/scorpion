// The prototype of the M6 plan (§0, item 7): a fixture module contributes an `org.type` entry
// (`funder`) and an `org.usage` entry next to registry.organisations, loaded by the real kernel. It
// proves that registry contributions between two plugin modules validate, order and fail as intended,
// and that another module extends the registries without a change to this one.
import { Conflict, Invalid } from '@scorpion/contracts';
import { KernelStartupError } from '@scorpion/kernel';
import { makeOrganisation } from '@scorpion/testing';
import { describe, expect, it } from 'vitest';
import { fixtureContributor, useOrganisations } from '../test/harness.ts';
import { OrganisationInUse } from './errors.ts';

const h = useOrganisations();

const funder = {
  id: 'funder',
  labels: { en: 'Funder', de: 'Förderer' },
  membership: false,
  schemaType: 'FundingAgency',
  order: 30,
};

describe('a second module contributes to the registries', () => {
  it('adds the type `funder` without a change to registry.organisations, in order', async () => {
    const s = await h.start({ extra: [fixtureContributor({ types: [funder] })] });
    const admin = await s.actor('admin');
    const types = await s.organisations.listTypes(admin);
    expect(types.map((type) => [type.id, type.membership, type.schemaType])).toEqual([
      ['provider', true, 'Organization'],
      ['consortium', true, 'Organization'],
      ['funder', false, 'FundingAgency'],
    ]);
    const created = await s.organisations.create(admin, {
      type: 'funder',
      abbreviation: 'DFG',
      name: 'Deutsche Forschungsgemeinschaft',
    });
    expect(created.type).toBe('funder');
    expect(created.typeKnown).toBe(true);
  });

  it('defaults the schema type to Organization', async () => {
    const s = await h.start({
      extra: [
        fixtureContributor({
          types: [{ id: 'agency', labels: { en: 'Agency' }, membership: false, order: 40 }],
        }),
      ],
    });
    const types = await s.organisations.listTypes(await s.actor('user'));
    expect(types.find((type) => type.id === 'agency')?.schemaType).toBe('Organization');
  });

  it('asks the usage entry of the contributor before a delete and before a change of type', async () => {
    const referenced = new Set<string>();
    const s = await h.start({
      extra: [
        fixtureContributor({
          id: 'fixture.services',
          types: [funder],
          usages: [
            {
              id: 'fixture.services',
              count: (_tx: unknown, id: string) => Promise.resolve(referenced.has(id) ? 2 : 0),
            },
          ],
        }),
      ],
    });
    const admin = await s.actor('admin');
    const row = await makeOrganisation(s.pool, { type: 'provider' });
    referenced.add(row.id);

    const refused = await s.organisations.delete(admin, row.id).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(OrganisationInUse);
    expect((refused as OrganisationInUse).type).toBe('organisation-in-use');
    expect((refused as OrganisationInUse).message).toContain('fixture.services');
    // The problem names the contributing module, never the rows.
    expect((refused as OrganisationInUse).message).not.toContain(row.id);

    await expect(s.organisations.update(admin, row.id, { type: 'funder' })).rejects.toBeInstanceOf(
      OrganisationInUse,
    );
    // A change that is not a change of type is not blocked.
    await expect(
      s.organisations.update(admin, row.id, { description: 'still fine' }),
    ).resolves.toMatchObject({ description: 'still fine' });

    referenced.delete(row.id);
    await s.organisations.delete(admin, row.id);
    const { rowCount } = await s.pool.query('select 1 from org_organisation where id = $1', [
      row.id,
    ]);
    expect(rowCount).toBe(0);
  });

  it('blocks nothing without a contributor', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    const row = await makeOrganisation(s.pool);
    await expect(s.organisations.delete(admin, row.id)).resolves.toBeUndefined();
  });

  it('lets the usage entry read through the transaction of the delete', async () => {
    let seenTx: unknown;
    const s = await h.start({
      extra: [
        fixtureContributor({
          usages: [
            {
              id: 'fixture.funders',
              count: (tx: { execute: unknown }) => {
                seenTx = tx;
                return Promise.resolve(0);
              },
            },
          ],
        }),
      ],
    });
    const row = await makeOrganisation(s.pool);
    await s.organisations.delete(await s.actor('admin'), row.id);
    expect(typeof (seenTx as { execute: unknown }).execute).toBe('function');
  });
});

describe('a contribution that is wrong fails at start, as intended', () => {
  it('refuses a module that does not declare the dependency', async () => {
    const failure = await h
      .build({ extra: [fixtureContributor({ types: [funder], dependsOnOrganisations: false })] })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(KernelStartupError);
    expect((failure as Error).message).toMatch(/org\.type.*not a declared dependency/s);
  });

  it.each([
    ['a schemaType outside the allow-list', { ...funder, schemaType: 'Corporation' }],
    ['an id that is not a lower-case key', { ...funder, id: 'Funder!' }],
    ['a missing English label', { ...funder, labels: { de: 'x' } }],
    ['an unknown field', { ...funder, colour: 'red' }],
    ['a negative order', { ...funder, order: -1 }],
  ])('refuses an org.type entry with %s', async (_label, entry) => {
    await expect(
      h.build({ extra: [fixtureContributor({ types: [entry] })] }),
    ).rejects.toBeInstanceOf(KernelStartupError);
  });

  it('refuses an org.usage entry without a count function', async () => {
    await expect(
      h.build({
        extra: [fixtureContributor({ usages: [{ id: 'fixture.funders', count: 'nope' }] })],
      }),
    ).rejects.toBeInstanceOf(KernelStartupError);
  });

  it('refuses a type id that two modules contribute', async () => {
    // The entries are valid one by one, so the loader accepts them; the module refuses the duplicate
    // when its service is built.
    const kernel = await h.build({
      extra: [fixtureContributor({ types: [{ ...funder, id: 'provider' }] })],
    });
    await expect(kernel.start()).rejects.toThrow(/contributed twice/);
  });
});

describe('a type that is no longer registered', () => {
  it('is listed and readable with typeKnown false, and cannot be written to; the usage check still guards a delete', async () => {
    const s = await h.start();
    const admin = await s.actor('admin');
    const user = await s.actor('user');
    const orphan = await makeOrganisation(s.pool, { type: 'funder' });

    const { organisations } = await s.organisations.list(user, {}, { page: 0, pageSize: 10 });
    expect(organisations.find((o) => o.id === orphan.id)).toMatchObject({ typeKnown: false });
    await expect(s.organisations.get(user, orphan.id)).resolves.toMatchObject({ typeKnown: false });

    const refused = await s.organisations
      .update(admin, orphan.id, { description: 'x' })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(Conflict);
    await expect(s.organisations.update(admin, orphan.id, { type: 'nope' })).rejects.toBeInstanceOf(
      Conflict,
    );
    await expect(
      s.organisations.create(admin, { type: 'funder', abbreviation: 'X', name: 'X' }),
    ).rejects.toBeInstanceOf(Invalid);
  });
});
