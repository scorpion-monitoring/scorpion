import type { AboutService } from './about.ts';
import type { DashboardService } from './dashboard/service.ts';
import type { NavigationService } from './navigation.ts';

/** What `ctx.deps['core.ui-shell']` is: what the caller may see, the caller's own dashboard, and the About page. */
export type ShellService = NavigationService & { dashboard: DashboardService } & AboutService;
