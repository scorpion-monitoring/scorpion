# ADR-0057: Settings checks that need another module's data

- Status: Accepted (M16 sprint 3)
- Date: 2026-11-26
- Plan: [M16 sprint plan](../m16-sprint-plan.md) §8 item 3
- Amends: [ADR-0017](0017-settings-port.md)
- Relates to: [ADR-0056](0056-bibliometrics-publications-citations-and-the-trusted-kpi-write.md) decision 7

## Context

`bibliometrics` names the indicator its weekly refresh fills by id in its setting `kpi.indicatorId` (ADR-0056 decision 7,
plan decision 4). The plan asks that a save naming an indicator that is not numeric, or not in the thematic category
`Bibliographic`, is a **422 from the server**, not only a choice the page leaves out.

A module's settings are validated by its own Zod schema in `core.settings` (ADR-0017). A schema cannot see the indicators
of `kpi.framework`, and the only other rule `core.settings` runs on a save (the contrast of the theme colours, M12a) is
its own, synchronous and internal. The save goes through `PUT /settings/{module}`, whatever page draws the form, so a
check only on a module page of `bibliometrics` would leave that route open.

## Decision

1. **`core.settings` declares the registry `settings.check`.** An entry is `{ module, check(values, before) }`; `check` is
   async and answers problems with paths inside the values. `core.settings` asks every entry of the module on **every**
   save of it (the admin route, `seedSettings`, `seedSettingKey`), inside the transaction of the save, after the schema
   and with the stored value it is about to replace. Any problem refuses the save with one 422 on `values.<path>`, so the
   admin form shows it at the field, and nothing is written.
2. **A check that throws is a 422 on `values`**, logged, with a fixed message: never a 500 and never the error's text. A
   malformed entry stops the start.
3. **A check asks only about what changed.** It gets `before` for that reason: when the other module's data changes later
   (an indicator moves to another category), an administrator can still save the module's other settings. The job that
   uses the value checks it again when it runs.
4. **The admin form gets the picker from the module.** `SchemaField` of `ui-kit` falls back to the field widgets a module
   contributes through its `wizardExtensions.widgets` (ADR-0040 addendum) when the page passes none of that name. The
   generic page at `/admin/settings/:module` therefore draws the indicator picker of `bibliometrics` without a page of its
   own, and a profile without `bibliometrics` draws nothing new.

## Consequences

- A module that keeps another module's id in a setting has one place for the rule, and the generic settings page stays
  the only settings page.
- The check runs inside the transaction of the save and may read another module through its public service (its own
  connection). Saves are rare and administrator-only, so the extra connection is acceptable.
- `bibliometrics` is the first contributor; its check asks `kpi.framework` (`indicatorsByIdAsSystem`, `findValueType`).
