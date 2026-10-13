// The prototype of plan §0 item 5 and the contract of the five registries: a fixture module contributes a
// field type, a wizard step, an organisation role and a facet, loaded by the real kernel next to
// registry.services, and a deliberately wrong entry of each kind fails at load with a message that names the
// module. The real kernel, the real database.
import { z } from '@scorpion/contracts';
import { makeOrganisation } from '@scorpion/testing';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fixtureContributor, useServices } from '../test/harness.ts';
import { SEED_FACETS } from './facets.ts';
import { SEED_FIELD_TYPES } from './field-types.ts';
import {
  facetEntrySchema,
  fieldTypeEntrySchema,
  orgRoleEntrySchema,
  SEED_ORG_ROLES,
  wizardStepEntrySchema,
} from './registries.ts';

const h = useServices();

/** Builds and starts a profile with these fixtures; a bad entry fails in either step (composition or start). */
const load = async (...extra: ReturnType<typeof fixtureContributor>[]) => {
  const kernel = await h.build({ extra });
  await kernel.start();
};

// A field type like the `kpi-set` one M9 will contribute: its own schema, config and widget.
const kpiSetType = {
  id: 'kpi-set',
  labels: { en: 'KPI set' },
  widget: 'kpi-set',
  storages: ['value'],
  configSchema: z.strictObject({}),
  schema: () => z.string().min(1).max(40),
  jsonSchema: () => ({ type: 'string', minLength: 1, maxLength: 40 }),
};
const categoryStep = {
  id: 'category',
  order: 15,
  title: 'fixture.step.category.title',
  intro: ['fixture.step.category.intro'],
  fields: [
    {
      key: 'category',
      path: '/category',
      type: 'kpi-set',
      label: 'fixture.field.category.label',
      required: true,
      storage: { kind: 'value' },
    },
    {
      key: 'funder',
      path: '/funder',
      type: 'organisation',
      label: 'fixture.field.funder.label',
      storage: { kind: 'organisations', role: 'funder' },
    },
  ],
};
const funderRole = {
  id: 'funder',
  labels: { en: 'Funder' },
  orgTypes: ['funder'],
  min: 0,
  max: 1,
  order: 30,
};
const categoryFacet = {
  id: 'category',
  labels: { en: 'Category' },
  order: 50,
  emptyLabel: { en: 'Uncategorized' },
  where: () => sql`true`,
  values: () => Promise.resolve([]),
};
const funderType = {
  id: 'funder',
  labels: { en: 'Funder' },
  membership: false,
  schemaType: 'FundingAgency',
  order: 30,
};

const good = () =>
  fixtureContributor({
    contributes: {
      'org.type': [funderType],
      'service.fieldType': [kpiSetType],
      'service.wizardStep': [categoryStep],
      'service.orgRole': [funderRole],
      'service.facet': [categoryFacet],
    },
  });

describe('a module that extends the registries', () => {
  it('adds a field type, a step, an organisation role and a facet without a change to this module', async () => {
    const s = await h.start({ extra: [good()] });
    const admin = await s.actor('admin');
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    const funder = await makeOrganisation(s.pool, { type: 'funder' });
    const created = await s.services.create(admin, {
      slug: 'fx-category-1',
      name: 'Service with a category',
      provider: provider.id,
      category: 'genomics',
      funder: funder.id,
    });
    // The contributed field type stored its value, the contributed role linked the funder.
    expect(created.values).toEqual({ category: 'genomics' });
    expect(created.organisations.map((o) => o.role)).toEqual(['provider', 'funder']);
    // The role is listed for the form next to the module's own.
    expect((await s.services.listRoles(admin)).map((r) => r.id)).toEqual([
      'provider',
      'consortium',
      'funder',
    ]);
  });

  it('runs the contributed field type’s own validation (the step is part of the create body)', async () => {
    const s = await h.start({ extra: [good()] });
    const admin = await s.actor('admin');
    const provider = await makeOrganisation(s.pool, { type: 'provider' });
    await expect(
      s.services.create(admin, { slug: 'fx-category-2', name: 'x', provider: provider.id }),
    ).rejects.toMatchObject({ status: 422, errors: [{ path: 'category' }] });
    await expect(
      s.services.create(admin, {
        slug: 'fx-category-3',
        name: 'x',
        provider: provider.id,
        category: 'x'.repeat(41),
      }),
    ).rejects.toMatchObject({ status: 422, errors: [{ path: 'category' }] });
  });
});

