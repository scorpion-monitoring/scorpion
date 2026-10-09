# core.ui-shell

The shell of the web app: the registries through which modules put pages, links, dashboard cards and themes into it, and the one
route that tells the browser what the caller may see. It owns no table. The web app (`apps/web`) draws the layout and one catch-all
route `/[...path]`; this module is the part the server knows about ([ADR-0027](../../docs/adr/0027-web-shell-catch-all-proxy-and-typed-client.md)).

Status: M5 sprint 3. Its own pages are the start page, the legal pages, the API documentation and the administration of roles and settings; the screens of the other `core.*`
modules come with those modules (the sign-in, registration, recovery and profile pages and the administration of users are `core.identity`'s; the audit and notification screens arrive in sprint 4).

## Manifest

| Part           | Value                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id             | `core.ui-shell`                                                                                                                                                                       |
| table prefix   | none: the module has no table                                                                                                                                                         |
| dependencies   | `core.authz` (to decide what a caller may see), `core.settings` (the branding every page shows). The package also lists `@scorpion/ui-kit` as a development dependency, for its pages |
| routes         | internal API: `GET /ui/navigation` (public)                                                                                                                                           |
| jobs, CLI      | none                                                                                                                                                                                  |
| events         | emits and subscribes to none                                                                                                                                                          |
| registries     | declares `ui.routes`, `ui.nav`, `ui.widget` and `ui.theme`; contributes its own pages, two links and the two themes                                                                   |
| ui             | package export `./ui`: the browser half of its pages (`ui/index.ts`), imported by the web app only                                                                                    |
| public service | `ctx.deps['core.ui-shell']`: `navigation(actor)`. No other module calls it; the entry types are in `public.ts`                                                                        |

Permissions: none. A profile that lists the module gets the web app in its image; a profile without it runs the API alone.

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
   A widget takes no props: it reads what it needs with `getShell()` and the typed client, loads its data in the browser when it appears, and
   draws nothing the caller's permission would not give. `GET /ui/navigation` lists the widgets the caller may see; the header draws the `header`
   slot, and the start page draws the `dashboard` slot as cards under "What needs your attention" (nothing for a visitor or for a caller who has none).

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

| Path           | Access | What                                                                                                                                                                                                                                                               |
| -------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`            | public | Start page: product and instance name from the branding settings                                                                                                                                                                                                   |
| `/legal/:page` | public | `terms`, `privacy` or `imprint`, rendered from the Markdown of the branding settings by `GET /legal/{page}` (sanitised on the server; shown through `SafeHtml`). Write the text from level 2 down (`##`): the page has its own title. A page nobody wrote is a 404 |
| `/docs`        | public | The operations of the public API (v1) of this build, from `apps/web/src/generated/openapi-v1.json`. v1 has no routes before M8                                                                                                                                     |

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
