# @scorpion/ui-kit

Shared Svelte code of the web app and of the pages of modules: `SchemaForm`, `DataTable`, `Wizard`, `Facets` and the chart adapter
(ECharts) arrive in M5 sprint 3.

**In place (M5 sprint 1):**

- `createTranslator(bundles, locale)`, `mergeBundles()`, `interpolate()`: the message catalogue. Keys are prefixed with the area that owns
  them (`nav.home`); a missing text falls back to English and then to the key. German and the check that every key has it come in sprint 2.
- `setShell()` / `getShell()`: what the layout hands to every page through Svelte's context: `href()` (the only way to build a link),
  `t()`, the typed `api`, `session()`, `navigation()` and `branding()`.
- `SafeHtml`: the one component that renders HTML from a string, for text the server has sanitised. ESLint refuses `{@html}` anywhere else.
