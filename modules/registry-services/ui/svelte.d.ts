// Svelte components are compiled by the web app; this only lets the TypeScript project of the module
// type-check the lazy imports of the pages that arrive with sprint 4.
declare module '*.svelte' {
  import type { Component } from 'svelte';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: Component<any>;
  export default component;
}
