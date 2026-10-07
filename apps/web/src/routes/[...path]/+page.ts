import type { Component } from 'svelte';
import type { PageLoad } from './$types';
import { pages } from '#lib/pages.ts';

// What every page of the table receives. A page that takes no props ignores both.
type PageComponent = Component<{ data: unknown; params: Record<string, string> }>;

// Runs on the server for the first request and in the browser afterwards: the page's component is
// imported here, so a page of another profile is never in the bundle's reach.
export const load: PageLoad = async ({ data }) => {
  const page = pages.get(data.pattern)!;
  const { default: component } = await page.route.component();
  // A page takes `data` and `params` or no props at all; the table cannot tell which, and a page that
  // takes none ignores what it is given.
  return { ...data, component: component as unknown as PageComponent };
};
