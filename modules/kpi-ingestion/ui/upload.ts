// The calls the page makes to send a file or a form, through the typed client. A file travels as multipart (the client has no multipart helper,
// so `bodySerializer` hands it a `FormData`, as the logo widget hands it a raw file); the page keeps the `File` in memory and sends the same
// bytes again for the preview, the dry run and the commit. It never sends parsed rows, and a file is never read as text here.
import { unwrap, type ApiClient } from '@scorpion/contracts/client';
import { mappingBody, type Mapping } from './mapping.ts';
import type { Preview, RunResult } from './types.ts';

/** The server's ceiling for a file (`MAX_FILE_BYTES`); the page spares a person the upload of a file that cannot be accepted. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface FileRequest {
  serviceId: string;
  file: File;
  /** The mapping the person chose; absent to let the server propose one. */
  mapping?: Mapping | undefined;
}

/** The multipart body of a file request: the file, the service, the mapping as JSON text and, for a dry run, `dryRun`. */
export function fileForm(request: FileRequest, dryRun?: boolean): FormData {
  const form = new FormData();
  form.set('serviceId', request.serviceId);
  if (request.mapping) form.set('mapping', mappingBody(request.mapping));
  if (dryRun !== undefined) form.set('dryRun', dryRun ? 'true' : 'false');
  form.set('file', request.file, request.file.name);
  return form;
}

const asBody = (form: FormData) => ({ bodySerializer: () => form as unknown as BodyInit });

/** One call: the header, the first rows and the proposed (or the given) mapping. Writes nothing. */
export function previewFile(api: ApiClient, request: FileRequest): Promise<Preview> {
  const form = fileForm(request);
  return unwrap(
    api.POST('/kpi/ingestion/preview', { body: { serviceId: request.serviceId }, ...asBody(form) }),
  );
}

/** One call: the verdict of each value, nothing is written. */
export function dryRunFile(api: ApiClient, request: FileRequest): Promise<RunResult> {
  const form = fileForm(request, true);
  return unwrap(
    api.POST('/kpi/ingestion/runs', { body: { serviceId: request.serviceId }, ...asBody(form) }),
  );
}

/** One call: records the file, or a 422 when anything is rejected (the whole file is refused). */
export function commitFile(api: ApiClient, request: FileRequest): Promise<RunResult> {
  const form = fileForm(request, false);
  return unwrap(
    api.POST('/kpi/ingestion/runs', { body: { serviceId: request.serviceId }, ...asBody(form) }),
  );
}

/** One call: records the values of a form for a month (`YYYY-MM`), or a 422 naming the fields that are wrong. */
export function commitForm(
  api: ApiClient,
  request: { serviceId: string; period: string; values: Record<string, string> },
): Promise<RunResult> {
  return unwrap(
    api.POST('/kpi/ingestion/runs', {
      body: {
        serviceId: request.serviceId,
        form: { period: request.period, values: request.values },
        dryRun: false,
      },
    }),
  );
}
