# @scorpion/ui-kit

Shared Svelte code of the web app and of the pages of modules. The pieces of M5 sprint 3 (`SchemaForm`, `DataTable`, `Wizard`, `Facets`, the chart
adapter, toasts, the confirm dialog, tabs, breadcrumb and pagination) are listed at the end.

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

**Sprint 2 of M5 adds the pieces the sign-in and profile screens share:**

- Forms: `TextField` (a label, a hint and the server's messages tied to the input with `for`, `aria-describedby` and `aria-invalid`; pass `autocomplete` as the browser names
  it, never `off` on a password field), `TextArea`, `SubmitButton` (disabled until the page is interactive, so a browser can never send a form by itself and put a password
  in the address, and while a request runs), `Alert` (`role="alert"` for an error, `status` otherwise), `Time` (a moment in the person's language and zone, the same markup on
  the server and in the browser). `failureOf(error)` reads a thrown `ApiError` as `{ status, type, fields, general, retryAfterSeconds }`; the server judges the input and the
  page shows its words.
- `Dialog`: a modal on the platform's `<dialog>` (focus trap, inert page, Escape; focus goes back to the button that opened it).
- **Re-authentication** ([ADR-0025](../../docs/adr/0025-absolute-session-lifetime-and-recent-authentication.md)): `getShell().withReauth(action, intent?)` runs an action; on
  `401 reauthentication-required` the layout's `ReauthDialog` asks for the password (`POST /account/reauthenticate`), and for an account with none (`409`) for a sign-in at a
  provider (`POST /account/reauthenticate/oidc/{provider}`), then runs the action again. The password path keeps the action in memory. The provider path leaves the page and the
  callback returns to the start page with no return path, so the intended path and an `intent` (an id and a small payload, never a secret) are kept in `sessionStorage` for ten
  minutes; after the return the layout (`takeReturn`) opens the path again, and the page that asked finds its intent with `getShell().takeIntent(id)` and repeats the action. The
  path is checked with `localPath()` as a `returnTo` is, and the entry is removed when it is read. The logic is `createReauthController()` (no Svelte, `reauth.test.ts`).
- The shell also hands pages `localPath()`, `refresh()` (ask the server again who is signed in, what they may see and in which language), `goto()` and `replaceUrl()` (which
  drops a `#fragment` once a page has read its token).

## Sprint 3: forms, tables and the rest

Each component has a unit test of its logic (plain functions, no Svelte, table-driven), and a spec of its own in
[`apps/web/e2e/components`](../../apps/web/e2e/components) that checks what it does, that it works with the keyboard alone
(`[component:<Name>] keyboard`) and that axe finds no serious or critical violation in both themes (`[component:<Name>] axe`).
The specs run a harness page (`harness/`, built and served by `e2e/support/harness.ts`) with the application's
Content-Security-Policy in a meta tag, so a component that needs an inline style or script fails there. `apps/web/src/components-coverage.test.ts`
fails for a component that has neither the pair of specs nor a place in its list of pieces covered through their pages.
`pnpm test:e2e` runs them as the project `components`; `E2E_COMPONENTS_ONLY=1 pnpm exec playwright test --project=components` (in `apps/web`) skips the database and the servers.

