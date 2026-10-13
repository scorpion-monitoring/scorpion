// A factory for the tables of `registry.services`. It inserts rows directly (the service, its slug history
// row, its organisation links and field values), so a test can set up a service of any shape without going
// through the service layer. It knows the column names: a change to the schema breaks the integration
// tests, which is the point. It needs the module's migrations to have run. Organisations come from
// `makeOrganisation`; the factory does not create them.
import { randomUUID } from 'node:crypto';
import type { Queryable } from './identity.ts';

let sequence = 0;
const next = () => ++sequence;

export interface MakeService {
  id?: string;
  /** Default `svc-<n>`: unique across a run, so specs that share a database do not clash. */
  slug?: string;
  name?: string;
  license?: string | null;
  /** A term of the `stage` vocabulary; default `PROD`. */
  stage?: string;
  description?: string | null;
  url?: string | null;
  sameAs?: string[];
  contactEmail?: string | null;
  contactType?: string | null;
  /** An icon: both or neither (the table checks it). */
  iconBlobId?: string | null;
  iconHash?: string | null;
  /** Sets `published_at` and `published_by` with it (the table checks the three together). */
  public?: boolean;
  publishedBy?: string | null;
  createdBy?: string | null;
  /** The provider organisation id (role `provider`). */
  provider?: string;
  /** Organisation ids with the role `consortium`. */
  consortia?: readonly string[];
  /** Any other links: `{ organisationId, role }`. */
  organisations?: readonly { organisationId: string; role: string }[];
  /** Values of configured fields stored in `svc_field_value`, by field key. */
  values?: Readonly<Record<string, unknown>>;
  /** Extra slugs the service had before (they go to `svc_slug_history`, never reused). */
  oldSlugs?: readonly string[];
}

export interface ServiceRow {
  id: string;
  slug: string;
  name: string;
  license: string | null;
  stage: string;
  description: string | null;
  url: string | null;
  same_as: string[];
  contact_email: string | null;
  contact_type: string | null;
  icon_blob_id: string | null;
  icon_hash: string | null;
  public: boolean;
  published_at: Date | null;
  published_by: string | null;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
}

export async function makeService(db: Queryable, overrides: MakeService = {}): Promise<ServiceRow> {
  const n = next();
  const id = overrides.id ?? randomUUID();
  const slug = overrides.slug ?? `svc-${n}-${id.slice(0, 8)}`;
  const isPublic = overrides.public ?? false;
  const { rows } = await db.query<ServiceRow>(
    `insert into svc_service
       (id, slug, name, license, stage, description, url, same_as, contact_email, contact_type,
        icon_blob_id, icon_hash, public, published_at, published_by, created_by, updated_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
     returning *`,
    [
      id,
      slug,
      overrides.name ?? `Service ${n}`,
      overrides.license ?? null,
      overrides.stage ?? 'PROD',
      overrides.description ?? null,
      overrides.url ?? null,
      overrides.sameAs ?? [],
      overrides.contactEmail ?? null,
      overrides.contactType ?? null,
      overrides.iconBlobId ?? null,
      overrides.iconHash ?? null,
      isPublic,
      isPublic ? new Date() : null,
      isPublic ? (overrides.publishedBy ?? overrides.createdBy ?? randomUUID()) : null,
      overrides.createdBy ?? null,
    ],
  );
  for (const old of [slug, ...(overrides.oldSlugs ?? [])]) {
    await db.query('insert into svc_slug_history (id, slug, service_id) values ($1, $2, $3)', [
      randomUUID(),
      old,
      id,
    ]);
  }
  const links = [
    ...(overrides.provider ? [{ organisationId: overrides.provider, role: 'provider' }] : []),
    ...(overrides.consortia ?? []).map((organisationId) => ({
      organisationId,
      role: 'consortium',
    })),
    ...(overrides.organisations ?? []),
  ];
  for (const link of links) {
    await db.query(
      'insert into svc_service_organisation (id, service_id, organisation_id, role) values ($1, $2, $3, $4)',
      [randomUUID(), id, link.organisationId, link.role],
    );
  }
  for (const [key, value] of Object.entries(overrides.values ?? {})) {
    await db.query(
      'insert into svc_field_value (id, service_id, field_key, value) values ($1, $2, $3, $4::jsonb)',
      [randomUUID(), id, key, JSON.stringify(value)],
    );
  }
  return rows[0]!;
}
