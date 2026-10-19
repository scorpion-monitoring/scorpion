// How another module reaches the wizard in the browser: the widget that draws its field type, and the condition
// under which its step is shown. The registry itself lives in `@scorpion/ui-kit` (`wizard-extensions.ts`): a
// contributing module's `ui` entry exports `wizardExtensions` and the shell forwards it there at start
// (ADR-0040 addendum), so nothing here depends on a module that a profile may leave out. This file keeps the
// names the pages and the tests of this module use.
export {
  contributedWidget,
  registerFieldWidget,
  registerStepApplies,
  resetExtensions,
  stepConditions,
} from '@scorpion/ui-kit';
