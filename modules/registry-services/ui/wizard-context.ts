// What the widgets of the wizard read of the page: the field a pointer belongs to (its role, its options, its
// config) and the organisations a role may choose from. The page sets it once; a widget asks for what it
// needs, so no widget is handed a list it did not ask for and none guesses one from a role.
import { getContext, setContext } from 'svelte';
import type { OrganisationChoices, WizardField } from './wizard-types.ts';

export interface WizardContext {
  field: (pointer: string) => WizardField | undefined;
  organisations: (role: string) => OrganisationChoices;
}

const KEY = Symbol('scorpion.services.wizard');

export function setWizardContext(context: WizardContext): void {
  setContext(KEY, context);
}

export function getWizardContext(): WizardContext {
  const context = getContext<WizardContext | undefined>(KEY);
  if (!context) throw new Error('a widget of the service wizard needs the wizard page around it');
  return context;
}
