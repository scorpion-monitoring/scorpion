# core.ui-shell

The shell of the web app: the registries through which modules put pages, links, dashboard cards and themes into it, and the one
route that tells the browser what the caller may see. It owns no table. The web app (`apps/web`) draws the layout and one catch-all
route `/[...path]`; this module is the part the server knows about ([ADR-0027](../../docs/adr/0027-web-shell-catch-all-proxy-and-typed-client.md)).

Status: M11 sprint 1 (the dashboard document, its two routes and the extended `ui.widget`; the grid on screen comes in sprint 2). Before that, M5 sprint 3. Its own pages are the start page, the legal pages, the API documentation and the administration of roles and settings; the screens of the other `core.*`
modules come with those modules (the sign-in, registration, recovery and profile pages and the administration of users are `core.identity`'s; the audit and notification screens arrive in sprint 4).

## Manifest

| Part           | Value                                                                                                                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id             | `core.ui-shell`                                                                                                                                                                                                                                                                              |
| table prefix   | none: the module has no table                                                                                                                                                                                                                                                                |
| dependencies   | `core.authz` (to decide what a caller may see), `core.settings` (the branding every page shows, and the preference that holds the dashboard). The package also lists `@scorpion/ui-kit` as a development dependency, for its pages, and `fast-check` for the tests of the dashboard document |
| routes         | internal API: `GET /ui/navigation` (public), `GET /ui/dashboard` and `PUT /ui/dashboard` ([the dashboard](#the-dashboard))                                                                                                                                                                   |
| jobs, CLI      | none                                                                                                                                                                                                                                                                                         |
| events         | emits and subscribes to none (a save emits `settings.preference.changed@1`, which `core.settings` owns)                                                                                                                                                                                      |
| registries     | declares `ui.routes`, `ui.nav`, `ui.widget` and `ui.theme`; contributes its own pages, two links and the two themes, the user preference `core.ui-shell.dashboard` (`settings.userPreference`) and the two dashboard permissions to the role `user` (`authz.defaultRole`)                    |
| ui             | package export `./ui`: the browser half of its pages (`ui/index.ts`), imported by the web app only                                                                                                                                                                                           |
| public service | `ctx.deps['core.ui-shell']`: `navigation(actor)` and `dashboard.get(actor)`, `dashboard.save(actor, items)`. No other module calls it; the entry types are in `public.ts`                                                                                                                    |

| Permission                      | Allows                                                    | Held by     |
| ------------------------------- | --------------------------------------------------------- | ----------- |
| `core.ui-shell.dashboard.read`  | Read your own dashboard (`GET /ui/dashboard`)             | User, Admin |
| `core.ui-shell.dashboard.write` | Arrange and save your own dashboard (`PUT /ui/dashboard`) | User, Admin |

Both are plain (no resource): the owner is always the caller, and the route and the service check them. A save stores through the preference service as the
caller, so it also needs `core.settings.preference.write`. `GET /ui/navigation` needs none and stays public. A profile that lists the module gets the web
app in its image; a profile without it runs the API alone.

## How a module adds a page

A page has two halves that must list the same path. The test `ui/ui.test.ts` of this module is the pattern for a module's own.

1. **The server half**, data in the manifest, so the shell can decide who may see it without loading Svelte:

   ```ts
   contributes: {
     'ui.routes': [{ path: '/admin/users/:id', permission: 'core.identity.user.read' }],
     'ui.nav': [{ id: 'admin.users', label: 'nav.users', path: '/admin/users', section: 'admin',
                  order: 10, permission: 'core.identity.user.list' }],
   },
   ```

   A route entry needs `permission` or `public: true` with a `publicReason` (as `createRoute()` does). A link needs `permission` or
   `public: true` and shows only when the page it leads to is open to the caller too. `label` is a key of the message catalogue.
   Permissions are checked against the loaded modules when the shell starts: a typo stops the start. Paths are fixed lower-case words
   and `:param` segments, no trailing slash. The module depends on `core.ui-shell` as an **optional peer**, so it still starts in a
   profile without it.

2. **The browser half**, in the module's `ui/` folder and exported as `./ui` in its `package.json`:

   ```ts
   import type { UiRoute } from '@scorpion/contracts';
   export { messages } from './messages.ts'; // { en: { 'nav.users': 'Users' } }
   export default [
     { path: '/admin/users/:id', load: loadUser, component: () => import('./User.svelte') },
   ] satisfies UiRoute[];
   ```

   `load` runs on the server after the permission check, gets `params`, `url` and the typed `api` of the request, and **throws** when it
   cannot get its data (never a `Response`, defect 12). The component gets `data` and `params`. Build links with `getShell().href()`,
   call the API with `getShell().api`; ESLint refuses a literal `href="/…"` and a `fetch` with a written URL. `pnpm scorpion profile:generate`
   lists the modules of a profile that export `./ui` in `apps/web/src/generated/ui.ts`.

3. **A widget** (the bell in the header, a card of the dashboard) is a third part with the same two halves. The server half is an entry of
   `ui.widget`: `{ id, slot, component, order, permission }` (`slot` is `header` or `dashboard`, `component` a name that is unique across the
   modules of the profile). The browser half is `export const widgets: UiWidgets = { 'inbox-bell': () => import('./Bell.svelte') }` in the
   `ui` entry; **every `ui` entry exports `widgets`** (an empty object when it has none), and the generated list of the web app imports it.
   A widget reads what it needs with `getShell()` and the typed client, loads its data in the browser when it appears, and
   draws nothing the caller's permission would not give. `GET /ui/navigation` lists the widgets the caller may see; the header draws the `header`
   slot, and the start page draws the `dashboard` slot as cards under "What needs your attention" (nothing for a visitor or for a caller who has none).
   Since M11 a `dashboard` widget can also be a **tile of the widget grid**: see [the widget entry](#the-widget-entry-and-the-dashboard-grid).

Never add a SvelteKit route in `apps/web` for a module.

## `GET /ui/navigation`

Public (a signed-out visitor needs it), and `Cache-Control: no-store` (the answer depends on the caller). It returns

```json
{
  "nav": [
    {
      "id": "home",
      "label": "nav.home",
      "path": "/",
      "icon": "home",
      "section": "main",
      "order": 0
    }
  ],
  "routes": ["/", "/docs", "/legal/:page"],
  "widgets": [],
  "themes": [{ "id": "scorpionlight", "label": "theme.light", "colorScheme": "light" }]
}
```

`routes` is the list of page paths the caller may open. The catch-all route refuses (401 → sign-in page with a checked `returnTo`, 403)
a known page that is not in it, so the menu and the access check cannot disagree. The client never filters on its own. Sections come in
the order of their first entry, entries by `order` and then `id`.

## Pages of the shell

| Path           | Access | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`            | public | Start page: product and instance name from the branding settings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `/legal/:page` | public | `terms`, `privacy` or `imprint`, rendered from the Markdown of the branding settings by `GET /legal/{page}` (sanitised on the server; shown through `SafeHtml`). Write the text from level 2 down (`##`): the page has its own title. A page nobody wrote is a 404                                                                                                                                                                                                                                                                                         |
| `/docs`        | public | The landing page of the API documentation: how to get a token (the profile page, the permissions to tick, `Authorization: Bearer` or `X-API-Key`), the routes of this build and the permission each needs (from `apps/web/src/generated/openapi-v1.json`), the address of the OpenAPI document, the CORS note, and a link to the reference. It makes no API call of its own. The reference itself, `/docs/reference`, is a document of the web app's own (Scalar, [ADR-0038](../../docs/adr/0038-api-reference-with-scalar.md)), not a page of this module |

Public pages are declared in `ui/routes.ts` (and, for another module, in its own `ui/routes.ts`) with a reason each, and listed in `PUBLIC_PAGES` of `public.ts`; `apps/server/src/ui-routes.test.ts` fails for a public page of any module that
is not on the list of declared public pages.

### The administration of roles and settings (M5 sprint 3)

These pages need a permission, so none of them is in `PUBLIC_PAGES`, and a plain User gets a 403 on each path and finds none in the navigation. They live here, in the shell's
`ui/admin/`, and not in `core.authz` and `core.settings`: the shell depends on both, and a module that depends on the shell, even as an optional peer, would close a cycle in the
module graph (`packages/kernel/src/graph.ts` counts optional edges). The navigation entries `Roles` and `Settings` are the shell's for the same reason; `Users` and `Pending approvals`
are contributed by `core.identity`.

| Path                           | Permission                       | What                                                                                                                                                                                                                                                                                              |
| ------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/roles`                 | `core.authz.role.read`           | Each role (a tab) with its permissions grouped by module. Every role but Admin can be edited (`PUT /roles/{key}/permissions`, `core.authz.role.manage`, checked again by the route); edits are kept across tabs and leaving with edits not saved asks first                                       |
| `/admin/settings`              | `core.settings.read`             | A card for every module that has settings, and for branding, secrets and vocabularies                                                                                                                                                                                                             |
| `/admin/settings/:module`      | `core.settings.read`             | The settings of one module as a `SchemaForm` from the module's own schema (`GET /settings/{module}/schema`), saved with the version that was read; a 409 offers to load the current values, a 422 shows the server's messages on the fields. `core.settings` leaves its branding to the next page |
| `/admin/settings/branding`     | `core.settings.read`             | The branding of `core.settings`: names, contact, imprint address, **logos with an upload** (`POST /files`, `core.blob.manage`, the file is re-encoded by the server and only its hash is saved), and the legal texts (Markdown)                                                                   |
| `/admin/settings/secrets`      | `core.settings.read`             | The names and times of the stored secrets, and a form to set or replace one and a button to delete one. **A value is never shown and never sent back**; the box is emptied the moment it is sent. The names of the secrets a module needs are not listed (backlog)                                |
| `/admin/settings/vocabularies` | `core.settings.vocabulary.write` | Terms of a vocabulary: add, relabel in each language, reorder, deactivate and activate, remove (a declared or used term is deactivated, and the screen says so). Reading terms is self-service, so this page needs the write permission, or it would open to everyone                             |

The order of the paths matters only in that a fixed word beats `:module` (`/admin/settings/secrets` is never the settings of a module called `secrets`). The permission of a settings
form comes from the schemas: a module labels its fields with `.meta({ title, description, group, widget })` (see the `ui-kit` README). A schema with a field `.meta({ widget: 'logo' })`
gets the upload control.

## The widget entry and the dashboard grid

An entry of `ui.widget` is `{ id, slot, component, order, permission | public }` plus, since M11 sprint 1, five **optional** fields. Every entry that existed
stays valid; an entry of the `dashboard` slot without `grid` is a card of the old kind and is placeable at the default size 4×3. **Only entries of the
`dashboard` slot are tiles** (a `header` widget such as the inbox bell is not).

| Field          | Meaning                                                                                                                                                                                                                                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grid`         | `{ w, h, minW?, minH?, maxW?, maxH?, default?: { x, y, w, h }, singleton? }` on a grid of **12 columns**. `w` and `h` are the size when a person adds the widget; `min*` and `max*` bound a resize (at most 12 columns and 50 rows); `default` puts it on the dashboard of a person who has stored none; `singleton` allows one instance |
| `label`        | A key of the module's message catalogue: the name in the menu that adds a widget                                                                                                                                                                                                                                                         |
| `description`  | A key of the catalogue: the line under it                                                                                                                                                                                                                                                                                                |
| `icon`         | A name of the closed icon table (`@scorpion/contracts/icons`)                                                                                                                                                                                                                                                                            |
| `configSchema` | A Zod schema that validates and defaults the `config` of each placed instance (at most 400 bytes as JSON). It is not sent to the browser (a Zod schema is not JSON); the browser half edits the `config` it receives                                                                                                                     |

```ts
contributes: {
  'ui.widget': [{
    id: 'kpi.analytics.trends', slot: 'dashboard', component: 'KpiTrends', order: 20, permission: 'kpi.analytics.read',
    grid: { w: 6, h: 4, minW: 3, minH: 3, maxH: 8, default: { x: 0, y: 4, w: 6, h: 4 } },
    label: 'widget.trends', description: 'widget.trends.about', icon: 'list',
    configSchema: z.object({ range: z.enum(['3m', '6m', '1y', '2y', 'all']).default('1y') }),
  }],
},
```

These are checked **when the server starts** and a mistake stops it, naming the field: `minW` above `maxW` (or `minH` above `maxH`), a `w` or `h` outside its own limits,
a `default` outside the 12 columns or outside the limits, an icon that is not in the table, a `configSchema` that is not a Zod schema. A `default` is one
placement, so a singleton cannot have two. `GET /ui/navigation` lists `grid`, `label`, `description` and `icon` for the widgets the caller may see, only on
entries that have them.

**What the browser half receives (from sprint 2; not built yet).** A tile's component is rendered with `{ instance: string, config: unknown, editing: boolean,
setConfig(next): void, size: { w, h } }`. A widget that ignores the props (the cards that exist) works unchanged.

### The dashboard

A person's dashboard is one **document** in the user preference `core.ui-shell.dashboard` ([ADR-0042](../../docs/adr/0042-dashboard-document-and-grid.md)); the module
has no table, no migration and no event of its own.

```json
{
  "version": 1,
  "items": [
    {
      "id": "k3x9a2",
      "widget": "kpi.analytics.trends",
      "x": 0,
      "y": 0,
      "w": 6,
      "h": 4,
      "config": { "range": "1y" }
    }
  ]
}
```

At most 20 items; `id` is 4 to 12 lower-case letters and digits, unique in the document (the browser makes it); `0 <= x` and `x + w <= 12`; `config` at most 400 bytes as JSON;
the document at most 8 KiB. The pure functions are in `service/dashboard/document.ts`: `parseDashboard(raw, { entries, may })`, `serialiseDashboard(items)`, `migrate`,
`defaultDashboard(entries, may)` and the vertical packer `pack`. **The stored document is never trusted**: `parseDashboard` never throws and returns the tiles a
dashboard may show and what it dropped. It replaces the whole document by the default (`reset: true`) for a document the structure refuses, more than 20 items, or a
version it does not know; otherwise it drops a tile of an unknown widget, a widget the caller may not see, a bad or repeated id or a repeated singleton (each with a
reason), clamps sizes to the widget's limits, moves a tile into the grid, replaces a `config` that fails its schema by the widget's defaults (the tile stays), and moves
overlaps down. The default dashboard is the `dashboard`-slot entries with a `grid.default` that the caller may see.

| Route               | Permission                      | What                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /ui/dashboard` | `core.ui-shell.dashboard.read`  | `{ version, items, dropped, reset, resetReason?, isDefault }`: the caller's own dashboard, **repaired**, or the default when nothing is stored. A read changes nothing that is stored, so what it dropped (a module that left, a permission that was taken) comes back when the cause does. `Cache-Control: no-store`     |
| `PUT /ui/dashboard` | `core.ui-shell.dashboard.write` | `{ items }`: validates, moves overlaps down and stores the caller's own document; answers what a read now gives. A 422 names the field (`items[2].widget`, `items[2].config`, `.id`, `.w`, `.h`, `.x`, `.y`, or `items` for more than 20 tiles or a document over 8 KiB) and never repeats a value. Audited, no body kept |

Neither route takes a user id. The same document is reachable through the generic `GET /preferences` and `PUT /preferences/core.ui-shell.dashboard` (the structural
schema only: shape, finite numbers, at most 100 items), which is why only `GET /ui/dashboard` is the reader. The service (`dashboard.get`, `dashboard.save`) checks the
plain permission again, reads with `getUserPreference` and writes with `setUserPreference` of `core.settings` (the actor's own row, through the preference service).

Tests: `service/dashboard/document.test.ts` (table-driven repairs and `fast-check` properties with a fixed seed: any input parses without throwing and gives a valid,
packed, at most 8 KiB document; `parse(serialise(x))` equals `x`; parsing is idempotent), `registries.test.ts` (every start-stopping case) and
`apps/server/src/ui-dashboard-routes.test.ts` (the service and both routes over real Postgres, through the whole pipeline).
