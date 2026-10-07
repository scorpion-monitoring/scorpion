# @scorpion/ui-kit

Shared Svelte code of the web app and of the pages of modules: `SchemaForm`, `DataTable`, `Wizard`, `Facets` and the chart adapter
(ECharts) arrive in M5 sprint 3.

**In place (M5 sprint 1):**

- `createTranslator(bundles, locale)`, `mergeBundles()`, `interpolate()`: the message catalogue. Keys are prefixed with the area that owns
  them (`nav.home`); a missing text falls back to English and then to the key.
- **Languages (sprint 2):** `en` and `de` (`SUPPORTED_LOCALES`). `negotiateLocale({ preferred, acceptLanguage, instanceDefault })` picks one in the order of
  ADR-0022: the person's preference `notifications.locale`, the browser's `Accept-Language`, the instance default, English (the web app has no instance
  default to pass yet, see the backlog). A text that depends on a number has one key per plural form of the language, `sessions.count.one` and
  `sessions.count.other`, and `t('sessions.count', { count })` picks the form (`Intl.PluralRules`).
- **Two checks fail the build** (`apps/web/src/catalogue.test.ts`): `catalogueProblems()` for a key one language lacks, other placeholders in a text, or a plural
  form without `other`; and a scan of every `.svelte` file for a text node or a visible attribute (`aria-label`, `title`, `placeholder`, `alt`) that is
  not `{t('key')}`.
- `setShell()` / `getShell()`: what the layout hands to every page through Svelte's context: `href()` (the only way to build a link),
  `t()`, the typed `api`, `session()`, `navigation()` and `branding()`.
- `SafeHtml`: the one component that renders HTML from a string, for text the server has sanitised. ESLint refuses `{@html}` anywhere else.
