// How a module that contributes to the services wizard and the service page reaches them in the browser. The
// server's registries carry data only (a widget is a name, `applies` a function that cannot travel, a section a
// component); the page keeps what runs here. A module's `ui` entry exports `wizardExtensions`, the web app's
// shell forwards it to these functions at start (`apps/web/src/lib/wizard-extensions.ts`), and `registry.services`'
// pages read it back. The registry lives here, not in `registry.services`, so the shell does not depend on a
// module that a profile may leave out (ADR-0040 addendum).
import { getContext, setContext, type Component } from 'svelte';
import type { WidgetProps } from './kit-types.ts';

type Form = Record<string, unknown>;

/** What a module's `ui` entry offers the wizard and the service page. */
export interface WizardExtensions {
  /** Widgets for field types the module contributes, by the `widget` name of the field type. */
  widgets?: Record<string, Component<WidgetProps>>;
  /** The conditions of the module's steps, by step id (`applies` of the registry entry, browser only). */
  applies?: Record<string, (form: Form) => boolean>;
  /** Sections of the service page, in the order given. */
  sections?: Record<string, Component<ServiceSectionProps>>;
}

/** What a section of the service page is given: which service, nothing of what the page loaded. */
export interface ServiceSectionProps {
  service: { id: string; slug: string; name: string };
}

const extraWidgets = new Map<string, Component<WidgetProps>>();
const applies = new Map<string, (form: Form) => boolean>();
const sections = new Map<string, Component<ServiceSectionProps>>();

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

/** A section of the service page. */
export function registerServiceSection(
  name: string,
  component: Component<ServiceSectionProps>,
): void {
  if (sections.has(name)) throw new Error(`the service section "${name}" is registered twice`);
  sections.set(name, component);
}

/** Forwards what a module's `ui` entry exports; the shell calls it once per module at start. */
export function registerWizardExtensions(extensions: WizardExtensions | undefined): void {
  if (!extensions) return;
  for (const [name, component] of Object.entries(extensions.widgets ?? {}))
    registerFieldWidget(name, component);
  for (const [stepId, condition] of Object.entries(extensions.applies ?? {}))
    registerStepApplies(stepId, condition);
  for (const [name, component] of Object.entries(extensions.sections ?? {}))
    registerServiceSection(name, component);
}

export const contributedWidget = (name: string): Component<WidgetProps> | undefined =>
  extraWidgets.get(name);

export const stepConditions = (): Readonly<Record<string, ((form: Form) => boolean) | undefined>> =>
  Object.fromEntries(applies);

/** The registered sections, by name (the order they were registered in). */
export const serviceSections = (): [string, Component<ServiceSectionProps>][] => [
  ...sections.entries(),
];

/** For tests: forget what a test registered. */
export function resetExtensions(): void {
  extraWidgets.clear();
  applies.clear();
  sections.clear();
}

// ----- what a widget may read of its field -------------------------------------------------------------------

/** The part of a wizard field that a contributed widget may need: its config and the options the server sent. */
export interface WizardFieldInfo {
  config: Record<string, unknown>;
  choices?: { value: string; label?: string | undefined; labelKey?: string | undefined }[];
}

export interface WizardFieldContext {
  field: (pointer: string) => WizardFieldInfo | undefined;
}

const FIELD_KEY = Symbol('scorpion.wizard.field');

export function setWizardFieldContext(context: WizardFieldContext): void {
  setContext(FIELD_KEY, context);
}

export function getWizardFieldContext(): WizardFieldContext {
  const context = getContext<WizardFieldContext | undefined>(FIELD_KEY);
  if (!context) throw new Error('a widget of the service wizard needs the wizard page around it');
  return context;
}
