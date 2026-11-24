// The page on screen as the shell hands it to a widget that follows the pages (`Shell.onNavigated`, ADR-0054): the
// registered pattern, not the address. Every page of the application is the catch-all route, whose data names the
// pattern it matched (`[...path]/+page.server.ts`); the error page has none.
import { stripBase } from '@scorpion/contracts';
import type { ShownPage } from '@scorpion/ui-kit';

export interface PageState {
  data: unknown;
  status: number;
  pathname: string;
}

export function shownPage(basePath: string, state: PageState): ShownPage {
  const pattern = (state.data as { pattern?: unknown } | null | undefined)?.pattern;
  return {
    pattern: state.status < 400 && typeof pattern === 'string' ? pattern : null,
    pathname: stripBase(basePath, state.pathname) ?? state.pathname,
    status: state.status,
  };
}