describe('a wrong entry fails at load and the message names the module', () => {
  const wrong: [string, Record<string, unknown[]>, RegExp][] = [
    [
      'a field type without a widget',
      { 'service.fieldType': [{ ...kpiSetType, widget: undefined }] },
      /fixture\.extras: registry "service\.fieldType" entry 0\.widget/,
    ],
    [
      'a wizard step with an order that is not a number',
      { 'service.wizardStep': [{ ...categoryStep, order: 'first' }] },
      /fixture\.extras: registry "service\.wizardStep" entry 0\.order/,
    ],
    [
      'an organisation role whose min exceeds its max',
      { 'service.orgRole': [{ ...funderRole, min: 3, max: 1 }] },
      /fixture\.extras: registry "service\.orgRole" entry 0\.min: min must not exceed max/,
    ],
    [
      'a facet whose where is not a function',
      { 'service.facet': [{ ...categoryFacet, where: 'true' }] },
      /fixture\.extras: registry "service\.facet" entry 0\.where/,
    ],
    [
      'a profile contributor without contribute',
      { 'service.profileContributor': [{ id: 'category' }] },
      /fixture\.extras: registry "service\.profileContributor" entry 0\.contribute/,
    ],
  ];
  it.each(wrong)('%s', async (_label, contributes, message) => {
    await expect(load(fixtureContributor({ contributes }))).rejects.toThrow(message);
  });

  it('a module that does not declare registry.services as a dependency cannot contribute', async () => {
    await expect(
      load(
        fixtureContributor({
          dependsOnServices: false,
          contributes: { 'service.facet': [categoryFacet] },
        }),
      ),
    ).rejects.toThrow(
      /fixture\.extras: contributes to registry "service\.facet" of registry\.services, which is not a declared dependency/,
    );
  });

  it('a role that names an organisation type nobody registers stops the start', async () => {
    await expect(
      load(fixtureContributor({ contributes: { 'service.orgRole': [funderRole] } })),
    ).rejects.toThrow(
      /the role "funder" names the organisation type "funder", which no module registers/,
    );
  });

  it('two contributions of one id stop the start', async () => {
    await expect(
      load(
        fixtureContributor({
          contributes: { 'service.facet': [{ ...categoryFacet, id: 'stage' }] },
        }),
      ),
    ).rejects.toThrow(/"stage" is contributed twice to service\.facet/);
  });

  it('a step that uses a field type nobody registers stops the start and names the step', async () => {
    await expect(
      load(
        fixtureContributor({
          contributes: {
            'service.wizardStep': [
              {
                ...categoryStep,
                fields: [{ ...categoryStep.fields[0], type: 'kpi-set' }],
              },
            ],
          },
        }),
      ),
    ).rejects.toThrow(
      /service\.wizardStep "category" \(contributed\): field "category": the field type "kpi-set" is not registered/,
    );
  });
});

describe('the entry schemas of the seeded entries', () => {
  it('accept every entry the module contributes itself', () => {
    for (const role of SEED_ORG_ROLES)
      expect(orgRoleEntrySchema.safeParse(role).success).toBe(true);
    for (const type of SEED_FIELD_TYPES) {
      expect(fieldTypeEntrySchema.safeParse(type).success, type.id).toBe(true);
    }
    for (const facet of SEED_FACETS)
      expect(facetEntrySchema.safeParse(facet).success, facet.id).toBe(true);
    expect(wizardStepEntrySchema.safeParse(categoryStep).success).toBe(true);
  });
});
