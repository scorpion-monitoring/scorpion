// The RDF reads of kpi.framework (ADR-0040, M9 sprint 4): `buildRdfModel` is the one query function that reads the tables
// into the in-memory model, `rdf.ts` writes it as Turtle or JSON-LD. The model holds definitions only (indicators, KPI
// sets, units, means and tools); it has no field for a service, a person or a value, so the public pair of reads cannot
// leak one. The token-bearing pair and the public pair serve the same model today and differ in who may ask and in how
// the answer may be cached.
import { createHash } from 'node:crypto';
import type { Actor } from '@scorpion/contracts';
import type { AuthzService } from '@scorpion/core-authz/public';
import type { Db, ModuleContext } from '@scorpion/kernel';
import { sql } from 'drizzle-orm';
import { indicator, indicatorMeans, indicatorTool, kpiSet, kpiSetIndicator } from '../db/schema.ts';
import { iriFor } from './iri.ts';
import { PERMISSION_V1_READ } from './permissions.ts';
import {
  relationOf,
  strongerRelation,
  toJsonLd,
  toTurtle,
  type RdfCategory,
  type RdfIndicator,
  type RdfModel,
  type RdfTerm,
  type RdfUnit,
  type RimoRelation,
} from './rdf.ts';
import { RIMO_ONTOLOGY, rimoCategoryIri, unitRefOf } from './rimo.ts';
import { iriBaseOf } from './shared.ts';

/**
 * The model of the indicators and KPI sets as they are now, read in one snapshot (a read-only repeatable-read
 * transaction, so a concurrent edit never gives a set that names an indicator the list lacks). `base` is the IRI base.
 *
 * A set that maps to a RIMO category becomes that category (the RIMO IRI); a set without a mapping becomes a
 * category this instance mints. Two sets that map to the same RIMO category are one category: an indicator keeps the
 * strongest relation any of them gives it (mandatory over recommended over the rest).
 */
export async function buildRdfModel(db: Db, base: string): Promise<RdfModel> {
  const read = await db.tx(async (tx) => {
    await tx.execute(sql`set transaction isolation level repeatable read read only`);
    return {
      indicators: await tx.select().from(indicator),
      means: await tx.select().from(indicatorMeans),
      tools: await tx.select().from(indicatorTool),
      sets: await tx.select().from(kpiSet),
      rows: await tx.select().from(kpiSetIndicator),
    };
  });

  const categories = new Map<string, RdfCategory>();
  const categoryOfSet = new Map<string, string>();
  for (const set of read.sets) {
    const rimo = set.rimoCategory ? rimoCategoryIri(set.rimoCategory) : null;
    const iri = rimo ?? iriFor('set', set.slug, base);
    categoryOfSet.set(set.id, iri);
    if (!categories.has(iri))
      categories.set(
        iri,
        rimo
          ? { iri, rimo: true, name: null, description: null }
          : { iri, rimo: false, name: set.name, description: set.description },
      );
  }

  const appliedBy = new Map<string, Map<string, RimoRelation>>();
  for (const row of read.rows) {
    const category = categoryOfSet.get(row.setId);
    if (category === undefined) continue;
    const relation = relationOf(row.necessity);
    const own = appliedBy.get(row.indicatorId) ?? new Map<string, RimoRelation>();
    own.set(category, strongerRelation(own.get(category) ?? relation, relation));
    appliedBy.set(row.indicatorId, own);
  }

  const termsOf = (links: readonly { indicatorId: string; termKey: string }[]) => {
    const by = new Map<string, string[]>();
    for (const link of links)
      by.set(link.indicatorId, [...(by.get(link.indicatorId) ?? []), link.termKey]);
    return by;
  };
  const meansOf = termsOf(read.means);
  const toolsOf = termsOf(read.tools);

  const units = new Map<string, RdfUnit>();
  const means = new Map<string, RdfTerm>();
  const tools = new Map<string, RdfTerm>();
  const indicators: RdfIndicator[] = read.indicators.map((row) => {
    if (row.unit !== null && !units.has(row.unit)) {
      const ref = unitRefOf(row.unit, base);
      units.set(row.unit, {
        key: ref.key,
        iri: ref.mintedIri,
        uoIri: ref.uoIri,
        symbol: ref.symbol,
      });
    }
    const measuredBy = meansOf.get(row.id) ?? [];
    const automatedBy = toolsOf.get(row.id) ?? [];
    for (const key of measuredBy)
      if (!means.has(key)) means.set(key, { key, iri: iriFor('means', key, base) });
    for (const key of automatedBy)
      if (!tools.has(key)) tools.set(key, { key, iri: iriFor('tool', key, base) });
    return {
      iri: iriFor('indicator', row.slug, base),
      name: row.name,
      description: row.description,
      example: row.example,
      qualitative: row.qualitative,
      valueType: row.valueType,
      thematic: row.thematic,
      min: row.minValue,
      max: row.maxValue,
      unit: row.unit,
      measuredBy,
      automatedBy,
      applied: [...(appliedBy.get(row.id) ?? [])].map(([category, relation]) => ({
        category,
        relation,
      })),
    };
  });

  return {
    base,
    catalogue: iriFor('catalogue', 'rimo', base),
    ontology: { ...RIMO_ONTOLOGY },
    units: [...units.values()],
    means: [...means.values()],
    tools: [...tools.values()],
    categories: [...categories.values()],
    indicators,
  };
}

/** An RDF document and its strong entity tag (the hash of the bytes), for the conditional GET of the public reads. */
export interface RdfDocument {
  body: string;
  etag: string;
}

export interface RdfService {
  /** The indicators and KPI sets as Turtle. Needs `kpi.framework.v1.read`. */
  turtle(actor: Actor): Promise<RdfDocument>;
  jsonLd(actor: Actor): Promise<RdfDocument>;
  /** The same, for the public routes: no actor, and the model has no value, service or person to hide. */
  publicTurtleAsSystem(): Promise<RdfDocument>;
  publicJsonLdAsSystem(): Promise<RdfDocument>;
}

export interface RdfDeps {
  authz: Pick<AuthzService, 'require'>;
}

const documentOf = (body: string): RdfDocument => ({
  body,
  etag: `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`,
});

export function createRdfService(ctx: ModuleContext, deps: RdfDeps): RdfService {
  const iriBase = iriBaseOf(ctx);
  const model = async () => buildRdfModel(ctx.db, await iriBase());
  return {
    async turtle(actor) {
      await deps.authz.require(actor, PERMISSION_V1_READ);
      return documentOf(toTurtle(await model()));
    },
    async jsonLd(actor) {
      await deps.authz.require(actor, PERMISSION_V1_READ);
      return documentOf(toJsonLd(await model()));
    },
    async publicTurtleAsSystem() {
      return documentOf(toTurtle(await model()));
    },
    async publicJsonLdAsSystem() {
      return documentOf(toJsonLd(await model()));
    },
  };
}
