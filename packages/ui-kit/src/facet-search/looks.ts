// The looks by name: `FacetSearch` picks one here and nowhere else.
import type { Component } from 'svelte';
import type { FacetLook } from './model.ts';
import BarLook from './BarLook.svelte';
import CombinedLook from './CombinedLook.svelte';
import SidebarLook from './SidebarLook.svelte';
import type { LookProps } from './types.ts';

export const LOOKS: Record<FacetLook, Component<LookProps>> = {
  sidebar: SidebarLook,
  bar: BarLook,
  combined: CombinedLook,
};
