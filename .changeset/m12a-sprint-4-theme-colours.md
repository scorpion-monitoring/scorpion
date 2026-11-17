---
'scorpion': minor
---

Administrators can change the colours of both themes, light and dark, in **Administration → Settings → Branding**, under **Colours**. Each theme is a tab with every colour of the interface (primary, secondary, accent, neutral, the page, cards and raised parts, info, success, warning, error, and the text on each), a preview, and a button that resets the theme to the built-in colours. A colour left empty keeps the built-in one; a text colour left empty is set to black or white, whichever reads better.

- **Readable by rule.** A set is refused on save when any text or focus ring would fall below WCAG AA (4.5:1 for text, 3:1 for focus rings) in either theme; the message names the theme and the pair, for example "In the dark theme, error-content on error is 1.00:1, needs 4.5:1". The screen shows the same check while you edit.
- **Colours only.** Each value is a colour written as `#rrggbb`; anything else is refused.
- **Delivery.** The colours reach the browser as a stylesheet from the instance itself, `<base path>/theme.css`, cached for five minutes at an address that changes with every saved set, so a change shows on the next page load. The page's Content-Security-Policy is unchanged. An instance that sets no colour looks exactly as before and loads no extra file.
- The branding read (`GET /api/internal/branding`) gains `colors` and `themeVersion`; public API v1 is unchanged.

Server messages for a single branding field now appear on that field in the Branding screen; before, they were shown only in the summary at the top.
