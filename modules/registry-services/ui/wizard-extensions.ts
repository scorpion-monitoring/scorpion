// How another module reaches the wizard in the browser: the widget that draws its field type, and the
// condition under which its step is shown. The server's registries carry data only (a widget is a name,
// `applies` a function that cannot travel); the page keeps what runs here. This module's own widgets are in
// `widgets.ts`. A contributing module's `ui` entry calls these at load; M9 settles how its entry reaches this
// file (`docs/backlog.md`), the fixture of the page tests calls them directly.
import type { WidgetProps } from '@scorpion/ui-kit';
import type { Component } from 'svelte';

type Form = Record<string, unknown>;

const extraWidgets = new Map<string, Component<WidgetProps>>();
const applies = new Map<string, (form: Form) => boolean>();

/** A widget for a field type another module contributes, by the name its field type gives (`widget`). */
export function registerFieldWidget(name: string, component: Component<WidgetProps>): void {
  if (extraWidgets.has(name)) throw new Error(`the widget "${name}" is registered twice`);
  extraWidgets.set(name, component);
}

/** The condition of a contributed step (`applies` of its registry entry), asked with the form as it is. */
export function registerStepApplies(stepId: string, condition: (form: Form) => boolean): void {
  if (applies.has(stepId))
    throw new Error(`the step "${stepId}" has its condition registered twice`);
  applies.set(stepId, condition);
}

export const contributedWidget = (name: string): Component<WidgetProps> | undefined =>
  extraWidgets.get(name);

export const stepConditions = (): Readonly<Record<string, ((form: Form) => boolean) | undefined>> =>
  Object.fromEntries(applies);

/** For tests: forget what a test registered. */
export function resetExtensions(): void {
  extraWidgets.clear();
  applies.clear();
}
