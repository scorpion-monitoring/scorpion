// The ui entry of bibliometrics: no page of its own (the service page draws its section, the generic settings page its picker),
// the manifest loads the texts, and the widget the setting asks for is the one the entry contributes.
import { describe, expect, it } from 'vitest';
import manifest from '../module.ts';
import { settingsSchema } from '../settings-schema.ts';
import routes, { messages, widgets } from './pages.ts';

describe('the ui of bibliometrics', () => {
  it('has no page and no dashboard card, and the manifest loads its texts', () => {
    expect(routes).toEqual([]);
    expect(widgets).toEqual({});
    expect(typeof manifest.ui).toBe('function');
    expect(manifest.contributes?.['ui.routes']).toBeUndefined();
    expect(messages.en?.['admin.settings.module.bibliometrics']).toBe('Publications and citations');
  });

  it('asks for the indicator picker on kpi.indicatorId, by the name the entry contributes it under', async () => {
    const json = (await import('@scorpion/contracts')).z.toJSONSchema(settingsSchema, {
      io: 'input',
    }) as unknown as { properties: { kpi: { properties: { indicatorId: { widget?: string } } } } };
    expect(json.properties.kpi.properties.indicatorId.widget).toBe('bibliometrics-indicator');
    // The entry with the Svelte components is compiled by the web app; its name is a constant there.
    const source = (await import('node:fs')).readFileSync(
      new URL('./index.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain("INDICATOR_WIDGET = 'bibliometrics-indicator'");
  });
});
