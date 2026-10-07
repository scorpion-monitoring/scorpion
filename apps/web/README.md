# @scorpion/web

The web app: SvelteKit 3 with `adapter-node`, Tailwind and DaisyUI. It is the **public origin** of a deployment; the API runs behind it
([ADR-0027](../../docs/adr/0027-web-shell-catch-all-proxy-and-typed-client.md)).

| Part                        | What                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/front/`                | The front: takes `BASE_PATH` off every request, streams `/api`, `/healthz` and `/readyz` to the API (`API_ORIGIN`), runs the SvelteKit build. `main.ts` is the process of an image; `vite-plugin.ts` is the same code for `pnpm dev` |
| `src/hooks.server.ts`       | Security headers, the API client of the request, who is signed in (`GET /auth/me`) and what they may see (`GET /ui/navigation`), asked once per request                                                                              |
| `src/routes/[...path]/`     | The one route for the pages of modules: finds the page in the generated table, checks the caller may open it, runs its `load`                                                                                                        |
| `src/routes/+layout.svelte` | Header, sidebar, footer, theme toggle, account menu with the logout control                                                                                                                                                          |
| `src/lib/server/page.ts`    | The decision of the catch-all route (404, sign-in redirect, 403, the loader's errors), tested without SvelteKit                                                                                                                      |
| `src/generated/`            | Written by `pnpm scorpion profile:generate` and `pnpm openapi:generate`; `pnpm check` fails on a diff. Never edit                                                                                                                    |
| `e2e/`                      | Playwright tests against the real API and a PostgreSQL container, under `BASE_PATH=/` and `/a/b` (`playwright.config.ts`)                                                                                                            |

Environment (read when the process starts, so one build serves any prefix): `PORT` (default 3000), `BASE_PATH` (default `/`), `API_ORIGIN`
(default `http://127.0.0.1:3001`), and `ORIGIN` for adapter-node. The browser sees one origin: one cookie, no CORS.

```bash
pnpm dev                  # API on PORT+1, this app on PORT (default 3000)
pnpm test:e2e             # builds the app, starts Postgres, API and web per base path, runs Playwright
E2E_KEEP_BUILD=1 pnpm test:e2e   # reuse the last build
```

Rules (CLAUDE.md, ADR-0027): the API is called through the typed client only; every link is built with `href()` / `url()`; `{@html}` only
in `SafeHtml`; a loader throws, it never returns a `Response`; modules add no SvelteKit route here.
