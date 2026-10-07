# core.ui-shell

The shell of the web app: the registries through which modules put pages, links, dashboard cards and themes into it, and the one
route that tells the browser what the caller may see. It owns no table. The web app (`apps/web`) draws the layout and one catch-all
route `/[...path]`; this module is the part the server knows about ([ADR-0027](../../docs/adr/0027-web-shell-catch-all-proxy-and-typed-client.md)).

Status: M5 sprint 1. Its own pages are the start page, the legal pages and the API documentation; the screens of the other `core.*`
modules arrive in sprints 2 to 4.

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

Public pages are declared in `ui/routes.ts` with a reason each; `apps/server/src/ui-routes.test.ts` fails for a public page of any module that
is not on the list of declared public pages.
