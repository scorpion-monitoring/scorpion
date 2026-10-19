import type { UiMessages, UiRoute, UiWidgets } from '@scorpion/contracts';
import type { WizardExtensions } from '@scorpion/ui-kit';

/** The browser half of one module, as `src/generated/ui.ts` lists it. */
export interface UiModule {
  package: string;
  routes: UiRoute[];
  messages: UiMessages;
  widgets: UiWidgets;
  /** What the module contributes to the services wizard and the service page; the shell forwards it. */
  wizardExtensions?: WizardExtensions | undefined;
}

/** The optional fourth export of a module's `ui` entry (ADR-0040 addendum): `undefined` when it has none. */
export const wizardExtensionsOf = (entry: object): WizardExtensions | undefined =>
  (entry as { wizardExtensions?: WizardExtensions }).wizardExtensions;
