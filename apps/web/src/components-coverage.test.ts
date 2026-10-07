// Every shared component has a keyboard test and an axe check (M5 plan, §2 and §8). The specs of the
// components are in `e2e/components` and name the component in their titles: `[component:DataTable] keyboard`
// and `[component:DataTable] axe`. This test fails for a component of `packages/ui-kit` that has neither a
// pair of such specs nor a place in the list of pieces that are covered through the pages that use them, and
// for a title that names a component that does not exist.
import { globSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(import.meta.dirname, '../../..');
const kit = globSync('packages/ui-kit/src/*.svelte', { cwd: repo }).map((file) =>
  basename(file, '.svelte'),
);

/** Components with specs of their own in e2e/components. */
const WITH_SPECS = [
  'Breadcrumb',
  'Chart',
  'ConfirmDialog',
  'DataTable',
  'Facets',
  'Pagination',
  'SchemaForm',
  'Tabs',
  'Toasts',
  'Wizard',
];

/** Parts of another component, tested through it. */
const PARTS_OF: Record<string, string> = { FieldShell: 'SchemaForm', SchemaField: 'SchemaForm' };

/**
 * Components of sprint 2, covered by the pages that use them: the sign-in, registration, recovery and profile
 * pages are checked with axe in both themes and with the keyboard alone in `e2e/accessibility-auth.spec.ts`.
 */
const THROUGH_PAGES = [
  'Alert',
  'Dialog',
  'ReauthDialog',
  'SafeHtml',
  'SubmitButton',
  'TextArea',
  'TextField',
  'Time',
];

const specs = globSync('apps/web/e2e/components/*.spec.ts', { cwd: repo })
  .map((file) => readFileSync(resolve(repo, file), 'utf8'))
  .join('\n');

describe('the shared components', () => {
  it('are found', () => {
    expect(kit.length).toBeGreaterThan(15);
  });

  it('are each in exactly one list, so a new component has to be put in one on purpose', () => {
    const known = [...WITH_SPECS, ...Object.keys(PARTS_OF), ...THROUGH_PAGES];
    expect(kit.filter((name) => !known.includes(name))).toEqual([]);
    expect(known.filter((name) => !kit.includes(name))).toEqual([]);
    expect(new Set(known).size).toBe(known.length);
  });

  it.each(WITH_SPECS)('%s has a keyboard test and an axe check', (name) => {
    expect(specs, `${name}: no "[component:${name}] keyboard" test`).toContain(
      `[component:${name}] keyboard`,
    );
    expect(specs, `${name}: no "[component:${name}] axe" check`).toContain(
      `[component:${name}] axe`,
    );
  });

  it('are named correctly in the specs', () => {
    const named = [...specs.matchAll(/\[component:(\w+)\]/g)].map((match) => match[1]!);
    expect(named.filter((name) => !WITH_SPECS.includes(name))).toEqual([]);
  });

  it('that are only parts of another one name one that has specs', () => {
    for (const parent of Object.values(PARTS_OF)) expect(WITH_SPECS).toContain(parent);
  });

  it('of sprint 2 are covered by the accessibility specs of their pages', () => {
    const pages = readFileSync(resolve(repo, 'apps/web/e2e/accessibility-auth.spec.ts'), 'utf8');
    expect(pages).toContain('no serious violation');
    expect(pages).toContain('the keyboard');
  });
});
