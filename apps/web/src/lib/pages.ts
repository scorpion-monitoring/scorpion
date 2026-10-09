// The table of pages of this build: the browser halves that the modules of the profile export, found
// through the generated file. Built once, when the app starts.
import type { UiRoute } from '@scorpion/contracts';
import { uiModules } from '../generated/ui.ts';

export interface Page {
  package: string;
  route: UiRoute;
}

function buildTable(): ReadonlyMap<string, Page> {
  const table = new Map<string, Page>();
  for (const module of uiModules) {
    for (const route of module.routes) {
      const taken = table.get(route.path);
      if (taken) {
        throw new Error(
          `Page "${route.path}" is registered by both ${taken.package} and ${module.package}`,
        );
      }
      table.set(route.path, { package: module.package, route });
    }
  }
  return table;
}

export const pages = buildTable();
export const patterns: readonly string[] = [...pages.keys()];
