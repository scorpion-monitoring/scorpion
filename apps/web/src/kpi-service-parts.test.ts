// What kpi.framework adds to the services wizard and the service page, rendered on the server with the stand-in of the shell
// (`ShellHarness.svelte`): the shell forwards the `wizardExtensions` export of a module's `ui` entry (once), the real
// widget of the `kpi-set` field draws the sets the schema sent, and the section of the service page is drawn after the
// record. The data the section fetches and every click are in `e2e/kpi-framework.spec.ts`.
import type { Component } from 'svelte';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it } from 'vitest';
import { uiModules } from './generated/ui.ts';
import { wizardExtensionsOf } from './lib/ui-modules.ts';
import { forwardWizardExtensions, resetForwarding } from './lib/wizard-extensions.ts';
import ShellHarness from './test/ShellHarness.svelte';

const root = new URL('../../../modules/', import.meta.url).pathname;
const mod = (file: string) => import(/* @vite-ignore */ `${root}${file}`);
const { messages: serviceMessages } = (await mod('registry-services/ui/messages.ts')) as {
  messages: Record<string, Record<string, string>>;
};
const kpiEntry = (await mod('kpi-framework/ui/index.ts')) as {
  wizardExtensions: {
    widgets: Record<string, unknown>;
    applies: object;
    sections: Record<string, unknown>;
  };
};
const { messages: kpiMessages } = (await mod('kpi-framework/ui/messages.ts')) as {
  messages: Record<string, Record<string, string>>;
};
const NewService = ((await mod('registry-services/ui/NewService.svelte')) as { default: Component })
  .default;
const Service = ((await mod('registry-services/ui/Service.svelte')) as { default: Component })
  .default;
const ServiceEdit = (
  (await mod('registry-services/ui/ServiceEdit.svelte')) as { default: Component }
).default;
const extensions = (await mod('registry-services/ui/wizard-extensions.ts')) as {
  resetExtensions: () => void;
  contributedWidget: (name: string) => unknown;
  stepConditions: () => object;
};
const { createSchemaFixture } = (await mod('registry-services/test/create-schema-fixture.ts')) as {
  createSchemaFixture: (options?: { steps?: unknown[]; types?: unknown[] }) => {
    steps: { id: string; fields: { widget: string; choices?: unknown[] }[] }[];
  };
};
const { kpiSetStep, kpiSetFieldType } = (await mod('kpi-framework/service/contributions.ts')) as {
  kpiSetStep: unknown;
  kpiSetFieldType: (deps: { db: () => never; writer: () => never }) => unknown;
};

const messages = {
  en: { ...serviceMessages.en, ...kpiMessages.en },
  de: { ...serviceMessages.de, ...kpiMessages.de },
};
const SET_A = '0197a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a0a';
const SET_B = '0197a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a0b';

afterEach(() => {
  extensions.resetExtensions();
  resetForwarding();
});

const kpiModule = {
  package: '@scorpion/kpi-framework',
  routes: [],
  messages: {},
  widgets: {},
  wizardExtensions: kpiEntry.wizardExtensions as never,
};

describe('the fourth export of a ui entry', () => {
  it('is the widget of the field type, no condition for the step, and one section', () => {
    expect(Object.keys(kpiEntry.wizardExtensions.widgets)).toEqual(['kpi-set']);
    expect(kpiEntry.wizardExtensions.applies).toEqual({});
    expect(Object.keys(kpiEntry.wizardExtensions.sections)).toEqual(['kpis']);
  });

  it('is in the generated table of the web app for the module that has it, and only for it', () => {
    const withExtensions = uiModules.filter((module) => module.wizardExtensions !== undefined);
    expect(withExtensions.map((module) => module.package)).toEqual(['@scorpion/kpi-framework']);
    expect(wizardExtensionsOf({})).toBeUndefined();
    expect(wizardExtensionsOf({ wizardExtensions: { widgets: {} } })).toEqual({ widgets: {} });
  });

  it('is forwarded once: a second call changes nothing and does not throw', () => {
    forwardWizardExtensions([kpiModule]);
    expect(extensions.contributedWidget('kpi-set')).toBe(
      kpiEntry.wizardExtensions.widgets['kpi-set'],
    );
    expect(() => forwardWizardExtensions([kpiModule])).not.toThrow();
  });

  it('registers a name twice only through two modules, and says which name', () => {
    forwardWizardExtensions([kpiModule]);
    resetForwarding();
    expect(() => forwardWizardExtensions([kpiModule])).toThrow(/"kpi-set" is registered twice/);
  });

  it('forwards the conditions of steps too', () => {
    forwardWizardExtensions([
      {
        ...kpiModule,
        wizardExtensions: { applies: { later: (form: Record<string, unknown>) => form.a === 1 } },
      },
    ]);
    expect(Object.keys(extensions.stepConditions())).toEqual(['later']);
  });
});

