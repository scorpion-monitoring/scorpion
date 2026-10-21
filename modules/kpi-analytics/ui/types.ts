// The types the widgets share, in a `.ts` file so the Svelte components and the linter resolve them the same way.
import type { AnalyticsSummary } from '@scorpion/contracts/client';

export type Row = AnalyticsSummary['result'][number];

/** What a widget's body is given once its numbers have arrived. */
export interface Body {
  rows: Row[];
  /** How many KPIs the service has in this window (the envelope's count); more than `rows` when the page is full. */
  total: number;
  /** The months of the window, oldest first, as the first KPI's points have them. */
  months: string[];
  /** The label of a unit term in the person's language; the term's own key where the vocabulary has none, `''` for no unit. */
  unit: (key: string | null) => string;
}
