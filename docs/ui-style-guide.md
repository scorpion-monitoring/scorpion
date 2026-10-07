# UI/UX style guide: how Scorpion applies it

Source: the "Scorpion UI/UX Style Guide" carried over from the previous build (data-first, electric precision, light and dark, branding by
settings). This page says what the rebuild takes as it is, what it changes and why, and what is still to do. Where the guide and WCAG 2.1 AA
(the plan's accessibility rule, enforced by axe in `apps/web/e2e`) disagree, AA wins.

## Applied (`apps/web/src/app.css`)

- **Dark theme** (`scorpiondark`): the guide's values unchanged. Every text pair measures 6.3:1 or more (primary on the page 12.6:1).
- **Light theme** (`scorpionlight`): the guide's surfaces, neutral content, secondary and accent unchanged. Four colours **darkened** because they fail AA:

  | Role    | Guide     | Used      | Why                                                                          |
  | ------- | --------- | --------- | ---------------------------------------------------------------------------- |
  | Primary | `#0082C8` | `#006DA8` | 3.9:1 as text on the page and 4.2:1 under white button text; now 5.2 and 5.6 |
  | Error   | `#EF4444` | `#B91C1C` | 3.5:1 as the `text-error` of a field message; now 6.1                        |
  | Success | `#10B981` | `#047857` | 2.5:1 under white; now 5.5                                                   |
  | Warning | `#F59E0B` | `#92400E` | 2.0:1 as text; now 6.6                                                       |

  The guide's bright tones are kept as `--scorpion-glow` (decoration, chart series) and never carry text. Accent `#29B6F6` is 2.2:1 on the page, so
  it is a fill or a halo, not a ring that has to be seen on its own.

- **Focus** (§6): every control gets a 2 px primary ring with a 2 px offset (CSS, `:focus-visible`), plus the dark-mode halo.
- **Glow cap** (§6): the dark halo is `0 0 8px` at 0.35 opacity, the guide's ceiling.
- **Muted content** as `.text-muted` (`#475569` light, `#94A3B8` dark: 6.4:1 and 6.8:1 on cards) and `.num` (mono, tabular figures).
- Theme names stay `scorpionlight` and `scorpiondark` (DaisyUI names, used by the toggle, the logos and the tests); the guide's camel case is not needed.

Checked by axe over every screen in both themes (`accessibility*.spec.ts`, the `components` project): no serious or critical finding.

## Still to do to apply the guide fully

1. **Branding by settings (§1).** Names and logos come from settings already. Colours do not: add `branding.palette` (primary, secondary, accent for each theme) to the
   `core.settings` schema, emit it as CSS custom properties from the layout (a `<style nonce>` or a generated stylesheet route, since the CSP has no `unsafe-inline`),
   and **refuse a primary that fails 4.5:1** on the surface and under its content colour. Presets (de.NBI, NFDI4Biodiversity) are two stored values.
2. **Typography (§4).** Add the Display KPI, Heading 1/2, Body and Caption styles as component classes (`.kpi`, `.eyebrow`) and use them in the shared components.
   Apply `.num` to table cells that hold numbers (a `numeric` flag on `DataTable` columns, right-aligned), to pagination ranges and to chart tables. Choose the sans font
   (the guide shows Roboto) and self-host it: the CSP allows `font-src 'self'` only. Today the UI uses the system stack.
3. **`DataTable` (§5).** Sticky header with uppercase captions, zebra rows and a primary hover tint, right-aligned ghost actions (the last two exist per row but the actions column is not right-aligned).
   The header text must stay at 4.5:1: DaisyUI's table head dims it, which is why the components force `text-base-content`.
4. **Metric summary card** (new `ui-kit` component, needed by M13): surface-200 card, top accent line, mono bold primary value (3:1 is enough for display size), Δ% with an arrow _and_ a text
   sign, so direction is not told by colour alone.
5. **Chart adapter (§5).** Series colours today are primary, secondary, accent, info, success, warning of the theme. The guide wants cyan, neon blue, emerald, amber with dashed, quiet grid lines
   and a transparent canvas: set `splitLine.lineStyle.type = 'dashed'` and a fixed series palette per theme in `themeFromElement`. Add a second cue (marker shape or dash) per series: four hues are
   not enough for colour-blind readers. Dark series on `#0E1738` need 3:1 each (cyan, blue, emerald and amber pass; check the "neon blue").
6. **Cytoscape graphs (§5).** Not built (M16). Glow borders on nodes are subject to the same 8 px / 0.35 cap, and node state must not rely on glow colour alone.
7. **Inline errors (§6).** Done as `text-error text-sm` under the field (`FieldShell`); the guide says `text-xs mt-1`. Moving to `text-xs` makes the message smaller than the label's hint and is a loss for
   low vision, so I kept `text-sm`: decide whether the guide or the reader wins.
8. **Input borders.** `base-300` on `base-100` is 1.25:1 in light and 1.34:1 in dark, below the 3:1 WCAG 1.4.11 asks of a control's boundary. DaisyUI draws input borders from the content colour, so inputs
   pass today; any custom control that borrows `base-300` for its edge must not.
9. **Brand assets.** The numeric scorpion logo and favicons (light and dark) are not in the repository; they arrive through branding settings (`logos.light`, `logos.dark`). A default pair and a
   `<link rel="icon" media="(prefers-color-scheme)">` pair would make a fresh install look right.
