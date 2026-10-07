// The pages of the modules of the real profile (ADR-0027): the entries of the registries that
// `core.ui-shell` declares. The shell checks them again when it starts; this test makes the rules
// about public pages and links a failing test, on the committed `full` profile.
import { PUBLIC_PAGES, REGISTRIES } from '@scorpion/core-ui-shell/public';
import { describe, expect, it } from 'vitest';
import { sources } from './generated/profile.ts';

type Entry = { module: string; value: Record<string, unknown> };
const contributions = (registry: keyof typeof REGISTRIES): Entry[] =>
  sources.flatMap(({ manifest }) =>
    ((manifest.contributes?.[registry] ?? []) as Record<string, unknown>[]).map((value) => ({
      module: manifest.id,
      value,
    })),
  );

const permissions = new Set(
  sources.flatMap(({ manifest }) => Object.keys(manifest.permissions ?? {})),
);
const routes = contributions('ui.routes');

describe('the pages of the full profile', () => {
  it('are valid entries of the registry, each of them a permission or a public page with a reason', () => {
    for (const registry of Object.keys(REGISTRIES) as (keyof typeof REGISTRIES)[]) {
      for (const { module, value } of contributions(registry)) {
        const parsed = REGISTRIES[registry].safeParse(value);
        expect(parsed.success, `${module} ${registry} ${JSON.stringify(value)}`).toBe(true);
      }
    }
  });

  it('name only permissions that a module declares', () => {
    for (const registry of ['ui.routes', 'ui.nav', 'ui.widget'] as const) {
      for (const { module, value } of contributions(registry)) {
        if (typeof value.permission === 'string') {
          expect(permissions.has(value.permission), `${module}: ${value.permission}`).toBe(true);
        }
      }
    }
  });

  it('make public exactly the pages that are declared as public, so a page cannot become public by accident', () => {
    const published = routes
      .filter(({ value }) => value.public === true)
      .map(({ value }) => value.path as string);
    expect([...published].sort()).toEqual([...PUBLIC_PAGES].sort());
  });

  it('are each registered once, and every link leads to a registered page', () => {
    const paths = routes.map(({ value }) => value.path as string);
    expect(new Set(paths).size).toBe(paths.length);
    for (const { module, value } of contributions('ui.nav')) {
      expect(paths, `${module}: ${value.id as string}`).toContain(value.path);
    }
  });

  it('have a page in the browser half for every path of the server half, and none without one', async () => {
    // The browser half of each module that has one, as the web app imports it.
    const browser: string[] = [];
    for (const { manifest } of sources) {
      if (!manifest.ui) continue;
      const module = (await manifest.ui()) as { default: { path: string }[] };
      browser.push(...module.default.map((route) => route.path));
    }
    expect([...browser].sort()).toEqual(routes.map(({ value }) => value.path as string).sort());
  });
});
