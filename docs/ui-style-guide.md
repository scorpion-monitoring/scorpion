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

- **Branding by settings (§1), the colours** (M12a sprint 4, [ADR-0051](adr/0051-theme-stylesheet-route.md)). An administrator sets any daisyUI token of either
  theme in the Branding screen (`branding.colors` of `core.settings`; the guide asked for a `branding.palette` of three colours, the maintainer decided on **full
  control**). Unset tokens keep the values above. The web app serves the set as `GET /theme.css` from its own origin, linked only when a colour is set, so the
  CSP is unchanged. A save is refused when a pair fails WCAG AA in either theme: each content colour on its colour, `base-content` on the three surfaces,
  `primary`, `error` and `warning` as text on the page (4.5:1), and the primary focus ring on `base-200` and `base-300` (3:1); the refusal names the pair.
  A text colour left empty is derived (black or white, whichever reads better). `--scorpion-muted`
  and `--scorpion-glow` are not tokens and keep their values (backlog).
- **No fixed colour** in the pages of the modules or in ui-kit: `apps/web/src/no-hardcoded-colour.test.ts` fails for a hex value, a colour function, a
  Tailwind palette class (`text-red-500`, `bg-white`) or a colour attribute; the chart adapter's `themeFromElement` is the one palette definition.

Checked by axe over every screen in both themes (`accessibility*.spec.ts`, the `components` project), and over the main screens and the chart with a custom set of
colours (`accessibility-theme-colours.spec.ts`): no serious or critical finding.

## Filters of a list: three looks (M12a sprint 3)

The service catalogues filter with `FacetSearch` of ui-kit (`packages/ui-kit/README.md`). One state behind three looks; an administrator picks
one for both catalogues (setting `catalogueFilters` of `registry.services`). Every look searches as one types, counts each facet over the other
facets, keeps a chosen value with no match at 0, writes the same address, says "N services match" above the table and in a polite live region,
and is checked by axe in both themes. What differs is how much room the filters take and what they ask of the reader.

| Look       | What it is                                                                                                                          | Choose it when                                                                                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `combined` | One box: typing searches the names and offers matching values; the chosen facets are chips in the box; focusing it lists the facets | Most people look for a known service (the default for a new instance). Any number of facets and values takes two lines at most at 360 px. Proved with NVDA in CI; VoiceOver is checked nightly only.           |
| `bar`      | A search box, a row of facet buttons that open a value panel (a bottom sheet on a phone), one chip per facet                        | People narrow a set by facets and want to see which facets exist without opening anything, or a screen-reader user prefers plain disclosure buttons and listboxes.                                             |
| `sidebar`  | The search box, and every facet as a list of checkboxes beside the table from `lg` (above it on a phone)                            | There are few facets with few values and people compare counts at a glance. A facet with many values makes the page long; on a phone the checkboxes come before the first service. Existing instances keep it. |

Rules every look keeps: colours only from daisyUI tokens; a chip shows its facet and values (`Provider: IPK Gatersleben +2`) and is named with all of
them; a value panel lists at most 50 values with a filter field above 8; the list of `combined` is drawn in the flow under the box, never over the
results; the focus never jumps on its own (after a removed chip it goes to the next chip, then to the box).

## Still to do to apply the guide fully

1. **Typography (§4).** Add the Display KPI, Heading 1/2, Body and Caption styles as component classes (`.kpi`, `.eyebrow`) and use them in the shared components.
   Apply `.num` to table cells that hold numbers (a `numeric` flag on `DataTable` columns, right-aligned), to pagination ranges and to chart tables. Choose the sans font
   (the guide shows Roboto) and self-host it: the CSP allows `font-src 'self'` only. Today the UI uses the system stack.
2. **`DataTable` (§5).** Sticky header with uppercase captions, zebra rows and a primary hover tint, right-aligned ghost actions (the last two exist per row but the actions column is not right-aligned).
   The header text must stay at 4.5:1: DaisyUI's table head dims it, which is why the components force `text-base-content`.
3. **Metric summary card** (new `ui-kit` component, needed by M13): surface-200 card, top accent line, mono bold primary value (3:1 is enough for display size), Δ% with an arrow _and_ a text
   sign, so direction is not told by colour alone.
4. **Chart adapter (§5).** Series colours today are primary, secondary, accent, info, success, warning of the theme. The guide wants cyan, neon blue, emerald, amber with dashed, quiet grid lines
   and a transparent canvas: set `splitLine.lineStyle.type = 'dashed'` and a fixed series palette per theme in `themeFromElement`. Add a second cue (marker shape or dash) per series: four hues are
   not enough for colour-blind readers. Dark series on `#0E1738` need 3:1 each (cyan, blue, emerald and amber pass; check the "neon blue").
5. **Cytoscape graphs (§5).** Not built (M16). Glow borders on nodes are subject to the same 8 px / 0.35 cap, and node state must not rely on glow colour alone.
6. **Inline errors (§6).** Done as `text-error text-sm` under the field (`FieldShell`); the guide says `text-xs mt-1`. Moving to `text-xs` makes the message smaller than the label's hint and is a loss for
   low vision, so I kept `text-sm`: decide whether the guide or the reader wins.
7. **Input borders.** `base-300` on `base-100` is 1.25:1 in light and 1.34:1 in dark, below the 3:1 WCAG 1.4.11 asks of a control's boundary. DaisyUI draws input borders from the content colour, so inputs
   pass today; any custom control that borrows `base-300` for its edge must not.
8. **Brand assets.** The numeric scorpion logo and favicons (light and dark) are not in the repository; they arrive through branding settings (`logos.light`, `logos.dark`). A default pair and a
   `<link rel="icon" media="(prefers-color-scheme)">` pair would make a fresh install look right.
