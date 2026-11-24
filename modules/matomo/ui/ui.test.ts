// The two halves of the UI of matomo must agree: `routes.ts` names the widget for the server, `widgets.ts` gives the web
// app its code. The widget is open to everybody, because anonymous visitors are counted too, and it has no page.
import { describe, expect, it } from 'vitest';
import manifest from '../module.ts';
import routes, { widgets } from './index.ts';
import { MATOMO_WIDGETS } from './routes.ts';

describe('the UI of matomo', () => {
  it('has a widget in the browser half for every widget entry', () => {
    expect(Object.keys(widgets).sort()).toEqual(
      MATOMO_WIDGETS.map((widget) => widget.component).sort(),
    );
    expect(manifest.contributes?.['ui.widget']).toEqual(MATOMO_WIDGETS);
    expect(typeof manifest.ui).toBe('function');
  });

  it('is one public widget at the end of the page, and no page', () => {
    expect(MATOMO_WIDGETS).toEqual([expect.objectContaining({ slot: 'page-end', public: true })]);
    expect(MATOMO_WIDGETS[0]!.permission).toBeUndefined();
    expect(routes).toEqual([]);
  });
});
