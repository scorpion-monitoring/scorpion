// The settings of bibliometrics as the generic settings page of core.ui-shell draws them (M16 sprint 3, ADR-0057): the field
// the two KPI settings (`kpi.citationsIndicatorId`, `kpi.publicationsIndicatorId`) ask for the widget `bibliometrics-indicator`, which the module contributes through `wizardExtensions.widgets`;
// `SchemaField` finds it there, because that page passes only its own `logo` widget. The fields of the module's schema are rendered
// on the server with the stand-in of the shell (a form draws them only in the browser, so one field tree is drawn here). The page
// itself, the choices the picker fetches, a save and the 422 at the field are in `e2e/bibliometrics.spec.ts`.
import { render } from 'svelte/server';
import { z } from '@scorpion/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { forwardWizardExtensions, resetForwarding } from './lib/wizard-extensions.ts';
import { resetExtensions } from '@scorpion/ui-kit';
import SchemaFieldPage from './test/SchemaFieldPage.svelte';
import ShellHarness from './test/ShellHarness.svelte';

const root = new URL('../../../modules/', import.meta.url).pathname;
const mod = (file: string) => import(/* @vite-ignore */ `${root}${file}`);
const { adminMessages } = (await mod('core-ui-shell/ui/admin/messages.ts')) as {
  adminMessages: Record<string, Record<string, string>>;
};
const biblioEntry = (await mod('bibliometrics/ui/index.ts')) as {
  wizardExtensions: { widgets: Record<string, unknown>; sections: Record<string, unknown> };
  messages: Record<string, Record<string, string>>;
};
const { settingsSchema } = (await mod('bibliometrics/settings-schema.ts')) as {
  settingsSchema: z.ZodType;
};

const messages = {
  en: { ...adminMessages.en, ...biblioEntry.messages.en },
  de: { ...adminMessages.de, ...biblioEntry.messages.de },
};

afterEach(() => {
  resetExtensions();
  resetForwarding();
});

const draw = (locale = 'en') =>
  render(ShellHarness, {
    props: {
      page: SchemaFieldPage,
      data: {
        value: { enabled: true, kpi: {} },
        schema: z.toJSONSchema(settingsSchema, { io: 'input', unrepresentable: 'any' }),
      },
      userId: 'me',
      messages,
      locale,
    },
  }).body;

describe('the settings page of bibliometrics', () => {
  it('draws the indicator picker of the module for both KPI settings', () => {
    forwardWizardExtensions([
      {
        package: '@scorpion/bibliometrics',
        routes: [],
        messages: {},
        widgets: {},
        wizardExtensions: biblioEntry.wizardExtensions as never,
      },
    ]);
    const html = draw();
    expect(html).toContain('Citations KPI');
    expect(html).toContain('Publications KPI');
    expect(html.split('>No KPI</option>')).toHaveLength(3);
    // The choices come from the API on the client; the server draws the select disabled, with the state.
    expect(html).toContain('Loading the indicators');
    expect(html).not.toMatch(/<input[^>]*kpi/i);
  });

  it('is in German when the person is', () => {
    forwardWizardExtensions([
      {
        package: '@scorpion/bibliometrics',
        routes: [],
        messages: {},
        widgets: {},
        wizardExtensions: biblioEntry.wizardExtensions as never,
      },
    ]);
    const html = draw('de');
    expect(html).toContain('Kein KPI');
  });

  it('draws the field as its type says when no module contributes the widget (a profile without bibliometrics’ ui)', () => {
    const html = draw();
    expect(html).toContain('Citations KPI');
    expect(html).not.toContain('No KPI');
  });
});
