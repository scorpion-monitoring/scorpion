# M13c Plan: share a dashboard as a file, settings without edit mode, a fuller default

Status: **built on 2026-11-24** (`feature/m13c-dashboard-sharing`); the decisions of §3 were confirmed by the maintainer on 2026-11-24. What the build changed against this plan is in §5.

Why a milestone of its own: the maintainer asked on 2026-11-24, after M13b, for three changes to the dashboard of M11. None of
them is in the milestone plan.

1. **Export and import.** A person saves their dashboard to a file and imports it again, on their own account or another
   person's, to get the same dashboard back.
2. **Settings without edit mode.** The gear of the KPI widgets (service, range, category) is reachable while the dashboard is
   just being looked at, so switching between services takes one dialog instead of "Customise, gear, Done".
3. **A fuller default.** The default dashboard shows the KPI trends, the KPI cards and the volatility bars.

Size S: **one sprint, one pull request** (`feature/m13c-dashboard-sharing`). **No table, no new module, no new permission,
no new runtime dependency**, no public v1 change, no ASVS-scoped path. One new internal route. The file format becomes a
contract people keep files of, so it gets [ADR-0055](adr/0055-dashboard-export-file.md) (Accepted).

## 1. What was found in the source (checked 2026-11-24 on `dev`)

