// What the start page needs before it renders: the signed-in person's dashboard, as the server repaired it. It runs
// on the server, so the browser sends nothing for the document or the widget list on arrival. A visitor (401) and
// a caller whose role has no dashboard (403) get no grid; any other failure throws (defect 12).
import type { UiLoadContext } from '@scorpion/contracts';
import { ApiError, unwrap } from '@scorpion/contracts/client';
import type { DashboardView } from './dashboard.ts';

export interface HomeData {
  /** `null`: there is no dashboard to show (a visitor, or a caller without the permission). */
  dashboard: DashboardView | null;
}

export async function loadHome({ api }: UiLoadContext): Promise<HomeData> {
  try {
    return { dashboard: await unwrap(api.GET('/ui/dashboard')) };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return { dashboard: null };
    }
    throw error;
  }
}
