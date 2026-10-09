// The widgets of the modules of this profile by the `component` name of their `ui.widget` entries. A name
// is unique across the modules (a test fails for a duplicate), so the entry the server lists is enough to
// find the code.
import type { UiWidgets } from '@scorpion/contracts';
import type { UiModule } from './ui-modules.ts';

export function widgetLoaders(
  modules: readonly Pick<UiModule, 'package' | 'widgets'>[],
): UiWidgets {
  const found: UiWidgets = {};
  const owner = new Map<string, string>();
  for (const module of modules) {
    for (const [name, loader] of Object.entries(module.widgets)) {
      const earlier = owner.get(name);
      if (earlier !== undefined) {
        throw new Error(`widget "${name}" is offered by both ${earlier} and ${module.package}`);
      }
      owner.set(name, module.package);
      found[name] = loader;
    }
  }
  return found;
}
