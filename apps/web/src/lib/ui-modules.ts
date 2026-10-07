import type { UiMessages, UiRoute } from '@scorpion/contracts';

/** The browser half of one module, as `src/generated/ui.ts` lists it. */
export interface UiModule {
  package: string;
  routes: UiRoute[];
  messages: UiMessages;
}
