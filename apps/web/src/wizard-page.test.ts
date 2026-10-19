// The create wizard, rendered on the server with a stand-in for the shell (`ShellHarness.svelte`): what a person
// must never see wrong. The schema is the one the server builds for the shipped configuration (the same function
// the route calls); the page draws steps, intro paragraphs and fields from it, with the widget of each field
// type from one table. The lists of organisations come from the loader (tested in the module): here the page
// draws what it is given. The dev console is drawn only when the schema says so. A widget nobody registered is
// said, not skipped. The clicks, the 422 on a field and the whole journey are in `e2e/services.spec.ts`; the
// mapping of a failure to fields is `form-state.test.ts` of the module.
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import ShellHarness from './test/ShellHarness.svelte';
import { forwardWizardExtensions, resetForwarding } from './lib/wizard-extensions.ts';
import KpiSetWidget from './test/KpiSetWidget.svelte';

const mod = (file: string) =>
  import(
    /* @vite-ignore */ new URL(`../../../modules/registry-services/${file}`, import.meta.url)
      .pathname
  );
const { messages } = (await mod('ui/messages.ts')) as {
  messages: Record<string, Record<string, string>>;
};
const NewService = ((await mod('ui/NewService.svelte')) as { default: Component }).default;
const { BUILT_IN_WIDGETS } = (await mod('ui/widgets.ts')) as {
  BUILT_IN_WIDGETS: Record<string, unknown>;
};
const extensions = (await mod('ui/wizard-extensions.ts')) as {
  resetExtensions: () => void;
};
const { createSchemaFixture, fixtureFieldType } = (await mod('test/create-schema-fixture.ts')) as {
  createSchemaFixture: (options?: {
    devConsole?: boolean;
    steps?: unknown[];
    types?: unknown[];
  }) => Schema;
  fixtureFieldType: (id: string, widget?: string) => unknown;
};
const { SEED_FIELD_TYPES } = (await mod('service/field-types.ts')) as {
  SEED_FIELD_TYPES: { id: string; widget: string }[];
};

interface Schema {
  steps: { id: string; fields: { widget: string }[]; [key: string]: unknown }[];
  devConsole: boolean;
  [key: string]: unknown;
}

/** The server's schema for the shipped configuration, plus contributed steps. */
const schemaWith = (options: { devConsole?: boolean; steps?: unknown[]; types?: unknown[] } = {}) =>
  Promise.resolve(createSchemaFixture(options));
const kpiSet = fixtureFieldType('kpi-set');

const org = (id: string, abbreviation: string, name = `${abbreviation} institute`) => ({
  id,
  abbreviation,
  name,
});
const organisations = (provider = [org('o-1', 'IPK')], consortium = [org('c-1', 'NFDI')]) => ({
  provider: { options: provider, truncated: false },
  consortium: { options: consortium, truncated: false },
});

const draw = (data: unknown, locale = 'en') =>
  render(ShellHarness, { props: { page: NewService, data, userId: 'me', messages, locale } }).body;

/** A schema whose first step is `id`: the page draws the current step only, and a test must see another one. */
const startingAt = (schema: Schema, id: string): Schema => ({
  ...schema,
  steps: [
    ...schema.steps.filter((step) => step.id === id),
    ...schema.steps.filter((step) => step.id !== id),
  ],
});

afterEach(() => {
  extensions.resetExtensions();
  resetForwarding();
});

/** The fixture's module reaches the wizard the way a real one does: through the shell's forwarding of its `ui` entry. */
const registerFixtureModule = () =>
  forwardWizardExtensions([
    {
      package: '@scorpion/fixture-kpi',
      routes: [],
      messages: {},
      widgets: {},
      wizardExtensions: { widgets: { 'kpi-set': KpiSetWidget }, applies: {} },
    },
  ]);

const category = {
  id: 'category',
  order: 5,
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
  ],
};
const fixtureMessages = {
  en: {
    ...messages.en,
    'fixture.step.category.title': 'Category',
    'fixture.step.category.intro': 'Choose the category of the service.',
    'fixture.field.category.label': 'Service category',
  },
  de: {
    ...messages.de,
    'fixture.step.category.title': 'Kategorie',
    'fixture.step.category.intro': 'Wählen Sie die Kategorie des Dienstes.',
    'fixture.field.category.label': 'Dienstkategorie',
  },
};
const drawWith = (data: unknown, locale = 'en') =>
  render(ShellHarness, {
    props: { page: NewService, data, userId: 'me', messages: fixtureMessages, locale },
  }).body;

