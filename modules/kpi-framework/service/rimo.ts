// What the API reads and the RDF export share about RIMO: the IRI of a seeded service category and the IRIs of a unit.
// Written once (the v1 reads and `rdf-model.ts` both call it).
import seed from '../config/rimo-seed.json' with { type: 'json' };
import { unitMetadata } from '../config/units.ts';
import { iriFor } from './iri.ts';

const RIMO_IRI = new Map(seed.categories.map((category) => [category.key, category.iri]));

/** The ontology the seed was taken from: its IRI and version, which the RDF reads name. */
export const RIMO_ONTOLOGY = { iri: seed.ontology.iri, version: seed.ontology.version } as const;

/** The `w3id.org/RIMO#` IRI of a seeded service category, or `null` for a key the seed does not know. */
export const rimoCategoryIri = (key: string): string | null => RIMO_IRI.get(key) ?? null;

export interface UnitRef {
  key: string;
  symbol: string | null;
  /** The Units Ontology IRI of a seeded unit, else `null`. */
  uoIri: string | null;
  /** The IRI this instance mints for the unit. */
  mintedIri: string;
}

export function unitRefOf(key: string, base: string): UnitRef {
  const meta = unitMetadata(key);
  return {
    key,
    symbol: meta?.symbol ?? null,
    uoIri: meta?.iri ?? null,
    mintedIri: iriFor('unit', key, base),
  };
}
