# ADR-0042: the dashboard document, the widget grid in the shell on Snapgrid, the extended `ui.widget`, and the dependencies

- Status: Accepted
- Date: 2026-10-20

## Context

M11 puts a **widget-based grid dashboard** on the start page of signed-in people and builds `kpi.analytics` on it
([m11-sprint-plan.md](../m11-sprint-plan.md)). The maintainer decided four things (plan §14, decisions 1 to 4) and named the library and the
menu (decision 5). This ADR records them as they stand after sprint 1, with the results of the prototype the plan asked for before sprint 2 could
start, and the places where the source differed from the plan. It is amended (as the plan is, under "Amended in sprint N") when a later sprint
changes one of them.

Two sentences of [architecture.md](../architecture.md) are touched: the `core.ui-shell` row already says "dashboard grid", and the `kpi.analytics`
row lists a table `dashboard_preference`. **The table is replaced by a preference key** (Decision 1): the architecture's table would be one row
per person holding one JSON value, which is what `settings_user_preference` already is, with its size cap and its own-data-only rule.

## Decision

### 1. The document, and its place in the preference store

A person's dashboard is **one versioned JSON document** in their user preference `core.ui-shell.dashboard` (`core.settings`: at most 8 KiB as JSON, own
data only, no user id anywhere). No table, no migration, no new event.

```ts
{ version: 1, items: [ { id, widget, x, y, w, h, config } ] }   // at most 20 items
```

- `id` is the instance id, 4 to 12 lower-case letters and digits, unique in the document, chosen by the browser; `widget` is the id of a `ui.widget`
  entry; `x`, `y`, `w`, `h` are grid units on **12 columns** (`0 <= x`, `x + w <= 12`); `config` is at most **400 bytes** as JSON and is validated and
  defaulted by the widget's own `configSchema`.
- **The stored value is never trusted, and the served value is not the stored one.** The preference is registered with a **structural** schema
  (`storedDashboardSchema`): shape, finite numbers, at most 100 items, bounded strings. It is deliberately looser than a valid dashboard, so the
  generic `PUT /preferences/core.ui-shell.dashboard` can store a document that `parseDashboard` then has to repair. `GET /ui/dashboard` is the only
  reader the page uses; it **always returns the repaired result**, never the raw row.
- `parseDashboard(raw, { entries, may })` **never throws and never trusts**. It returns `{ items, dropped, reset }`:
  - a document the structure refuses, one with more than 20 items, and one of a version this build does not know become the **default dashboard**
    (`reset: true`, `resetReason`: `invalid`, `too-many-items` or `newer-version`); an unknown newer `version` is refused, **not guessed**
    (`migrate(version, document)` is a table of steps from each old version to the next; version 1 has none yet);
  - a tile whose widget is unknown (its module left the profile) or is not a tile (a `header` widget), whose widget the caller may not see, whose id
    is bad or repeated, or that repeats a `singleton` is **dropped**, with a reason (`unknown-widget`, `not-permitted`, `invalid-item`,
    `duplicate-id`, `singleton-repeated`) in `dropped`;
  - sizes are clamped to the entry's `minW`, `maxW`, `minH`, `maxH` (the grid's own limits when it has none); a tile is moved inside the 12 columns;
    a `config` that is not an object, is over 400 bytes or fails its schema is **replaced by the widget's defaults and the widget stays**;
  - overlaps are **moved down** by a vertical packer: a tile stays unless an earlier one (by row, then column, then position) is in its way; a layout
    with no overlap comes back unchanged and gaps are kept (the grid compacts what a person drags; the document does not rewrite a layout they chose);
  - if the repaired document would still be over 8 KiB, the **last tiles go** (`document-too-large`).
- **A read changes nothing that is stored.** What a sanitised read dropped stays in the stored document until the next save, so a module that returns
  finds its tile, and a person who regains a permission gets the tile back without anyone saving anything. A test covers both.
- `serialiseDashboard(items)` writes the known keys at the current version and throws a `RangeError` for more than 20 items or a document over 8 KiB, so
  the save answers 422 and never stores something the store would refuse. `parse(serialise(x))` equals `x` for every valid dashboard and parsing a
  parsed document changes nothing; both are fast-check properties.
