// The shell forwards the optional `wizardExtensions` export of every module's `ui` entry to the registry in
// `@scorpion/ui-kit`, which the pages of `registry.services` read (ADR-0040 addendum). Once per process: the
// generated table does not change while the app runs, and registering twice is an error.
import { registerWizardExtensions } from '@scorpion/ui-kit';
import type { UiModule } from './ui-modules.ts';

let forwarded = false;

export function forwardWizardExtensions(modules: readonly UiModule[]): void {
  if (forwarded) return;
  forwarded = true;
  for (const module of modules) registerWizardExtensions(module.wizardExtensions);
}

/** For tests: forward again. */
export function resetForwarding(): void {
  forwarded = false;
}