- **`SchemaForm`** (`schema-form.ts` has the rules): a form from a JSON Schema, the output of `z.toJSONSchema(schema, { io: 'input' })`. It draws strings (with `format`,
  `minLength`, `maxLength`; a long one is a text area; `writeOnly` is a password field), numbers and integers, booleans, enums (a select), arrays of scalars and arrays of objects
  (add, remove and **move up or down with the keyboard**, announced in a live region), nested objects (a fieldset), a choice between shapes (`oneOf`/`anyOf`, a select that shows the
  fields of the chosen one; a pinned `const` is never drawn) and, for anything else, the value as it is, kept and not edited. It repeats no rule of the schema: the server judges.
  It sends what was filled in (an emptied optional field is left out, and so is a secret nobody typed) and puts the messages of a 422 on the field they name.
  - **The convention (M5 plan, decision 6).** A module describes a setting with Zod's `.meta({ title, description, group, order, widget })`; Zod copies those keys into the JSON
    Schema (`.describe(text)` is `description`), and the form reads only those (`x-group`, `x-order` and `x-widget` are accepted too). `title` is the label (the key in words
    when there is none), `description` the hint, `group` the fieldset a field belongs to (loose fields first, then the groups in the order they are first used), `order` moves a field
    within its object (declaration order otherwise), `widget` names a custom control: the page passes `widgets={{ logo: LogoUpload }}` (a component that takes `WidgetProps`).
    Nothing else in a schema changes the form.
  - **A secret is `writeOnly`**: a password field that is empty even when a value is stored (nothing is stored in a setting, see "Secrets" in the core.settings README), with
    `autocomplete="new-password"`, and sent only when something was typed.
  - **Messages of a failure.** Pass `failure={failureOf(error)}` and, when the API puts a prefix in front of the path (`values` for the body of a settings save), `errorPrefix`. The API
    names a field with dotted segments (`sessions.absoluteDays`, `providers.1.id`); JSON pointers are understood too. Every message is also in a list at the top (focused after a failed
    save) with the name of its field and its parents (`Providers › Item 2 › Id`). A `409` is shown by passing `conflict` and `onreload`.
- **`DataTable`**: the list envelope of the API (pages from 0). Columns are `{ key, header, sortable?, value?, cell?, rowHeader? }` (`cell` is a snippet); the actions of a row go in the
  `actions` snippet. With `onsort` the server sorts (and the page keeps its own `sort`); without it the table sorts the rows it was given, stable by the row key, the empty value last.
  Loading, error (with a retry) and empty are states of its own. A real `<table>` with a caption, `scope`s and `aria-sort`; Up and Down move between the buttons and links of two rows.
- **`Pagination`** (inside `DataTable`, and alone): page buttons with a window and gaps, the range as a polite live region, an optional page size.
- **`Wizard`** (`wizard.ts`): steps, a check per step (`validate`), back and forward, a progress list that goes back to a step already reached, focus on the new step's heading, and a
  leave-page guard while the page says it is `dirty` (`getShell().guardLeave`; the layout asks on a link and on a reload). It keeps no state: the page does.
- **`Facets`** (`facets.ts`): checkbox and range filters whose selection lives in the address (`?f.status=active&f.year.min=2010`), so a filtered list can be bookmarked. The page reads
  the address with `parseFacets()`; the component writes it back with `href(path)` and `goto()` and drops `page`. A value from an address is checked (length, characters, limits).
- **`Chart`** (`chart.ts`, `chart-echarts.ts`): a chart described as data (`ChartSpec`: `line`, `bar` or `radar`, categories, series, a unit) and drawn by an adapter. ECharts is behind
  the adapter and **loaded when the first chart mounts**, so a page without a chart never fetches it; the SVG renderer needs no inline style. The colours follow the theme (DaisyUI
  variables, light, dark and a change of either) and the size of the box. The text alternative is part of the component: the picture is one labelled image, and a button shows the
  same numbers as a table. A spec that cannot be drawn says so and keeps the table. `createChartController()` owns the late load and is tested with a stub adapter.
- **`Toasts`** and `getShell().toaster` (`toaster.ts`): `toaster.success(text)`, `.info(text)`, `.error(text)`. A success or an information goes after a few seconds; an error stays until it is closed.
- **`ConfirmDialog`**: a `Dialog` with a message and two buttons, opening on the safe one (Cancel first in the page order). **`Tabs`** (arrows, Home and End, one Tab into the panel),
  **`Breadcrumb`** (the last item is the page).
- `zod` is set to `jitless` by `@scorpion/contracts/client`, because the page's policy has no `unsafe-eval` and zod would otherwise try `new Function` on first use.
- **New runtime dependency: `echarts`** (the one named in CLAUDE.md), behind the adapter.
