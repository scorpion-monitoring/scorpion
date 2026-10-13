// The one table that maps a field type's `widget` name (from `GET /services/schema`) to what draws it. The page
// has no `if (type === ...)` anywhere: a name that is in neither this table nor the widgets a contributing module
// registered (`wizard-extensions.ts`) is **not** skipped, the page says so and the step cannot be left; and a
// test fails for every field type this module seeds whose widget is missing here.
import type { WidgetProps } from '@scorpion/ui-kit';
import type { Component } from 'svelte';
import ImageWidget from './ImageWidget.svelte';
import LicenseWidget from './LicenseWidget.svelte';
import MultiSelectWidget from './MultiSelectWidget.svelte';
import OrganisationWidget from './OrganisationWidget.svelte';
import SelectWidget from './SelectWidget.svelte';
import { contributedWidget } from './wizard-extensions.ts';

/** `native`: the form's own control for the field's JSON Schema (a text, a list of texts). */
export type WidgetEntry = 'native' | Component<WidgetProps>;

export const BUILT_IN_WIDGETS: Readonly<Record<string, WidgetEntry>> = {
  text: 'native',
  select: SelectWidget,
  'multi-select': MultiSelectWidget,
  license: LicenseWidget,
  organisation: OrganisationWidget,
  image: ImageWidget,
};

export const widgetEntry = (name: string): WidgetEntry | undefined =>
  BUILT_IN_WIDGETS[name] ?? contributedWidget(name);

/** The components by name, for `SchemaField`'s `widgets` (the native ones draw themselves). */
export function componentWidgets(names: Iterable<string>): Record<string, Component<WidgetProps>> {
  const out: Record<string, Component<WidgetProps>> = {};
  for (const name of names) {
    const entry = widgetEntry(name);
    if (entry !== undefined && entry !== 'native') out[name] = entry;
  }
  return out;
}
