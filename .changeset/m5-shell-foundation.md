---
'scorpion': minor
---

The web app arrives (M5, first part). A profile that lists `core.ui-shell` (`full` and `kpi-tracker`) now has a web server in its image next to the API: it is the public origin (default port 3000), serves the pages, and passes `/api`, `/healthz` and `/readyz` on to the API, which listens on `API_PORT` (default 3001) and is not meant to be published. **Publish `PORT` only.** `/metrics` is served by the API on `API_PORT` and is no longer reachable on the public port of these profiles: point scrapers at the API port. Profiles without the shell run the API alone on `PORT`, as before. The image starts both processes with `scripts/image-run.ts` and stops both together.

What visitors get: a layout with header, a menu that shows only what the caller may open (decided on the server by the new public route `GET /ui/navigation`), light, dark and system themes, the account menu with a logout control on every page, the start page, the three legal pages (from the Markdown in the branding settings, sanitised on the server), a page that lists the public API, and error pages. `BASE_PATH` of any number of segments works for pages, assets and links; one build serves any prefix. A stricter Content-Security-Policy (no `unsafe-inline`), `X-Frame-Options`, `Referrer-Policy` and `Permissions-Policy` are set on every page. Sign-in and the account screens follow in the next parts of M5; until then sign in through the API.

For module authors: modules contribute pages, links, cards and themes through the registries of `core.ui-shell` (`ui.routes`, `ui.nav`, `ui.widget`, `ui.theme`) and a `./ui` export, never as SvelteKit routes; see the module README. New in `@scorpion/contracts`: `url()`, the typed client generated from the routes, and the types of a page.

Also fixed: every route of `core.settings` answered 500 in a running server (not in tests), because the server built the settings context before the other modules' services existed. A new root script `pnpm openapi:generate` writes the client types; `pnpm check` fails when they are out of date.

New runtime dependency: `openapi-fetch` (the typed client, about 6 kB). `PORT`, `BASE_PATH` and `ORIGIN` mean what they meant; new optional variables: `API_PORT` and, for the web process alone, `API_ORIGIN`.
