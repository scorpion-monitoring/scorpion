import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES as SERVER_MAX_FILE_BYTES } from '../service/ingestion.ts';
import { fileForm, MAX_FILE_BYTES } from './upload.ts';

const SERVICE = '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001';

describe('the multipart body of a file', () => {
  const file = new File(['Period,Downloads\n2026-05,10\n'], 'data.csv', { type: 'text/csv' });

  it('holds the service and the file with its own name, and nothing parsed', async () => {
    const form = fileForm({ serviceId: SERVICE, file });
    expect([...form.keys()].sort()).toEqual(['file', 'serviceId']);
    expect(form.get('serviceId')).toBe(SERVICE);
    const sent = form.get('file') as File;
    expect(sent.name).toBe('data.csv');
    expect(await sent.text()).toBe('Period,Downloads\n2026-05,10\n');
  });

  it('sends the mapping as JSON text of the mapped columns only, and dryRun as a word', () => {
    const form = fileForm(
      { serviceId: SERVICE, file, mapping: { '0': 'period', '1': '', '2': 'i1' } },
      true,
    );
    expect(JSON.parse(form.get('mapping') as string)).toEqual({ '0': 'period', '2': 'i1' });
    expect(form.get('dryRun')).toBe('true');
    expect(fileForm({ serviceId: SERVICE, file }, false).get('dryRun')).toBe('false');
    expect(fileForm({ serviceId: SERVICE, file }).has('dryRun')).toBe(false);
  });

  it('sends the same bytes each time it is built', async () => {
    const a = (fileForm({ serviceId: SERVICE, file }).get('file') as File).text();
    const b = (fileForm({ serviceId: SERVICE, file }, true).get('file') as File).text();
    expect(await a).toBe(await b);
  });
});

describe('the limits the page shares with the server', () => {
  it('has the same file size as the route', () => {
    expect(MAX_FILE_BYTES).toBe(SERVER_MAX_FILE_BYTES);
  });
});