| Topic           | Finding                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The document    | `{ version: 1, items: [{ id, widget, x, y, w, h, config }] }`, stored as the user preference `core.ui-shell.dashboard` (ADR-0042). At most 20 tiles, 400 bytes of `config` per tile, 8 KiB in all (`modules/core-ui-shell/grid.ts`). It holds no user id, name or address.                                                                                    |
| Repair          | `parseDashboard` (`service/dashboard/document.ts`) already turns any document into a valid one for **this** caller: unknown widgets, widgets the caller may not see, a repeated singleton and bad ids are dropped and listed; sizes are clamped, overlaps packed, a bad `config` becomes the widget's defaults. An import needs exactly this.                 |
| Save            | `PUT /ui/dashboard` is **strict** (422 naming `items[i].widget`): right for the grid, wrong for a file made by someone with other permissions.                                                                                                                                                                                                                |
| Widget settings | `config.service` is a service **id** of this instance; `absent` means "never set up" (the tile shows the person's own defaults, `kpi.analytics.defaults`); `null` means "Choose a service". The trends chart keeps per-KPI states as short KPI ids (`service/widget-config.ts`).                                                                              |
| The gear        | Drawn by `Tile.svelte` (`packages/ui-kit/src/dashboard-grid`) only inside the edit bar. The dialog belongs to `DashboardGrid.svelte` (`settingsFor`), the form is `WidgetSettings`. A change goes through `setConfigOf` and the autosave, so it would work the same outside edit mode.                                                                        |
| The hints       | "Customise the dashboard, then open the settings of this widget" (`analytics.state.chooseService.how`) and the same detour in `analytics.state.badSettings`.                                                                                                                                                                                                  |
| The default     | `defaultDashboard` places every `dashboard`-slot widget with `grid.default`. **Cards (0,3,4×5) and Trends (4,3,8×5) already have one**; Volatility has none. The default tiles start "never set up", so they show the person's own default service. A person who has saved a dashboard keeps it: only "Reset dashboard" and new accounts see the new default. |

## 2. Scope

### 2.1 Export

- A button **"Export dashboard"** in the FAB menu. The browser writes a file `dashboard-<YYYY-MM-DD>.json` from the items it
  holds (the server's repaired document plus unsaved edits; the autosave is flushed first). No server route: the page already
  has the document, and a download needs no request.
- The file:

  ```json
  {
    "format": "scorpion.dashboard",
    "version": 1,
    "items": [
      {
        "id": "d0k3x9a1",
        "widget": "kpi.analytics.trends",
        "x": 4,
        "y": 3,
        "w": 8,
        "h": 5,
        "config": {
          "service": "…uuid…",
          "range": "1y",
          "category": "all",
          "cumulative": [],
          "hidden": [],
          "secondary": []
        }
      }
    ]
  }
  ```

  `format` and `version` say what it is; `version` follows the document's `CURRENT_VERSION`, so the existing `migrate` steps
  apply to old files. No instance name, user, date or address in the file (§3, decision 4).

- The file's constants, writer and a first check for the browser are in `@scorpion/contracts/dashboard-file` (no Zod, so the page can use it); the server checks the structure with the route's Zod schema (§5).

### 2.2 Import

- A button **"Import dashboard"** in the FAB menu opens a file picker (`.json`, at most 64 KiB read in the browser), then a
  confirmation: "This replaces your dashboard (N tiles). Export the current one first if you want to keep it." with
  **Export current**, **Replace** and **Cancel** (decision 1).
- New route **`POST /ui/dashboard/import`**, permission `core.ui-shell.dashboard.write`, `audit: true`, default rate limit.
  Body: the file as it is (structural Zod schema with the same caps as the stored one).
- New service method `dashboard.import(actor, file)`:
  1. `format` is not `scorpion.dashboard`, or the file does not pass the structure → `Invalid` (422, "Is not a dashboard
     file"). A newer `version` → `Invalid` ("made by a newer Scorpion"). More than 20 tiles → `Invalid`. Unlike a stored
     document, a file is refused, not replaced by the default: the person can do something about it.
  2. Everything else goes through `parseDashboard` for the caller (lenient): widgets this profile lacks or the caller may not
     see are dropped and listed, sizes and configs repaired.
  3. Instance ids are kept (they are unique within the file, and the file replaces the whole dashboard).
  4. Stored through the same path as `save` (`serialiseDashboard` → `setUserPreference`); answers the view with `dropped`,
     so the page shows "N tiles of the file were left out" with the existing notice.
- **Service ids are kept as they are** (decision 2). Imported on the same instance, the dashboard is the same. On another
  instance, or for a person who cannot see a service, the tile shows "The settings of this widget are no longer valid" (the
  existing 422 state), and the gear, now always there (§2.3), fixes it in one step.

### 2.3 Settings without edit mode

- `UiWidgetProps` (`packages/contracts/src/ui.ts`) gains an optional `openSettings?: () => void`, set by the dashboard for a
  tile whose widget has a `configSchema`. The grid exports `openSettings(id)` beside `focusTile`, so the dialog, focus return
  and announcement stay the grid's.
- `WidgetFrame.svelte` (kpi.analytics) draws a gear button **in its heading row**, beside the Export menu, when
  `openSettings` is given and the dashboard is not in edit mode (in edit mode the edit bar has it already; one gear at a time).
  Accessible name "Settings of <widget>", the same message as the edit bar's.
- Applying the dialog in view mode saves through the autosave like any change. "Opening the page never writes" still holds:
  only the person's own Apply writes. A never-set-up tile opened in view mode starts its form from the person's defaults.
- The two hints that send people into edit mode (`analytics.state.chooseService.how`, `analytics.state.badSettings`) now
  point at the gear: "Open the settings of this widget (gear) to choose a service." (EN and DE).
- A widget that ignores `openSettings` simply has no view-mode gear; nothing in the shell names a widget (rule 7).

### 2.4 Default dashboard

- `kpi.analytics.volatility` gets `default: { x: 4, y: 8, w: 4, h: 4 }`, next to the actions card (0,8). Cards and Trends keep
  theirs. The result for a user with `kpi.analytics.read` and the three core cards:

  ```text
  row 0  | account (4)   | notifications (4) | organisations (4) |
  row 3  | KPI cards (4) | KPI trends (8)                        |
  row 8  | actions (4)   | volatility (4)    |
  ```

- Saved dashboards are not changed (decision 3).

### 2.5 Work items

| #   | Item                                                                                         | Where                                                        |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | `dashboardFile`, `readDashboardFile`, `DASHBOARD_FILE_FORMAT`                                | `packages/contracts`                                         |
| 2   | `dashboard.import`, `POST /ui/dashboard/import`, `pnpm openapi:generate`                     | `modules/core-ui-shell/service/dashboard`, `routes.ts`       |
| 3   | Export and Import buttons, file reading, confirmation dialog, notice, EN/DE messages         | `modules/core-ui-shell/ui/Dashboard.svelte`, `dashboard.ts`  |
| 4   | `openSettings` prop, grid export `openSettings(id)`                                          | `packages/contracts/src/ui.ts`, `packages/ui-kit`            |
| 5   | View-mode gear in the frame, new hint text                                                   | `modules/kpi-analytics/ui/WidgetFrame.svelte`, `messages.ts` |
| 6   | Volatility default placement                                                                 | `modules/kpi-analytics/ui/routes.ts`                         |
| 7   | READMEs of `core-ui-shell` and `kpi-analytics`, ADR-0055, `implementation.md` row, changeset | docs                                                         |

### 2.6 Tests

- **Unit** (table-driven): the file schema (good file, wrong `format`, newer `version`, 21 tiles, oversized config); the
  file the export writes parses back to the same items.
- **Integration** (Testcontainers, `core-ui-shell`): import replaces the stored document; a widget the caller may not see is
  dropped and listed; an unknown widget is dropped; wrong format / newer version / too many tiles → 422 and the stored
  document is unchanged; **denied** without `core.ui-shell.dashboard.write`; an import never touches another user's
  preference (it takes no user id). Route: 422 problem+json for a malformed body, never 500.
- **Default:** `defaultDashboard` with the real `ANALYTICS_WIDGETS` contains cards, trends and volatility, without overlaps;
  without `kpi.analytics.read` it contains none of them.
- **Component/E2E** (Playwright, both base paths): export then import on a second account gives the same tiles; the gear is
  visible and works without edit mode, focus returns to it after the dialog, axe-clean in both themes; a new account sees the
  three KPI widgets.

## 3. Decisions (to confirm)

1. **Import replaces the whole dashboard**, after a confirmation that offers to export the current one first. Adding the
   file's tiles to the current dashboard was considered: it needs new instance ids, collides with singletons and the 20-tile
   cap, and is not what "reproduce the dashboard" asks for.
2. **Service ids stay in the file.** Clearing them on import (or a `kpi.analytics` hook that checks them) would need the shell
   to know about widget settings, or a new registry for one case; the existing "check the settings" state plus the always
   visible gear covers a foreign service. Within one instance, which is the main use, the import is exact.
3. **The new default is for new and reset dashboards only.** Rewriting saved dashboards would undo choices people made.
4. **The file carries nothing personal** (no instance, user or time inside; the date is only in the file name). People will
   pass these files around.
5. **Export is done in the browser**; only import has a route. A `GET /ui/dashboard/export` would return what `GET
/ui/dashboard` already does.
6. **No sharing inside the instance** (a link, a gallery of dashboards, an administrator's default for everyone): see §4.

## 4. Not in this milestone (backlog)

- Sharing a dashboard by link or publishing templates inside the instance, without a file.
- An administrator-defined default dashboard (today the default comes from the widgets' `grid.default`).
- Mapping service ids between instances on import (by slug).

## 5. As built

- **The file module has no Zod schema.** `@scorpion/contracts/dashboard-file` holds the format, the writer (`dashboardFile`), the file name and `readDashboardFile`,
  the page's first look at a chosen file (too large, not JSON, not a dashboard, newer version). The structure is checked by the Zod schema of
  `POST /ui/dashboard/import`; the format, version and tile count by `dashboard.importFile`.
- **The service method is `importFile`** (not `import`, a keyword).
- **`UiWidgetProps` also gained `label`**, the tile's name on the dashboard (`Trends (2)`), so the gear in a widget's heading has the same accessible name as the
  edit bar's gear when a dashboard has two tiles of one widget.
- **`saveBlob` moved from `kpi-analytics` to the UI kit**, so the dashboard's export can use it without importing another module; the Tabler icon `download` was added.
- The hints' new text is "Open the settings of this widget (the gear) to choose one." and "… Open its settings (the gear) to choose again."
