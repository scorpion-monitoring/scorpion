import type { DashboardService } from './dashboard/service.ts';
import type { NavigationService } from './navigation.ts';

/** What `ctx.deps['core.ui-shell']` is: what the caller may see, and the caller's own dashboard. */
export type ShellService = NavigationService & { dashboard: DashboardService };