describe('the wizard step', () => {
  const schemaWithSets = () => {
    const schema = createSchemaFixture({
      steps: [kpiSetStep],
      // The real entry of the module (its `store` and `choices` are not called by a schema built without a database).
      types: [kpiSetFieldType({ db: () => undefined as never, writer: () => undefined as never })],
    });
    const field = schema.steps.find((step) => step.id === 'kpi-set')!.fields[0]!;
    field.choices = [
      { value: SET_A, label: 'Data resources' },
      { value: SET_B, label: 'Web <b>applications</b>' },
    ];
    // The step to draw is the first one the schema lists.
    return {
      ...schema,
      steps: [
        ...schema.steps.filter((step) => step.id === 'kpi-set'),
        ...schema.steps.filter((step) => step.id !== 'kpi-set'),
      ],
    };
  };
  const draw = (locale = 'en') =>
    render(ShellHarness, {
      props: {
        page: NewService,
        data: { schema: schemaWithSets(), organisations: {} },
        userId: 'me',
        messages,
        locale,
      },
    }).body;

  it('draws the real widget with the sets the schema sent, an empty choice and the intro, with the names escaped', () => {
    forwardWizardExtensions([kpiModule]);
    const html = draw();
    expect(html).toContain('KPIs');
    expect(html).toContain('Choose the KPI set that fits this service.');
    expect(html).toContain('>KPI set<');
    expect(html).toContain('<option value="" selected="">No KPI set</option>');
    expect(html).toContain(`<option value="${SET_A}">Data resources</option>`);
    expect(html).toContain('Web &lt;b>applications&lt;/b>');
    expect(html).not.toContain('<b>applications');
    expect(html).not.toContain('cannot be shown here');
  });

  it('is in German when the person is', () => {
    forwardWizardExtensions([kpiModule]);
    const html = draw('de');
    expect(html).toContain('Wählen Sie das KPI-Set');
    expect(html).toContain('<option value="" selected="">Kein KPI-Set</option>');
  });

  it('says the widget is missing when the shell forwarded nothing, instead of skipping the step', () => {
    expect(draw()).toContain('cannot be shown here');
  });
});

describe('the section of the service page', () => {
  const data = {
    service: {
      id: '0197a1b2-c3d4-7e5f-8a6b-7c8d9e0f1aff',
      slug: 'blast-tool',
      name: 'Blast Tool',
      stage: 'PROD',
      license: null,
      public: false,
      description: null,
      url: null,
      sameAs: [],
      values: {},
      contactEmail: null,
      contactType: null,
      organisations: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      editableFields: [],
      allowedActions: [],
    },
    profile: { '@context': 'https://schema.org', '@type': 'Service', name: 'Blast Tool' },
    schema: createSchemaFixture(),
    licence: undefined,
    organisations: {},
  };
  const draw = (locale = 'en') =>
    render(ShellHarness, {
      props: { page: Service, data, userId: 'me', messages, locale },
    }).body;

  it('is drawn after the record, with its own heading, once the shell forwarded it', () => {
    forwardWizardExtensions([kpiModule]);
    const html = draw();
    expect(html).toContain('data-testid="service-kpis"');
    expect(html).toContain('>KPIs<');
    expect(html.indexOf('Blast Tool')).toBeLessThan(html.indexOf('data-testid="service-kpis"'));
    // It fills in on the client; the server draws the state before the answer.
    expect(html).toContain('Loading the KPIs');
    expect(html).not.toContain('Change KPIs');
  });

  it('is not drawn by a page of a profile without it', () => {
    expect(draw()).not.toContain('service-kpis');
  });

  it('has its words in German', () => {
    forwardWizardExtensions([kpiModule]);
    expect(draw('de')).toContain('KPIs werden geladen');
  });
});

describe('the edit form of the service', () => {
  const schema = createSchemaFixture({
    steps: [kpiSetStep],
    types: [kpiSetFieldType({ db: () => undefined as never, writer: () => undefined as never })],
  });
  const keys = schema.steps.flatMap((step) =>
    step.fields.map((field) => (field as unknown as { key: string }).key),
  );
  const service = (editable: string[]) => ({
    id: '0197a1b2-c3d4-7e5f-8a6b-7c8d9e0f1aff',
    slug: 'blast-tool',
    name: 'Blast Tool',
    stage: 'PROD',
    license: null,
    public: false,
    description: null,
    url: null,
    sameAs: [],
    values: {},
    contactEmail: null,
    contactType: null,
    organisations: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    editableFields: editable,
    allowedActions: ['edit'],
  });

  it('marks the field of the KPIs as changed elsewhere, and neither draws it nor lists it as a fixed value', () => {
    const field = schema.steps
      .flatMap((step) => step.fields)
      .find((f) => (f as unknown as { key: string }).key === 'kpiSet');
    expect((field as unknown as { external?: boolean }).external).toBe(true);
    forwardWizardExtensions([kpiModule]);
    // A manager may write every field the server lists as editable, which leaves the KPIs out.
    const editable = keys.filter((key) => key !== 'kpiSet' && key !== 'icon');
    const html = render(ShellHarness, {
      props: {
        page: ServiceEdit,
        data: {
          service: service(editable),
          profile: {},
          schema,
          licence: undefined,
          organisations: {},
        },
        userId: 'me',
        messages,
        locale: 'en',
      },
    }).body;
    expect(html).not.toContain('Fixed values');
    expect(html).not.toContain(
      'Only a manager of the provider or an administrator can change these.',
    );
    expect(html).not.toContain('select-bordered w-full max-w-md');
    expect(html).not.toContain('KPI set');
  });
});
