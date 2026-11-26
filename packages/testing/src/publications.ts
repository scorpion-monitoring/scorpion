// Factories for `biblio_publication` and `biblio_doi_metadata` (bibliometrics). They insert rows directly, so a test can set
// up data of any shape without the service layer or a DOI lookup. They know the column names: a change to the schema breaks
// the integration tests, which is the point. They need the module's migrations to have run, do not check that the service
// exists, and the tables' own rules still apply.
import { randomUUID } from 'node:crypto';
import type { Queryable } from './identity.ts';

let counter = 0;

export interface MakePublication {
  id?: string;
  serviceId: string;
  /** Normalised (lower case, no prefix). Default: a DOI under `10.5555/` unique across a run. */
  doi?: string;
  addedBy?: string | null;
  addedAt?: Date;
  /** The date a provider member gave: the first day of the month with `month`, or a day with `day`. Both or neither. */
  issued?: string | null;
  issuedPrecision?: 'month' | 'day' | null;
  /** Also stores the DOI's metadata (`makeDoiMetadata`), unless it is `null` (the default: no metadata row). */
  metadata?: Omit<MakeDoiMetadata, 'doi'> | null;
}

export interface PublicationRow {
  id: string;
  service_id: string;
  doi: string;
  added_by: string | null;
  added_at: Date;
  issued: string | null;
  issued_precision: string | null;
}

export async function makePublication(
  db: Queryable,
  input: MakePublication,
): Promise<PublicationRow> {
  const doi = input.doi ?? `10.5555/factory-${++counter}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await db.query<PublicationRow>(
    `insert into biblio_publication (id, service_id, doi, added_by, added_at, issued, issued_precision)
     values ($1, $2, $3, $4, coalesce($5, now()), $6, $7)
     returning *`,
    [
      input.id ?? randomUUID(),
      input.serviceId,
      doi,
      input.addedBy ?? null,
      input.addedAt ?? null,
      input.issued ?? null,
      input.issuedPrecision ?? null,
    ],
  );
  if (input.metadata) await makeDoiMetadata(db, { ...input.metadata, doi });
  return rows[0]!;
}

export interface MakeDoiMetadata {
  doi: string;
  /** Default `ok`, which needs a title (default `Title of <doi>`). */
  status?: 'ok' | 'not-found' | 'failed';
  /** Required for `failed` (default `timeout` then). */
  reason?: string | null;
  title?: string | null;
  authors?: string[];
  /** The first day of the period: `2020-01-01` with precision `year`. Both or neither. */
  issued?: string | null;
  issuedPrecision?: 'year' | 'month' | 'day' | null;
  container?: string | null;
  type?: string | null;
}

export async function makeDoiMetadata(db: Queryable, input: MakeDoiMetadata) {
  const status = input.status ?? 'ok';
  const { rows } = await db.query<{ doi: string; status: string }>(
    `insert into biblio_doi_metadata
       (doi, status, reason, title, authors, issued, issued_precision, container, type)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (doi) do update set status = excluded.status, reason = excluded.reason, title = excluded.title,
       authors = excluded.authors, issued = excluded.issued, issued_precision = excluded.issued_precision,
       container = excluded.container, type = excluded.type, resolved_at = now()
     returning doi, status`,
    [
      input.doi,
      status,
      input.reason ?? (status === 'failed' ? 'timeout' : null),
      input.title ?? (status === 'ok' ? `Title of ${input.doi}` : null),
      JSON.stringify(input.authors ?? []),
      input.issued ?? null,
      input.issued ? (input.issuedPrecision ?? 'day') : null,
      input.container ?? null,
      input.type ?? null,
    ],
  );
  return rows[0]!;
}
