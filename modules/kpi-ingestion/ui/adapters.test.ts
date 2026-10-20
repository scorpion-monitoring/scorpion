import { describe, expect, it } from 'vitest';
import {
  acceptAttribute,
  acceptedExtensions,
  adapterLabel,
  downloadName,
  templateFormats,
} from './adapters.ts';
import type { Adapter } from './types.ts';

// What `GET /kpi/ingestion/adapters` answers for the three shipped ways.
const adapters: Adapter[] = [
  {
    id: 'form',
    labels: { en: 'Form', de: 'Formular' },
    input: 'values',
    extensions: [],
    mediaTypes: [],
    template: null,
  },
  {
    id: 'csv',
    labels: { en: 'CSV or TSV file', de: 'CSV- oder TSV-Datei' },
    input: 'file',
    extensions: ['csv', 'tsv', 'txt'],
    mediaTypes: ['text/csv'],
    template: 'csv',
  },
  {
    id: 'xlsx',
    labels: { en: 'Excel workbook (XLSX)' },
    input: 'file',
    extensions: ['xlsx'],
    mediaTypes: ['application/vnd.ms-excel'],
    template: 'xlsx',
  },
];

describe('what the file adapters accept', () => {
  it('lists the extensions of the file adapters only, with a dot, each once', () => {
    expect(acceptedExtensions(adapters)).toEqual(['.csv', '.tsv', '.txt', '.xlsx']);
    expect(acceptedExtensions([...adapters, { ...adapters[1]!, id: 'again' }])).toEqual([
      '.csv',
      '.tsv',
      '.txt',
      '.xlsx',
    ]);
    expect(acceptedExtensions([])).toEqual([]);
  });

  it('writes the accept attribute with the extensions and then the media types', () => {
    expect(acceptAttribute(adapters)).toBe(
      '.csv,.tsv,.txt,.xlsx,text/csv,application/vnd.ms-excel',
    );
  });

  it('follows the registry: an adapter added later is accepted without a change here', () => {
    const more: Adapter = {
      id: 'ods',
      labels: { en: 'ODS' },
      input: 'file',
      extensions: ['.ODS'],
      mediaTypes: [],
      template: null,
    };
    expect(acceptedExtensions([...adapters, more])).toContain('.ods');
  });
});

describe('templateFormats', () => {
  it('lists the adapters that have a template, by id, with the extension of the file in capitals', () => {
    expect(templateFormats(adapters)).toEqual([
      { id: 'csv', label: 'CSV' },
      { id: 'xlsx', label: 'XLSX' },
    ]);
  });
});

describe('adapterLabel', () => {
  it.each<[string, string, string]>([
    ['csv', 'de', 'CSV- oder TSV-Datei'],
    ['csv', 'en', 'CSV or TSV file'],
    ['xlsx', 'de', 'Excel workbook (XLSX)'],
    ['form', 'fr', 'Form'],
    ['rest-pull', 'en', 'rest-pull'],
  ])('names %s in %s as %s', (id, locale, expected) => {
    expect(adapterLabel(adapters, id, locale)).toBe(expected);
  });
});

describe('downloadName', () => {
  it.each<[string | null, string]>([
    ['attachment; filename="svc-import-template.csv"', 'svc-import-template.csv'],
    ['attachment; filename=svc.xlsx', 'svc.xlsx'],
    ["attachment; filename*=UTF-8''sv%C3%A4.csv", 'svä.csv'],
    ['attachment; filename="../../etc/passwd"', 'passwd'],
    ['attachment; filename="C:\\temp\\x.csv"', 'x.csv'],
    ['attachment', 'fallback.csv'],
    [null, 'fallback.csv'],
  ])('takes the name from %j: %s', (header, expected) => {
    expect(downloadName(header, 'fallback.csv')).toBe(expected);
  });
});
