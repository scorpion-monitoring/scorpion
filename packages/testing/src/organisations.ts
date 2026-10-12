// A factory for the table of `registry.organisations`. It inserts a row directly, so a test can set
// up an organisation of any shape without going through the service. It knows the column names: a
// change to the schema breaks the integration tests, which is the point. It needs the module's
// migrations to have run.
import { randomUUID } from 'node:crypto';
import type { Queryable } from './identity.ts';

let sequence = 0;
const next = () => ++sequence;

export interface MakeOrganisation {
  id?: string;
  /** Default `provider`. */
  type?: string;
  abbreviation?: string;
  name?: string;
  description?: string | null;
  website?: string | null;
  /** The bare ROR id. */
  rorId?: string | null;
  sameAs?: string[];
  contactEmail?: string | null;
  contactType?: string | null;
  /** A logo: both or neither (the table checks it). */
  logoBlobId?: string | null;
  logoHash?: string | null;
  createdBy?: string | null;
}

export interface OrganisationRow {
  id: string;
  type: string;
  abbreviation: string;
  name: string;
  description: string | null;
  website: string | null;
  ror_id: string | null;
  same_as: string[];
  contact_email: string | null;
  contact_type: string | null;
  logo_blob_id: string | null;
  logo_hash: string | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
}

export async function makeOrganisation(
  db: Queryable,
  overrides: MakeOrganisation = {},
): Promise<OrganisationRow> {
  const n = next();
  const { rows } = await db.query<OrganisationRow>(
    `insert into org_organisation
       (id, type, abbreviation, name, description, website, ror_id, same_as, contact_email,
        contact_type, logo_blob_id, logo_hash, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
     returning *`,
    [
      overrides.id ?? randomUUID(),
      overrides.type ?? 'provider',
      overrides.abbreviation ?? `ORG${n}`,
      overrides.name ?? `Organisation ${n}`,
      overrides.description ?? null,
      overrides.website ?? null,
      overrides.rorId ?? null,
      overrides.sameAs ?? [],
      overrides.contactEmail ?? null,
      overrides.contactType ?? null,
      overrides.logoBlobId ?? null,
      overrides.logoHash ?? null,
      overrides.createdBy ?? null,
    ],
  );
  return rows[0]!;
}