describe('the wizard page', () => {
  it('draws the first step: its title in the progress list, its intro above its fields, the fields in the order of the config', async () => {
    const html = draw({ schema: await schemaWith(), organisations: organisations() });
    expect(html).toContain('Step 1 of 3: Basics');
    const order = [
      'Give the service a short name',
      'Short name (used in the address)',
      '>Name<',
      'Licence',
      'Stage',
      'Icon',
      'Description',
      'Web address of the service',
      'Further links',
    ].map((text) => html.indexOf(text));
    expect(
      order.every((at) => at >= 0),
      JSON.stringify(order),
    ).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The progress list names every step, in order.
    const progress = ['Basics', 'Who runs it', 'Contact'].map((text) => html.indexOf(`>${text}`));
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
    expect(progress.every((at) => at >= 0)).toBe(true);
  });

  it('draws the stage from the options the server sent, in their words, and never a term', async () => {
    const html = draw({ schema: await schemaWith(), organisations: organisations() });
    expect(html).toContain('In development');
    expect(html).toContain('In production');
    expect(html).not.toMatch(/>\s*(DEV|PROD)\s*</);
  });

  it('marks the required fields in words, and says the icon is added once the service exists', async () => {
    const html = draw({ schema: await schemaWith(), organisations: organisations() });
    expect(html).toContain('(required)');
    expect(html).toContain('You can add the icon on the next screen');
    // The icon has no file control on this screen: the blob needs the service's id.
    expect(html).not.toContain('type="file"');
  });

  it('takes its labels from the catalogue in the person’s language', async () => {
    const html = draw({ schema: await schemaWith(), organisations: organisations() }, 'de');
    expect(html).toContain('Kurzname (Teil der Adresse)');
    expect(html).toContain('Schritt 1 von 3: Grunddaten');
    expect(html).not.toContain('Short name');
  });

  it('draws the licence widget as a search with its words, and no list before anything is typed', async () => {
    const html = draw({ schema: await schemaWith(), organisations: organisations() });
    expect(html).toContain('type="search"');
    expect(html).toContain('Search by licence name or SPDX id');
    expect(html).not.toContain('OSI approved');
  });

  it('draws a list field (the further links) with an add control from the kit', async () => {
    const html = draw({ schema: await schemaWith(), organisations: organisations() });
    expect(html).toContain('Further links');
  });
});

describe('the organisations a person may choose', () => {
  it('lists exactly what the loader was given: the provider list of a member is their own organisation', async () => {
    const schema = startingAt(await schemaWith(), 'provision');
    const member = draw({ schema, organisations: organisations([org('o-1', 'IPK')]) });
    expect(member).toContain('IPK institute (IPK)');
    expect(member).not.toContain('Other institute');
    // The label is neutral: no role is named.
    expect(member).toContain('Operated by');
    expect(member).toContain('Part of');
    expect(member).not.toMatch(/provider|consortium/i);
  });

  it('lists every organisation the loader gave an administrator', async () => {
    const schema = startingAt(await schemaWith(), 'provision');
    const admin = draw({
      schema,
      organisations: organisations([org('o-1', 'IPK'), org('o-2', 'EMBL'), org('o-3', 'DKFZ')]),
    });
    for (const name of ['IPK institute (IPK)', 'EMBL institute (EMBL)', 'DKFZ institute (DKFZ)']) {
      expect(admin).toContain(name);
    }
  });

  it('draws the groups as check boxes and the owner as a choice, with the value an id', async () => {
    const schema = startingAt(await schemaWith(), 'provision');
    const html = draw({
      schema,
      organisations: organisations([org('o-1', 'IPK')], [org('c-1', 'NFDI'), org('c-2', 'DNBI')]),
    });
    expect(html).toContain('value="o-1"');
    expect([...html.matchAll(/type="checkbox"/g)]).toHaveLength(2);
    expect(html).toContain('<select');
  });

  it('says so when there is nothing to choose, and when the list is cut', async () => {
    const schema = startingAt(await schemaWith(), 'provision');
    const none = draw({
      schema,
      organisations: {
        provider: { options: [], truncated: false },
        consortium: { options: [], truncated: false },
      },
    });
    expect(none).toContain('There is no organisation to choose from');
    const cut = draw({
      schema,
      organisations: {
        provider: { options: [org('o-1', 'IPK')], truncated: true },
        consortium: { options: [], truncated: false },
      },
    });
    expect(cut).toContain('More organisations exist than are listed here.');
  });
});

