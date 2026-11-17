# ADR-0051: Theme colours reach the page as a stylesheet route, never as inline style

- Status: Accepted (sprint 4 of M12a)
- Date: 2026-11-17
- Relates to: [ADR-0018](0018-vocabularies-blob-store-and-branding.md) (branding in core.settings), [ADR-0038](0038-api-reference-with-scalar.md) (the one page with a policy of its own)

## Context

The maintainer decided on 2026-11-06 that an administrator controls **every** daisyUI colour token of both themes (`scorpionlight`,
`scorpiondark`) from the branding settings ([M12a plan](../m12a-plan.md), sprint 4, "full control"). The colours have to reach the browser as
CSS custom properties (`--color-primary`, …) that override the built-in themes of `apps/web/src/app.css`.

The page's policy (`apps/web/vite.config.ts`) allows styles from `'self'` only: no `'unsafe-inline'`, and one hashed inline style (SvelteKit's
route announcer). The obvious ways to put per-instance values into a page are each a change to that policy or a risk:

- A `style` attribute on `<html>` needs `'unsafe-inline'` (or `'unsafe-hashes'` with a hash per value set), which every other page would share.
- A `<style nonce>` in the layout keeps the policy as written, but puts administrator data into an inline element of every page; the nonce
  then vouches for whatever text the data turns into, and a mistake in escaping becomes CSS injection on every page.
- Setting the variables from script (CSSOM is not covered by `style-src`) needs a script before the first paint, or the page flashes in the
  built-in colours, and it moves a rendering decision into a script.

## Decision

1. **A stylesheet route of the web app**: `GET <BASE_PATH>/theme.css`, a route of the shell (like the API reference of ADR-0038, outside the
   registry rule of CLAUDE.md, rule 10). It reads the branding (`GET /api/internal/branding`, public) and answers `text/css; charset=utf-8`.
   The page's policy is **unchanged**: `style-src 'self'` admits it, and no `style-src` source, hash or nonce is added.
2. **The layout links it only when a colour is set**: `<link rel="stylesheet" href="<BASE_PATH>/theme.css?v=<themeVersion>">`. With no colour
   set the page has no link and is the page of before, pixel for pixel. The route still answers (a comment and no rule) for any caller.
3. **Values are data, never CSS.** The schema of `branding.colors` accepts the 20 token names and `#rrggbb` values only (a strict object, so
   an unknown name is a 422). The sheet is written by one function, `themeStylesheet` of `@scorpion/contracts/theme-colors`, which takes the
   token names from its own list and drops every value that is not `#rrggbb` **before** writing; nothing is escaped, because nothing that
   would need escaping can pass. A hostile value (`red;}body{display:none`, `</style>`, a `url(…)`) is refused at save and, by a unit test,
   cannot reach the sheet even if it were stored.
4. **Selectors and the cascade.** daisyUI emits the built-in themes inside `@layer base`; the sheet is not in a layer, so it wins by the
   cascade whatever the specificity, and its load order does not matter. The light rules match only a light page
   (`@media not all and (prefers-color-scheme: dark) { :root:not([data-theme]) }` and `[data-theme='scorpionlight']`), the dark rules only a
   dark one, so a token set for one theme never leaks into the other.
5. **The version and the cache.** `themeVersion` is the first 16 hex digits of the SHA-256 of the sheet, computed by core.settings with the
   branding read (`null` when nothing is set). A changed set has a new address, so a browser sees it on the next page load (the settings cache
   of other processes bounds that at five seconds). The sheet is `Cache-Control: public, max-age=300` **only when the `v` of the address is
   the current version**; any other address (none, an old one, a typo) gets the current sheet with `no-cache`. Without that rule a request that
   reached an API process whose settings cache had not yet seen a save could keep the old colours under the new address for five minutes.
   The response carries the web app's usual headers (`X-Content-Type-Options: nosniff` among them).
6. **No session.** The sheet is the same for every visitor and the sign-in page needs it, so the route reads only the public branding and
   answers without a session; it holds nothing that is not already in `GET /branding`.

## Consequences

- The policy test (`e2e/security-headers.spec.ts`) and the inline-style scan (`no-inline-style.test.ts`) are unchanged and pass; a custom set
  is applied in `e2e/theme-colours.spec.ts` with a check that the page reports no policy violation.
- One more request on a page load of an instance with colours (cached for five minutes); none for an instance without.
- The admin preview draws the colours as SVG `fill` and `stroke` attributes, which are presentation attributes and not inline style, so it
  needs no exception either.
- Colours outside the daisyUI tokens (`--scorpion-muted`, `--scorpion-glow`) and the API reference's own palette (ADR-0038) stay built in
  (backlog).
- A content colour left unset is derived (black or white) by the same module, and the contrast check (WCAG AA, per theme, on save) runs in
  the settings service, not in the schema: a stored value the schema refuses is dropped on read with its whole top-level key, which would
  drop all of `branding`.
