# ADR-0055: The dashboard export file

- Status: Accepted (M13c)
- Date: 2026-11-24
- Plan: [M13c plan](../m13c-plan.md)
- Amends: [ADR-0042](0042-dashboard-document-and-grid.md)

## Context

People want to pass a dashboard on: to a colleague, or to themselves on another account, so that the same dashboard comes
back. The dashboard is a per-user document (`core.ui-shell.dashboard`, ADR-0042) that holds tiles with widget ids,
places, sizes and widget settings (for the KPI widgets a service id, a range, a category and per-KPI chart options). Once
people keep such files, their shape is a contract: an older build must refuse a newer file, and a newer build must read an
older one.

The person importing may hold other permissions than the person exporting, and their instance may run another profile.
`PUT /ui/dashboard` is strict (a tile the caller cannot place is a 422), which is right for the grid and wrong for a file.

## Decision

1. **The file is the stored document with a format marker**: `{ format: "scorpion.dashboard", version, items }`.
   `version` is the version of the dashboard document (`CURRENT_VERSION`), so the document's `migrate` steps also read old
   files. The file holds nothing personal: no instance, user or time (the date is only in the file name).
2. **The browser writes the export** from the tiles it holds; there is no export route (it would answer what
   `GET /ui/dashboard` already does).
3. **The import is its own route**, `POST /ui/dashboard/import` with the permission `core.ui-shell.dashboard.write`,
   audited. The file as a whole is refused with a 422 when it is no dashboard file, was made by a newer build, or has more
   than 20 tiles. Its tiles are then **repaired for the importer exactly as a stored document is repaired on a read**
   (`parseDashboard`): what the importer cannot place is left out and listed in `dropped`, never refused.
4. **An import replaces the whole dashboard**, after a confirmation in the page that offers to export the current one first.
5. **Widget settings are carried as they are.** The shell does not look inside a tile's settings (rule 7). A service id
   from another instance, or one the importer cannot see, ends in the widget's "settings are no longer valid" state, which
   the widget's own gear (now drawn outside edit mode too, through `UiWidgetProps.openSettings`) fixes.

## Consequences

- A change of the dashboard document's version is a change of the file format. A migration step is now needed for both,
  and a build refuses a file of a newer version with a clear message.
- A file from another instance imports its layout but not its services; mapping service ids by slug is in the backlog.
- Imports are audited like saves, without the body.
