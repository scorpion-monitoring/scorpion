// The server half of the widgets of kpi.analytics: who may see them and how they sit on the grid. Plain data, so the manifest can use it without
// loading Svelte. The browser half (`./widgets.ts`) lists the same names with their components, and `ui.test.ts` checks that the two agree.
// Entries of `core.ui-shell`'s registry `ui.widget`, which is an optional peer: a profile without it skips them. The shell knows no widget by name.
import type { WidgetEntry } from '@scorpion/core-ui-shell/public';
import { PERMISSION_READ } from '../service/permissions.ts';
import { filterConfigSchema, trendsConfigSchema } from '../service/widget-config.ts';

export const WIDGET_IDS = {
  cards: 'kpi.analytics.cards',
  trends: 'kpi.analytics.trends',
  averages: 'kpi.analytics.averages',
  volatility: 'kpi.analytics.volatility',
  actions: 'kpi.analytics.actions',
} as const;

export const ANALYTICS_WIDGETS: WidgetEntry[] = [
  {
    id: WIDGET_IDS.cards,
    slot: 'dashboard',
    component: 'cards',
    order: 30,
    permission: PERMISSION_READ,
    label: 'analytics.cards.title',
    description: 'analytics.cards.about',
    icon: 'list',
    grid: { w: 4, h: 5, minW: 3, minH: 3, maxW: 12, maxH: 12, default: { x: 0, y: 3, w: 4, h: 5 } },
    configSchema: filterConfigSchema,
  },
  {
    id: WIDGET_IDS.trends,
    slot: 'dashboard',
    component: 'trends',
    order: 40,
    permission: PERMISSION_READ,
    label: 'analytics.trends.title',
    description: 'analytics.trends.about',
    icon: 'chart',
    grid: { w: 8, h: 5, minW: 4, minH: 4, maxW: 12, maxH: 14, default: { x: 4, y: 3, w: 8, h: 5 } },
    configSchema: trendsConfigSchema,
  },
  {
    id: WIDGET_IDS.averages,
    slot: 'dashboard',
    component: 'averages',
    order: 50,
    permission: PERMISSION_READ,
    label: 'analytics.averages.title',
    description: 'analytics.averages.about',
    icon: 'list',
    grid: { w: 4, h: 4, minW: 3, minH: 2, maxW: 12, maxH: 12 },
    configSchema: filterConfigSchema,
  },
  {
    id: WIDGET_IDS.volatility,
    slot: 'dashboard',
    component: 'volatility',
    order: 60,
    permission: PERMISSION_READ,
    label: 'analytics.volatility.title',
    description: 'analytics.volatility.about',
    icon: 'chart',
    grid: { w: 4, h: 4, minW: 3, minH: 3, maxW: 12, maxH: 12 },
    configSchema: filterConfigSchema,
  },
  {
    id: WIDGET_IDS.actions,
    slot: 'dashboard',
    component: 'actions',
    order: 70,
    permission: PERMISSION_READ,
    label: 'analytics.actions.title',
    description: 'analytics.actions.about',
    icon: 'settings',
    grid: {
      w: 4,
      h: 3,
      minW: 3,
      minH: 2,
      maxW: 8,
      maxH: 6,
      singleton: true,
      default: { x: 0, y: 8, w: 4, h: 3 },
    },
  },
];
