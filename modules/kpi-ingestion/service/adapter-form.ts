// The form adapter: the Data Submission page's form and the API share one path with the files. Input is one period and the values by
// indicator id; a blank value is "no value", an error only for a mandatory indicator (the form says so). There is no table, so the
// "column" of a problem is the position of the indicator on the form (the order of the effective KPI set, 1-based).
import { failed, type AdapterEntry, type AdapterOutput } from './adapters.ts';
import type { ParsedRow, TableProblem } from './table.ts';

export const formAdapter: AdapterEntry = {
  id: 'form',
  labels: { en: 'Form', de: 'Formular' },
  input: 'values',
  accepts: { extensions: [], mediaTypes: [] },
  parse(input, context): AdapterOutput {
    if (!input.form) return failed([{ row: 0, column: 0, code: 'empty-file' }]);
    const { period, values } = input.form;
    const position = new Map(
      context.indicators.map((indicator, index) => [indicator.indicatorId, index + 1]),
    );
    const rows: ParsedRow[] = [];
    const problems: TableProblem[] = [];
    const given = new Set<string>();
    for (const [indicator, raw] of Object.entries(values)) {
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (value === '') continue;
      given.add(indicator);
      rows.push({
        indicator,
        period,
        value,
        // an id the set does not have is the verdict of `upsertBatch`; it is put at column 0
        origin: { row: 1, column: position.get(indicator) ?? 0, periodColumn: 0 },
      });
    }
    if (rows.length > 0)
      for (const indicator of context.indicators)
        if (indicator.mandatory && !given.has(indicator.indicatorId))
          problems.push({
            row: 1,
            column: position.get(indicator.indicatorId)!,
            code: 'required-value',
          });
    return {
      header: [],
      preview: { rows: [], rowNumbers: [] },
      totalRows: rows.length,
      targets: [],
      mapping: {},
      proposed: false,
      missing: [],
      rows,
      problems,
    };
  },
};
