# ADR-0038: the API reference with Scalar: a document of its own, self-hosted, with a policy of its own

- Status: Accepted (sprint 3 of M8)
- Date: 2026-10-14
- Supersedes: Decision 4 of [the M8 plan](../m8-sprint-plan.md) (extend the existing renderer, no new dependency, no CSP relaxation)

## Context

M8 makes the public API (`/api/v1`, [ADR-0037](0037-public-api.md)) real. A person who wants to use it needs three things in one place: what
each route does, how to get a token, and a way to try a call with that token. The first version of `/docs` was a table of routes drawn by the
shell. The maintainer decided on 2026-10-14 (plan Decision 9) that the reference is drawn by **Scalar**
([`@scalar/sveltekit`](https://scalar.com/products/api-references/integrations/sveltekit)), behind a landing page that stays a page of the shell.

Scalar is a large browser application: it writes `<style>` elements and `style` attributes at run time, ships fonts and a telemetry client,
knows a proxy, an AI agent and an MCP generator of its own, and by default loads itself from a CDN **without a version**. On a public page of
an instance that holds the registry of a research infrastructure, none of that may happen by accident. This ADR records what we ship, what
stays off, and the one exception to the instance's Content-Security-Policy.

**The prototype in the real route** (`GET /docs/reference`, `@scalar/sveltekit` 0.3.29 and `@scalar/api-reference` 1.74.0, headless Chromium,
under `BASE_PATH=/` and `BASE_PATH=/a/b`, with the policy below exactly as written) showed:

- The routes of the committed document are drawn (the six of v0.10.0, the spec route included) from our own origin. A page load makes **three
  requests, all to this origin**: the document, the script, `/api/v1/openapi.json`. `page.on('request')` saw no other host.
- `localStorage`, `sessionStorage` and the cookies are empty after the load, and **unchanged after a token is pasted and a call is sent**. The
  token is only in the memory of the page. (One option, `defaultHttpClient`, made Scalar write `scalar-reference-selected-client-v2` on load; it
  is left out.)
- A token with the scope gets **200** and the legacy envelope in Scalar's own panel; a token without the scope gets **403**.
- No console message about the policy, and one `securitypolicyviolation` event on load: the bundle's copy of Zod tests whether it may compile
  validators with `try { Function('') } catch {}`. The policy has no `'unsafe-eval'`, so the test fails, Zod takes its interpreted path, and
  nothing is lost. The policy is **not** widened for it; the end-to-end test names this one report and fails on any other.
- axe (WCAG 2.1 A and AA) is clean in the light and the dark theme, with one change of ours: the dark theme takes its accent for code keywords,
  because the light theme's deep blue measured 1.32:1 on the dark background.
- The bundle is a single file (4.5 MB, no lazy chunks, no `eval` of its own). With a `nonce` the wrapper uses it; the ESM build with its 224
  chunks is not used (its `import()` cannot carry a nonce). Without a `cdn` the wrapper loads from `cdn.jsdelivr.net/npm/@scalar/api-reference`
  with no version.
- Without extra options the sidebar carries Scalar's own offers (an "Open API Client" button, "Developer Portals", "SDKs", "Agent Scalar",
  "Generate SDKs & MCP"); they are links to a third party and are switched off (below).
- Scalar's interface is English. `@scalar/api-reference` 1.74.0 has no `locale` option and `<html lang>` does not change it (tried with `de`).

## Decision

### 1. Scalar, as a document of its own

The reference is **`GET <base>/docs/reference`**, a complete HTML document made by `@scalar/sveltekit`'s `ScalarApiReference()`, not a Svelte
page. It draws `<base>/api/v1/openapi.json`, the runtime document of `public-api` (ADR-0037, decision 3), so the server URL in the panel is the
origin of the request plus the base path, and the document is the one the instance really serves. The landing page `/docs` stays a page of
`core.ui-shell` (themed, en and de, in the shell's frame) and links to the reference with `data-sveltekit-reload`: a document of its own needs a
full load, not a client-side navigation.

**The route is a SvelteKit filesystem route of the shell (`apps/web/src/routes/docs/reference/+server.ts`), outside the rule "UI routes go
through the registry".** The rule exists so that a module cannot add a page behind the shell's back. This route is not a page of a module: it
answers a document of its own, with headers of its own, and the registry cannot express either. It is `GET` only, thin (the page is built in
`src/lib/server/reference.ts`, which is tested apart), takes no input, and needs no permission, as the landing page and the spec it draws are
public (the same reason as ADR-0037, decision 3). SvelteKit's catch-all for the registry (`[...path]`) loses to the more specific route.

### 2. Self-hosted and pinned

`@scalar/sveltekit` is a **dependency** of `apps/web` and `@scalar/api-reference` a **development dependency**, both pinned to exact versions
(`0.3.29` and `1.74.0`); they are a pair, and an upgrade moves both. Only the built file `dist/browser/standalone.js` of the second is used: a
small Vite plugin (`src/front/scalar-asset-plugin.ts`) reads it from the package's directory (its `exports` do not offer it), drops the trailing
`sourceMappingURL` comment (the 17 MB map is not shipped), and emits it into the client build as
`_app/immutable/scalar/api-reference.<hash>.js`, where adapter-node serves it with a one-year `immutable` cache and, precompressed, as brotli
and gzip. Nothing of it is committed. The route passes the address (built with `url()` from the base path, never a literal `/`) as the
wrapper's `cdn` option. **Nothing of Scalar loads from or talks to another host.** The wrapper's own default (a CDN without a version) is never
reached, and a unit test fails when the document names any host.

### 3. The options that stay off

| Option                              | Why                                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `persistAuth` (off)                 | It would keep the token in `localStorage`. A token is a secret: it lives in the page until the page closes.                                                                                 |
| `proxyUrl`, `proxy`, `fetch` (none) | Scalar's proxy would send the person's request, and their token, through a third party. The try-it-out calls this origin directly.                                                          |
| `telemetry: false`                  | No usage data leaves the page.                                                                                                                                                              |
| `withDefaultFonts: false`           | The default fonts come from `fonts.scalar.com`; the page uses the system's.                                                                                                                 |
| `agent: { disabled: true }`         | Scalar's AI agent is a service of the vendor.                                                                                                                                               |
| `mcp: { disabled: true }`           | The MCP generator is a service of the vendor.                                                                                                                                               |
| `hideClientButton: true`            | The sidebar button of Scalar's stand-alone client carries the vendor's offers. The "Test Request" button of each operation stays.                                                           |
| `showDeveloperTools: 'never'`       | No developer toolbar.                                                                                                                                                                       |
| `servers`, `baseServerURL` (none)   | The document's own server, this origin plus the base path, is the only one. A person can type another address into the panel, but `connect-src 'self'` makes the browser refuse to send it. |
| `defaultHttpClient` (none)          | Setting it makes Scalar write its choice to `localStorage` on load.                                                                                                                         |
| `hideDarkModeToggle: true`          | One switch for the whole site: the shell's (below).                                                                                                                                         |

The strings `fonts.scalar.com`, `proxy.scalar.com`, `api.scalar.com`, `dashboard.scalar.com`, `client.scalar.com` and `web-pulse.io` are in the
bundle; the options above are what keeps them unreached and `connect-src 'self'` is what would refuse them if one were not. The remaining link
to the vendor is its "Powered by Scalar" footer, a plain link that is followed only by a click.

### 4. The Content-Security-Policy of this document, and of no other

```text
default-src 'none'; script-src 'self' 'nonce-<nonce>'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';
connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'
```

It is built per request by `referencePolicy()`. It is the policy of every other page ([vite.config.ts](../../apps/web/vite.config.ts): the same
`default-src 'none'`, `'self'`, nonces for scripts) in all but two directives:

- **`style-src 'self' 'unsafe-inline'`** is the exception. Scalar creates `<style>` elements and sets `style` attributes while it runs (the
  layout, the sidebar, the code highlighter). A nonce cannot authorise an attribute, and a nonce in `style-src` would make browsers ignore
  `'unsafe-inline'`, so the directive has none. Measured on the real document: 19 violations under the shell's policy, 4 with
  `style-src-attr 'unsafe-inline'` added, none with `style-src 'unsafe-inline'`. The risk is injected CSS on this document; it shows no session
  data and no record, takes no input from the address (the page is the same for every request), and the instance name in it is escaped.
- **`form-action 'none'`** (the shell's is `'self'`): the document has no form.
- `script-src 'self' 'nonce-…'` has **no `'unsafe-inline'`, no `'unsafe-eval'` and no `'strict-dynamic'`**. Every inline script (the wrapper's
  start-up script, our theme script) carries the nonce of this response, and the script file is this origin's.
- `connect-src 'self'`: the page can call this origin and nothing else, which is also what keeps a token from going to a server a person types
  into the panel.
- `img-src 'self' data:`, `font-src 'self'`, `manifest-src 'self'`: as the shell. `base-uri`, `frame-ancestors` and `object-src` are `'none'`.

The route also sends `Cache-Control: no-cache` (the page holds a nonce, the script is cached by its own immutable address), and the other
headers of the web app (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, COOP, CORP, HSTS, `Permissions-Policy`) come from the
hook as for every response. **Every other page keeps the strict policy**: `e2e/security-headers.spec.ts` asserts it on each of its paths and
the reference has its own test with the policy above, character for character.

### 5. The theme and the page around it

The reference follows the shell. Its variables (`--scalar-*`) are written once in `src/lib/server/reference-theme.ts` from the two DaisyUI
themes `scorpionlight` and `scorpiondark` and delivered as the wrapper's `customCss`; a test reads `app.css` and fails when a colour drifts.
Scalar's own light and dark switch is hidden; a small inline script (with the nonce) runs before Scalar starts and sets its starting mode from
the shell's `scorpion.theme` (read, never written), else from `prefers-color-scheme`. A slim bar above the page names the instance (from
`core.settings`, escaped) and links back to `/docs` in the language the browser asks for (`Accept-Language`; the saved preference of a signed-in person would cost
two more API calls on a page that has one text to translate: measured 4 calls signed in against 2 without it). The document is `lang="en"`, as Scalar's text is English; the
landing page is en and de.

The document is the wrapper's HTML with four additions, made by string replacement on markers that the code checks (a change in the wrapper's
output is an error, not a silent change): `<html lang>`, a `color-scheme` meta, the bar, and the theme script.

### 6. Tailwind

Scalar uses Tailwind's cascade layers; so does the shell. They meet only when both styles are in one document, in which case Scalar's guide
asks for `@layer scalar-base, scalar-theme, scalar-config, theme, base, components, utilities;` before `@import "tailwindcss"`. **The reference
is a document of its own and the shell's stylesheet is not in it, so this does not apply.** It is recorded for the day Scalar is embedded in a
page of the shell.

### 7. What an upgrade of Scalar has to pass

Dependabot may propose both packages; the pull request is merged only when:

1. `reference.test.ts` and `reference-theme.test.ts` pass (the options, the nonce on every tag, no host, the policy, the markers).
2. The journey in `e2e/reference.spec.ts` passes under both base paths: the routes drawn, a token pasted, 200 with the scope and 403 without,
   nothing in the browser's storage, no request to another origin, and **exactly** the policy reports named there (today: the one Zod probe).
3. axe is clean on the landing page and the reference in both themes.
4. The ranges of the two packages are moved together, and a new option or a new vendor host in the bundle (`grep` of the strings above) is
   read before it is merged.

### 8. The security schemes of the document

So that the panel can take a token, `generateV1Document()` declares `components.securitySchemes` (`HTTPBearer`, an `http` scheme `bearer`; and
`APIKeyHeader`, an `apiKey` in the header `X-API-Key`), puts `security` (either scheme) on every operation that is not public, and appends
"Needs the scope `<permission>`." to the operation's description. The spec route has no `security`. The change is additive, so the committed
document is still the first contract (ADR-0037, decision 7), and the runtime and the committed documents are still the same function.

## Consequences

- A new dependency pair (MIT; `@scalar/sveltekit` brings `@scalar/client-side-rendering` and four small `@scalar/*` packages to the image's
  runtime; `@scalar/api-reference` is installed only to build). The reference script is 4.5 MB on disk and, precompressed, 1.0 MB as brotli
  (measured in the backlog); it is fetched only by a person who opens the reference, and cached for a year.
- A second Content-Security-Policy to keep in step with the first. The test that pins it and the one that pins the strict one are the guard.
- The reference is English. If Scalar adds a locale option, the route can pass the visitor's language; nothing else changes.
- A person who types a different server into the panel gets a refused request, not a leaked token.
- Pinned versions age. The upgrade checklist above is the price; the alternative, the CDN, would have given a page nobody had reviewed.

## Alternatives rejected

- **Swagger UI:** the same kind of dependency (a browser application with its own styles and its own try-it-out) for a result the maintainer
  did not choose; not evaluated further.
- **Extending the existing renderer** with a try-it-out form (the former Decision 4): no new dependency and no policy exception, but the
  authentication, the request builder and the response viewer would be ours to write and keep accessible. Superseded by the maintainer's
  decision.
- **An iframe** of the reference in a shell page: `frame-ancestors 'none'` and `X-Frame-Options: DENY` would have to give way for the one
  document, which is a wider exception than the style one; the document is full-page anyway.
- **The CDN** (Scalar's default): a script from a third party, with no version, on a public page, with `script-src` and `connect-src` opened
  to its host.
- **Allowing only `style-src-attr` and nonces for elements**: measured, four violations remain.
- **Adding `'unsafe-eval'`** for Zod's probe: nothing is gained, the fallback works, and the policy would carry a directive that matters.
