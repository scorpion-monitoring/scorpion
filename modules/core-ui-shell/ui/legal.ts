import type { UiLoadContext } from '@scorpion/contracts';
import { ApiError, unwrap } from '@scorpion/contracts/client';

export interface LegalData {
  title: string;
  /** Sanitised on the server (DOMPurify, `GET /legal/{page}`); the page renders it through `SafeHtml`. */
  html: string;
}

/**
 * The text of a legal page. The API answers 404 for a text nobody wrote and for a name that is none of
 * the three pages; both reach the visitor as the error page, because this throws (defect 12).
 */
export async function loadLegal({ params, api }: UiLoadContext): Promise<LegalData> {
  const page = params.page;
  if (page !== 'terms' && page !== 'privacy' && page !== 'imprint') {
    // The path matched `/legal/:page`, but the API knows three pages only: that is a page that does not exist.
    throw new ApiError(404, {
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'There is no such page.',
    });
  }
  const { title, html } = await unwrap(api.GET('/legal/{page}', { params: { path: { page } } }));
  return { title, html };
}
