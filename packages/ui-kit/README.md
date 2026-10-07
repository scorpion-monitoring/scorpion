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
