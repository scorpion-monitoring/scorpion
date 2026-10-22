// The two halves of the widgets of kpi.analytics must agree: `routes.ts` says who may see a widget and how it sits on the grid (the server),
// `widgets.ts` says what is drawn (the web app). Every text exists in every shipped language, and every key a component uses has a text.
import { REGISTRIES } from '@scorpion/core-ui-shell/public';
import { catalogueProblems } from '@scorpion/ui-kit/i18n';
import { describe, expect, it } from 'vitest';
import manifest from '../module.ts';
import routes, { messages, widgets } from './index.ts';
import { ANALYTICS_WIDGETS, WIDGET_IDS } from './routes.ts';

describe('the widgets of kpi.analytics', () => {
  it('are the entries the manifest contributes, and a widget in the browser half for each', () => {
    expect(manifest.contributes?.['ui.widget']).toEqual(ANALYTICS_WIDGETS);
    expect(typeof manifest.ui).toBe('function');
    expect(Object.keys(widgets).sort()).toEqual(
      ANALYTICS_WIDGETS.map((widget) => widget.component).sort(),
    );
    expect(routes).toEqual([]);
  });

  it('are valid entries of the registry `ui.widget`, with the five ids, one component each, and the plain permission the module declares', () => {
    const declared = new Set(Object.keys(manifest.permissions ?? {}));
    expect(ANALYTICS_WIDGETS.map((widget) => widget.id).sort()).toEqual(
      Object.values(WIDGET_IDS).sort(),
    );
    expect(new Set(ANALYTICS_WIDGETS.map((widget) => widget.component)).size).toBe(5);
    for (const widget of ANALYTICS_WIDGETS) {
      expect(() => REGISTRIES['ui.widget'].parse(widget), widget.id).not.toThrow();
      expect(widget.public, widget.id).toBeFalsy();
      expect(declared.has(widget.permission!), widget.id).toBe(true);
      expect(widget.slot).toBe('dashboard');
    }
  });

  it('put the cards, the trends chart and the quick actions in the default dashboard, in places that do not overlap the cards of earlier milestones', () => {
    const placed = ANALYTICS_WIDGETS.filter((widget) => widget.grid?.default);
    expect(placed.map((widget) => widget.id).sort()).toEqual(
      [WIDGET_IDS.actions, WIDGET_IDS.cards, WIDGET_IDS.trends].sort(),
    );
    for (const widget of placed) {
      const at = widget.grid!.default!;
      // the three older cards occupy rows 0 to 2
      expect(at.y, widget.id).toBeGreaterThanOrEqual(3);
    }
    const boxes = placed.map((widget) => widget.grid!.default!);
    for (const [i, a] of boxes.entries())
      for (const b of boxes.slice(i + 1))
        expect(
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h,
          'no two defaults overlap',
        ).toBe(false);
  });

  it('have a settings schema where the widget has settings, and the quick actions have none and may be placed once', () => {
    for (const widget of ANALYTICS_WIDGETS)
      expect(widget.configSchema !== undefined, widget.id).toBe(widget.id !== WIDGET_IDS.actions);
    expect(
      ANALYTICS_WIDGETS.find((widget) => widget.id === WIDGET_IDS.actions)?.grid?.singleton,
    ).toBe(true);
  });

  it('have every text in English and German, with the same placeholders', () => {
    expect(catalogueProblems(messages)).toEqual([]);
  });

  it('have a text for every key the components and the entries use, and none that nothing uses', async () => {
    const { globSync, readFileSync } = await import('node:fs');
    const root = new URL('.', import.meta.url).pathname;
    const used = new Set<string>();
    for (const file of globSync('*.svelte', { cwd: root })) {
      const source = readFileSync(`${root}${file}`, 'utf8');
      for (const match of source.matchAll(/\bt\(\s*'([a-z][A-Za-z0-9.]*)'/g)) used.add(match[1]!);
      for (const match of source.matchAll(/\bt\(\s*`([a-z][A-Za-z0-9.]*)\.\$\{/g)) {
        const prefix = match[1]!;
        expect(
          Object.keys(messages.en!).filter((key) => key.startsWith(`${prefix}.`)).length,
          prefix,
        ).toBeGreaterThan(0);
        used.add(`${prefix}.*`);
      }
      for (const match of source.matchAll(/label: '(analytics\.[A-Za-z0-9.]*)'/g))
        used.add(match[1]!);
    }
    for (const widget of ANALYTICS_WIDGETS) {
      used.add(widget.label!);
      used.add(widget.description!);
    }
    const known = new Set(
      Object.keys(messages.en!).map((key) => key.replace(/\.(one|other)$/, '')),
    );
    expect([...used].filter((key) => !key.endsWith('.*') && !known.has(key))).toEqual([]);
    const prefixes = [...used].filter((key) => key.endsWith('.*')).map((key) => key.slice(0, -1));
    const unused = [...known].filter(
      (key) => !used.has(key) && !prefixes.some((prefix) => key.startsWith(prefix)),
    );
    expect(unused).toEqual([]);
    expect(used.size).toBeGreaterThan(50);
  });
});