- **The default dashboard** is built from the entries of the `dashboard` slot that carry `grid.default` and that the caller may see (row and column,
  with `order` and then the id deciding who keeps a place two defaults want), each with its default configuration and a **deterministic** instance id (a
  hash of the widget id, because the default is stored nowhere and the ids must not change between reads). A person with nothing stored gets it
  (`isDefault: true`).
- **The service** (`dashboard.get(actor)`, `dashboard.save(actor, items)`) takes no user id, checks `core.ui-shell.dashboard.read` or `.write` again
  after the route, and reaches the store only through the public service of `core.settings`. `save` refuses with a 422 that names the field and never
  repeats a value: `items[i].widget` (an unknown widget and one the caller may not see are answered alike), `items[i].config`, `items[i].id`, `.w`, `.h`,
  `.x`, `.y`, and `items` for more than 20 tiles or a document that does not fit. It stores what each widget's schema made of the configuration
  (defaults in, unknown keys out) and moves overlaps down. The routes are `GET /ui/dashboard` (`Cache-Control: no-store`) and `PUT /ui/dashboard` (audited,
  no body kept), with the new plain permissions `core.ui-shell.dashboard.read` and `.write`, both held by the role `user`.

**What the source forced (the plan said "stores through the preference service as the actor").** `core.settings` offered `getUserPreference(userId, key)`
as its only public preference method, a trusted read. Writing the table from another module is forbidden (CLAUDE.md rule 3) and the generic route is
HTTP, so the maintainer chose to add one method to the public service: **`setUserPreference(actor, key, value)`**, which delegates to the existing
`preferences.set` (same permission, same schema, same 8 KiB, same event, no user id). Consequence: **saving a dashboard also needs
`core.settings.preference.write`**, which the role `user` holds; a profile that takes it away takes the dashboard's save with it. Reading does not need
`core.settings.preference.read` (it uses the trusted read, as the layout of a mail does). Both are written in `authorization.md` and the READMEs.

### 2. The grid lives in `core.ui-shell`, on Snapgrid behind one adapter

The shell draws the grid and owns the document and the FAB menu (plan decision 2); every module's widgets are placeable from it. The grid library is
[Snapgrid](https://snapgrid.dev/svelte/docs/getting-started) (`@snapgridjs/svelte`), used **only through the headless API** (`createGridContainer`,
`createGridItem` with `attachHandle`, `createGridResizeHandle`, `DragDropProvider`) inside **one component** of `core.ui-shell` (sprint 2's
`DashboardGrid`), loaded with a **dynamic import** on the start page only. Nothing else imports Snapgrid, so the library can be replaced without touching
the document, the routes, the registry or the widgets.

**The prototype** (throwaway, not committed; SvelteKit 3.1.0, Svelte 5.57.2, Vite 8.3.4, adapter-node 6.0.0, Tailwind 4.3.3, daisyUI 5.7.50, ECharts 6.1.0,
Playwright 1.64.1 and axe-core/playwright 4.14.0, the versions of `apps/web`; production build served by adapter-node under `BASE_PATH=/a/b/c`; a catch-all
route, a grid of three tiles one of which holds an ECharts line chart, a daisyUI FAB):