describe('the contact step', () => {
  it('says the contact point is a role address, and asks both parts or neither', async () => {
    const schema = startingAt(await schemaWith(), 'contact');
    const html = draw({ schema, organisations: organisations() });
    expect(html).toContain('role address of the organisation');
    expect(html).toContain('not a personal one');
    expect(html).toContain('Contact address');
    expect(html).toContain('Kind of contact');
    expect(html).toContain('type="email"');
  });
});

describe('the JSON console', () => {
  it('is drawn when the server says it is not in production, and holds the form as JSON', async () => {
    const html = draw({
      schema: await schemaWith({ devConsole: true }),
      organisations: organisations(),
    });
    expect(html).toContain('JSON console (development only)');
    expect(html).toContain('The form as JSON');
    expect(html).toContain('"stage": "DEV"');
  });

  it('is not in the page at all when the server says it is production: no text, no textarea, no JSON of the form', async () => {
    const html = draw({
      schema: await schemaWith({ devConsole: false }),
      organisations: organisations(),
    });
    expect(html).not.toContain('JSON console');
    expect(html).not.toContain('The form as JSON');
    expect(html).not.toContain('"stage": "DEV"');
    // The one textarea that remains is the description's: a web address is one line.
    expect([...html.matchAll(/<textarea/g)]).toHaveLength(1);
    expect(html).toMatch(/<input[^>]*name="\/url"/);
  });
});

describe('a step another module contributes', () => {
  const step = { ...category, applies: undefined };

  it('appears in order, with its intro, its field and the widget its module registered', async () => {
    registerFixtureModule();
    const schema = await schemaWith({ steps: [step], types: [kpiSet] });
    expect(schema.steps.map((s) => s.id)).toEqual(['category', 'basics', 'provision', 'contact']);
    const html = drawWith({ schema, organisations: organisations() });
    expect(html).toContain('Step 1 of 4: Category');
    expect(html).toContain('Choose the category of the service.');
    expect(html).toContain('data-widget="kpi-set"');
    expect(html).toContain('Service category');
    // The progress list shows it first, then the module's own.
    expect(
      ['Category', 'Basics', 'Who runs it', 'Contact'].map((text) => html.indexOf(`>${text}`)),
    ).toEqual(expect.arrayContaining([expect.any(Number)]));
    const at = ['Category', 'Basics', 'Who runs it', 'Contact'].map((text) =>
      html.indexOf(`>${text}`),
    );
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('is in the person’s language when its module gave one', async () => {
    registerFixtureModule();
    const schema = await schemaWith({ steps: [step], types: [kpiSet] });
    const html = drawWith({ schema, organisations: organisations() }, 'de');
    expect(html).toContain('Schritt 1 von 4: Kategorie');
    expect(html).toContain('Dienstkategorie');
  });

  it('is not skipped when nobody registered its widget: the page says so, and names the widget', async () => {
    const schema = await schemaWith({ steps: [step], types: [kpiSet] });
    const html = drawWith({ schema, organisations: organisations() });
    expect(html).toContain('cannot be shown here');
    expect(html).toContain('kpi-set');
    expect(html).not.toContain('data-widget="kpi-set"');
  });
});

describe('the widgets', () => {
  it('are known for every field type this module seeds: a type whose widget the page lacks fails here', () => {
    for (const type of SEED_FIELD_TYPES) {
      expect(Object.keys(BUILT_IN_WIDGETS), `${type.id} has the widget "${type.widget}"`).toContain(
        type.widget,
      );
    }
  });

  it('are known for every field of the shipped configuration', async () => {
    const schema = await schemaWith();
    for (const field of schema.steps.flatMap((step) => step.fields)) {
      expect(Object.keys(BUILT_IN_WIDGETS), field.widget).toContain(field.widget);
    }
  });
});