| Check                              | Result                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Packages                           | `@snapgridjs/svelte`, `@snapgridjs/core`, `@snapgridjs/dnd` 0.12.0, `@dnd-kit/svelte`, `@dnd-kit/dom` 0.5.1: **19 packages new to the lockfile** (21 more of the 40 in the closure are already there: Svelte and its dependencies, `clsx`, `tslib`, `js-tokens`), all MIT, none with an install script. The list is in Decision 4                                                                                                |
| Size                               | The grid chunk (Snapgrid, dnd-kit and their glue) is **133.7 kB raw, 43.9 kB gzip**, loaded only through the dynamic import: the catch-all page's own request list has no grid chunk (asserted in the browser); a static import would put **+146 kB raw / +48 kB gzip** on the first load of the route. The shared Svelte runtime chunk grows by about 10 kB raw / 3.8 kB gzip (prototype; to be re-measured in the app)         |
| React                              | `@snapgridjs/core` depends on `react-grid-layout`, which declares `react` and `react-dom` as peers and pulls `react-draggable`, `react-resizable`, `prop-types` and others. Snapgrid imports **only `react-grid-layout/core`** (the pure layout functions): a search of every client chunk finds no React. See Decision 4 for the install warning this causes                                                                    |
| SSR and hydration                  | A static import renders the grid on the server and hydrates under `/a/b/c` with **no console error or warning** and no `window` access at import. A dynamic import renders nothing on the server, which is what the plan wants                                                                                                                                                                                                   |
| Pointer drag and resize            | Both work. A drag from a tile **handle** (`attachHandle`) moves the tile and a drag from the body does not; a resize handle changes the size (4×4 to 3×5 in the run). A drag is off in view mode                                                                                                                                                                                                                                 |
| Keyboard                           | Drag **works**: Space picks up, arrows move one cell, Space drops (dnd-kit announces "Draggable item b was dropped." in an English live region). A **keyboard resize does not exist**: the resize handle is focusable, but arrows and Space changed nothing in the run, and the package documents arrow steps for a keyboard move only. The buttons of the plan are therefore the only keyboard and single-pointer way to resize |
| Chart in a resizable tile          | An ECharts chart with a `ResizeObserver` (the pattern of `Chart.svelte`; the prototype's chart is its own, not the adapter) fired 2 times during a pointer resize and 11 times over a series of resizes and button moves, no loop error, no console message                                                                                                                                                                      |
| axe (wcag2a, 2aa, 21a, 21aa, 22aa) | The turnkey `<GridLayout>` fails in edit mode (3 rules, below, besides the prototype's missing page title); the **headless build with the wrapping below is clean in both themes, in view mode and in edit mode, with the FAB**                                                                                                                                                                                                  |
| `prefers-reduced-motion`           | Snapgrid does **not** honour it: tiles transition their size with a CSS transition (150 ms) and move with a Web Animations FLIP that CSS cannot turn off. Wrapped (below), animations are 0 under reduced motion and 1 otherwise                                                                                                                                                                                                 |
| Narrow screens                     | At 390 px Snapgrid still draws 12 columns (tiles about 104 px wide): it does not stack. Stacking is ours (plan decision 8): below `md` the page draws a plain list in reading order and no grid                                                                                                                                                                                                                                  |

**What had to be wrapped, and how.** The turnkey component failed axe in edit mode with `aria-command-name` (resize handles are focusable `role=button`
spans with no name), `nested-interactive` (the whole tile is a `role=button` that contains the remove button) and `target-size` (handles are 14×14 px). It
also left a stale `aria-disabled="true"` on every tile after the mode changed (found because Playwright treated the buttons inside as disabled; axe does not
flag it). The headless build clears all four:

1. a **move grip** is a real `<button aria-label="Move tile …">` that carries `attachHandle`, so dnd-kit puts `role`, `tabindex` and the keyboard sensor on
   the grip and not on the tile;
2. the **resize handle** is ours: 24×24 px, `aria-hidden`, `tabindex="-1"` and `role="presentation"` set before attachment (dnd-kit sets them only when
   absent), because it has no keyboard path and must not be a tab stop that does nothing;
3. the grid is **remounted when the mode changes** (`{#key editing}`), which removes the stale `aria-disabled`; the tiles' data comes from the shared read
   store of the plan, so a remount costs no request;
4. under `prefers-reduced-motion` a CSS rule `transition: none !important` on the tile and a per-node `animate = undefined` (Snapgrid falls back to an
   instant move when `animate` is missing) switch both animations off;
5. **buttons that move and resize** (WCAG 2.2, 2.5.7) change the controlled layout array; Snapgrid re-renders, focus stays on the button, and the chart
   resizes. They are built whatever Snapgrid offers (plan decision 9).

**Verdict: Snapgrid passes the gate, with these wrappers.** No check failed: SSR, bundle and accessibility are all fine once wrapped, and nothing needed
a change in `pipeline/**` or `route.ts`. Its risk is its age (0.12.0 was published on the day of this ADR, 0.10.0 on 2026-08-01, 35 stars at the time of
reading, pre-1.0 dnd-kit peers) and its React-shaped dependency; both are contained by the exact pins, the single adapter component and the fallback.

**The fallback** if a later release breaks one of the five wrappers or the project goes away: our own CSS grid (12 columns, `grid-column` and `grid-row`
from `x`, `y`, `w`, `h`) over the **same document**, with the move and resize **buttons only** (no pointer drag). The document, `parseDashboard`, the
routes, the registry, the FAB menu and the widgets do not depend on Snapgrid, so only `DashboardGrid` changes; the cost is pointer dragging, which the
buttons already replace for accessibility.

### 3. The extended `ui.widget`

The entry gains, **additively**, `grid?: { w, h, minW?, minH?, maxW?, maxH?, default?: { x, y, w, h }, singleton? }`, `label?` and `description?` (keys
of the module's catalogue), `icon?` (a name of the closed icon table) and `configSchema?` (a Zod schema, as other registries carry theirs). The entry
id is now at most 100 characters (the document stores it). Every entry that exists stays valid; `GET /ui/navigation` lists the new fields (not
`configSchema`: a Zod schema is not JSON) for the widgets the caller may see, only on entries that have them, so an old entry's answer is what it was.

- **Validated at start** (the loader's usual stop, naming the field): `minW > maxW` and `minH > maxH`, a `w` or `h` outside its own limits, a `default`
  outside the 12 columns or outside the entry's limits, an icon that is not in the table (a name such as `constructor` too), a `configSchema` that is not a
  Zod schema. Sizes are whole numbers, `w` at most 12 and `h` at most 50.
- **"A `singleton` with two defaults"** (plan §5) cannot be written: `default` is one placement, and a list is refused by the same strict schema (a test
  says so). A singleton is placed once: a second tile of it is dropped on read and a 422 on save.
- **What is a tile.** The plan says an entry without `grid` is placeable at 4×3; since `header` widgets (the inbox bell) are not cards, **only entries
  of the `dashboard` slot are tiles**. The three cards that exist (the membership summary of `registry.organisations`, the pending approvals of
  `core.identity`, the delivery status of `core.notifications`) have no `grid` yet, so they are placeable at 4×3 but **not in the default dashboard**
  until sprint 2 gives each a `grid.default`. No existing widget changed.
- The browser half (`widgets` in each module's `ui` entry) is untouched. The props it will receive in sprint 2 are in the README.

### 4. The dependencies and their reasons

**Sprint 1 adds no runtime dependency and changes no dependency of any module except one development dependency:** `fast-check` 4.10.2 (the version
`kpi.framework` and `kpi.ingestion` already use; no package is new to the lockfile) becomes a development dependency of `core.ui-shell`, because the
properties of Decision 1 need it. The brief said no dependency in this sprint; this one is development-only and already in the lockfile, and it is called
out in the pull request.

**Sprint 2 adds, with their exact versions and why** (to `apps/web` or `core.ui-shell`, wherever the browser half is built):

| Package                                                                                                                                    | Version                                                                | Why                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `@snapgridjs/svelte`                                                                                                                       | 0.12.0                                                                 | The Svelte binding of the grid: the headless factories and the provider (Decision 2)               |
| `@dnd-kit/svelte`, `@dnd-kit/dom`                                                                                                          | 0.5.1                                                                  | Peers of `@snapgridjs/svelte` (the drag-and-drop engine); named because pnpm does not install them |
| `@snapgridjs/core`, `@snapgridjs/dnd`                                                                                                      | 0.12.0 (transitive)                                                    | The layout engine and the drag session                                                             |
| `@dnd-kit/abstract`, `collision`, `geometry`, `state`                                                                                      | 0.5.1 (transitive)                                                     | dnd-kit's own packages                                                                             |
| `@preact/signals-core`                                                                                                                     | 1.14.4 (transitive)                                                    | dnd-kit's reactive core                                                                            |
| `react-grid-layout`                                                                                                                        | 2.2.4 (transitive)                                                     | The layout functions Snapgrid imports (`react-grid-layout/core`)                                   |
| `react-draggable`, `react-resizable`, `prop-types`, `fast-equals`, `resize-observer-polyfill`, `loose-envify`, `object-assign`, `react-is` | 4.7.2, 3.2.0, 15.8.1, 4.0.3, 1.5.1, 1.4.0, 4.1.1, 16.13.1 (transitive) | Dependencies of `react-grid-layout`; installed, **not in the client build**                        |

That is 19 packages new to the lockfile (the rows above), all MIT, none with an install script. **The one thing to decide before sprint 2:** the root
`pnpm-workspace.yaml` sets `autoInstallPeers: false`, and `react-grid-layout`, `react-draggable` and `react-resizable` declare `react` and `react-dom` as
(non-optional) peers. `pnpm install` therefore prints "Issues with peer dependencies found" with unmet `react` and `react-dom`, and the install does not
fail. Options: **(a)** accept the warning; **(b)** add `peerDependencyRules.ignoreMissing: ['react', 'react-dom']` to `pnpm-workspace.yaml`, which silences it
and states in the repository that React is not used; **(c)** add `react` and `react-dom` as dependencies, which would put two React packages (and
`scheduler`) in the lockfile for nothing and is not recommended. **Recommendation: (b).**

## Consequences

- A person's dashboard costs one row and no migration; `core.settings` gains one public method; the architecture's `dashboard_preference` table is not built.
- **The 8 KiB cap holds 20 tiles of the sizes the plan names, but not 20 tiles each at the 400-byte configuration maximum.** Measured with the real
  functions (`serialiseDashboard`; a tile without its configuration is about 85 bytes): 20 trends tiles with the plan's example configuration (a service
  id, `range`, `category`, `cumulative`, `hidden`, `secondary`; 128 bytes) are **4,257 bytes**; 20 KPI-card tiles (service and range; 63 bytes) are 2,913;
  20 tiles of the old cards (no configuration) are 2,155; 20 tiles with a 325-byte configuration are 8,197 (5 bytes over); 17 tiles at a 391-byte
  configuration fit (8,092) and 20 of them are 9,517. The plan's "about 6 KiB" is therefore met with margin by the ordinary document, and a document that
  does not fit is a **422 on `items` at save** (never a silent loss), or, for one that was planted, the last tiles dropped with `document-too-large`. If
  the maintainer wants "20 tiles, any configuration" to be true, `MAX_CONFIG_BYTES` has to go from 400 to about 300 (a constant in `grid.ts`, no migration);
  that is a decision for sprint 2, before any widget writes a configuration of its own.
- The first dashboard sprint is pure server work: no grid on screen, no change to the start page, no public v1 change (`pnpm openapi:diff` is clean).
- Sprint 2's `DashboardGrid` carries the five wrappers of Decision 2 and their tests (axe in both themes, in view and edit mode; the reduced-motion
  check), so a Snapgrid update that breaks one is a failing test and not a regression nobody sees.
- Known gaps, in the backlog: a document stored but unreadable by the structural schema (after a change of the schema) looks like "nothing stored";
  the configuration form of a widget needs more than a Zod schema on the server (a JSON Schema for `SchemaForm`, sprint 4); dnd-kit's announcements are
  English only.

## Amended in sprint 2 (2026-10-21)

Sprint 2 put the grid on the start page (`DashboardGrid` in `packages/ui-kit/src/dashboard-grid/`, the page in `core.ui-shell`). This block records what was checked, what was
decided and what the real app showed that the prototype had not. Where the source and the plan disagreed, the source won.

**Checked against the source before starting.** `GET /ui/dashboard` and `PUT /ui/dashboard`, `setUserPreference(actor, key, value)` in the public service of `core.settings`, `grid`,
`label` and `icon` on the entries, and `GET /ui/navigation` listing them for the widgets the caller may see are all as sprint 1 recorded. The plan names `core.audit` as a possible owner of one
of the three cards; it is not one. The cards are owned by `registry.organisations` (the membership summary), `core.identity` (the pending approvals) and `core.notifications` (the delivery
status), each in its `ui/routes.ts`.

**Decisions taken before the sprint (recorded, not reopened).**

- **The dependencies of Decision 4 are installed exactly as listed**, pinned, in `packages/ui-kit` (where `DashboardGrid` lives): `@snapgridjs/svelte` 0.12.0, `@dnd-kit/svelte` 0.5.1 and
  `@dnd-kit/dom` 0.5.1. The lockfile gained **19 packages**, the ones of the table (names and versions as listed, all MIT, none with an install script; the one `hasBin` is `loose-envify`).
- **The peer question is answered (b):** `peerDependencyRules.ignoreMissing: ['react', 'react-dom']` in `pnpm-workspace.yaml`. `pnpm install` no longer prints the warning. **No React is in the
  client build**: a search of every client chunk finds no React (the strings that match are Svelte's "reactions" and the signals library's name). `react` and `react-dom` are not dependencies.
- **`MAX_CONFIG_BYTES` stays 400.** Nothing in this sprint writes a configuration of its own (no widget has a `configSchema` yet), and nothing in building the sprint broke on it. A save
  that does not fit is a 422 on `items`, which the page shows ("Your dashboard is too large to save. Remove a widget or simplify its settings, then try again.").
- **A save needs `core.settings.preference.write` as well as `core.ui-shell.dashboard.write`.** The page shows a 403 as an alert that says the dashboard cannot be saved with this account
  (no permission id, no role), keeps the layout, offers "Try again" and does **not retry by itself**; e2e removes the permission from the role `user` and counts the requests.

**What the real app showed (each was found by a test, and is now one).**

1. **The Content-Security-Policy.** dnd-kit writes a `<style>` element into the page while something is dragged, and the page's policy has no `'unsafe-inline'` for styles (only the nonce SvelteKit
   puts on its own tags). The harness page, which has the application's policy, reported three `style-src-elem` violations. dnd-kit's style injector takes a `nonce`; `Provider.svelte` gives it the
   nonce of a script or style tag of the page (`element.nonce` stays readable). The harness page now carries one inert nonce-bearing data block, as the application's pages carry their tags.
2. **The `@scorpion/contracts` barrel pulls in zod, which probes `new Function` at load** and so breaks the policy (`script-src: eval`) on a page that has not set zod to `jitless`. The shared layout
   rules (`pack`, `compactUp`) are therefore a subpath, `@scorpion/contracts/dashboard-layout`, which imports nothing; the server's `parseDashboard` and the browser use the same file (the plan's
   "the browser must not reimplement `pack` differently" is met by there being one `pack`).
3. **dnd-kit's accessibility plugin reads its options once.** The announcements of Decision 2's open question are therefore set by building the manager with the plugin already configured
   (`Provider.svelte`); setting them later is silently ignored. The keyboard drag now says "Picked up …" and "Moving … was cancelled" and gives its instructions in the page's language (en and de, tested);
   a drop is announced by the grid itself with the new row and column, so dnd-kit stays silent for it. The English-only entry of the sprint 1 backlog is closed.
4. **SvelteKit adds the CSS of every dynamic import to every page**, so a `<style>` block in a lazily loaded component would be fetched by pages that never draw the grid. The grid has no
   `<style>` block (utility classes only), which is what lets the e2e check say that no other page requests anything of it.
5. **A sixth, small wrapper in view mode.** The five of Decision 2 were written for edit mode. In view mode the draggable still needs an activator, and without one dnd-kit gives the tile itself a role
   and a tab stop, which axe reports as `nested-interactive` (the tile holds links and, for a chart, a button). A hidden element takes the activator (`<span hidden {@attach item.attachHandle}>`), so the
   tile stays a plain tile. It is three lines in `Tile.svelte`; **it is not on the list of this sprint's brief and the maintainer is asked to confirm it** (the report says so).
6. **A tile that draws nothing is removed from view, not left as a hole.** The grid watches each tile's body (no element child = nothing to draw). In view mode such a tile has no height, the tiles
   below it rise (the grid's own vertical compaction), and the tiles to its right in the same row **slide left** into the width it leaves, if the places are free. The default placements put the
   membership card first (`x: 0`) for that reason: it is empty for almost everybody, and the pending-approvals and delivery-status cards then sit at the left. When **no** tile draws anything and no edit is in progress, the page also takes its heading and the grid out of view (the grid stays in place, hidden, so it notices when a widget has something to say), as the old start page did with its `:has` rule; edit mode always shows it. A plain person therefore sees the hero and the button, as before.
7. **A remount costs no request, and costs no widget.** The plan's rule ("tile data comes from the shared read store, so a remount costs no request") would have meant refetching for the three cards,
   which read their own data. Instead each tile's body is drawn **once**, in a parking element that is not part of the remounted tree, and the tile that is current adopts its element
   (`body-host.ts`, tested with plain objects; a component spec counts mounts across a change of mode and of viewport and finds one). Turning edit mode on sends nothing (`[dashboard-calls]`). The shared
   read store of sprint 4 is still needed for widgets that share a read, but not for this.
8. **A button move passes a tile that is in the way** (up and down swap the two, as a drag does; left and right jump to the next free place in the row and refuse when there is none) rather than
   pushing it aside, because pushing a neighbour sideways has no place to go in a full row. The rules are table-driven in `layout.ts`, with a property that no sequence of moves leaves an overlap or a
   tile outside the grid.

**What the page does, in short** (the README of `core.ui-shell` has the detail): the page's `load` reads `GET /ui/dashboard` on the server; the grid is a dynamic import; the FAB button turns edit mode on and
opens a menu of the widgets the caller may add (Escape closes it and returns focus to the button); a change is saved by one `PUT` a second after the last one, when the page is hidden and when it goes away; "Reset
to default" shows the default (the server's `defaultDashboard`, run in the browser over the entries of `GET /ui/navigation`) and stores nothing until the next change; two tabs: **the last save wins**, with no
revision protocol, as the plan says. A widget whose component this build does not have draws nothing and the page says so.

**Measured** (build of `0.12.0`'s `dev` against this branch; the image against the same commit's image, `docker image inspect`; numbers repeated in `docs/backlog.md`):

| What                                                                                  | Before          | After                        | Change                                                                                      |
| ------------------------------------------------------------------------------------- | --------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| Client build, JavaScript and CSS (`.svelte-kit/output/client/_app`, 75 → 78 files)    | 5,911,288 B raw | 6,085,618 B raw              | +174,330 B (+2.9 %)                                                                         |
| the same, gzip of each file                                                           | 1,715,206 B     | 1,772,337 B                  | +57,131 B (+3.3 %)                                                                          |
| The grid chunk (Snapgrid, dnd-kit, `DashboardGrid` and its parts), loaded on `/` only | not there       | 145,656 B raw, 47,936 B gzip | the prototype's figures were 133.7 kB and 43.9 kB                                           |
| The rest of the client build                                                          |                 |                              | +28,674 B raw, +9,195 B gzip (the page, its words in two languages, the icons, shared code) |
| Image `full` (`docker image inspect`, uncompressed)                                   | 634,197,977 B   | 652,752,394 B                | +18,554,417 B (+2.9 %)                                                                      |

The image grows more than the build because the run-time install carries every package of the server's closure, **including the client-only packages of `ui-kit`** (it already carried `echarts`): Snapgrid,
dnd-kit, the layout functions of react-grid-layout and **`svelte` itself with its compiler's dependencies (about 9.5 MB of the 14.3 MB the package store grew by)**, which the two packages list as a peer. None of
it is needed at run time (the web app is bundled by the node adapter); excluding the client-only packages from step 5 of the `Dockerfile` is a backlog entry, not part of this sprint.

**Not done, and why.** No new route and no change to `apps/server/src/pipeline/**` or `packages/contracts/src/route.ts` was needed. A per-widget settings screen is not built: the grid has the shell of it (a gear
that opens a dialog and a `settings` snippet, tested in the harness), and no widget uses it before sprint 4. "Reset to default" does not store the default (the plan's wording); whether it should is a question for
the maintainer, because a person who resets and leaves the page without another change finds their old layout again.
