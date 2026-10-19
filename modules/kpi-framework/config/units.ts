// The units that `kpi.unit` ships, with the Units Ontology (UO) IRI and the symbol they carry in the RDF read
// (ADR-0040). The vocabulary holds the key and the labels; the IRI and the symbol live here because a
// vocabulary term has no metadata yet (backlog), so an administrator's own unit has neither and is exported
// with an IRI this instance mints.
//
// UO has terms for `count unit`, `percent`, `second` and `byte`. It has none for a request, a user, a
// publication or a citation: each of those is a count of a kind of thing, so it maps to `count unit` and has no
// symbol of its own (checked against uo.owl, 2026-10-14). Do not invent a UO IRI.
export interface UnitSeed {
  /** The key of the vocabulary term: it is also the unit's slug in its minted IRI, so it never changes. */
  key: string;
  labels: { en: string; de: string };
  /** A Units Ontology IRI. */
  iri: string;
  symbol: string | null;
}

const UO = 'http://purl.obolibrary.org/obo/UO_';

export const SEED_UNITS: readonly UnitSeed[] = [
  { key: 'count', labels: { en: 'Count', de: 'Anzahl' }, iri: `${UO}0000189`, symbol: null },
  { key: 'percent', labels: { en: 'Percent', de: 'Prozent' }, iri: `${UO}0000187`, symbol: '%' },
  { key: 'second', labels: { en: 'Second', de: 'Sekunde' }, iri: `${UO}0000010`, symbol: 's' },
  { key: 'byte', labels: { en: 'Byte', de: 'Byte' }, iri: `${UO}0000233`, symbol: 'B' },
  { key: 'request', labels: { en: 'Request', de: 'Anfrage' }, iri: `${UO}0000189`, symbol: null },
  { key: 'user', labels: { en: 'User', de: 'Nutzer' }, iri: `${UO}0000189`, symbol: null },
  {
    key: 'publication',
    labels: { en: 'Publication', de: 'Publikation' },
    iri: `${UO}0000189`,
    symbol: null,
  },
  {
    key: 'citation',
    labels: { en: 'Citation', de: 'Zitation' },
    iri: `${UO}0000189`,
    symbol: null,
  },
];

const BY_KEY = new Map(SEED_UNITS.map((unit) => [unit.key, unit]));

/** The UO IRI and symbol of a seeded unit; `undefined` for a unit an administrator added. */
export function unitMetadata(key: string): Pick<UnitSeed, 'iri' | 'symbol'> | undefined {
  const unit = BY_KEY.get(key);
  return unit && { iri: unit.iri, symbol: unit.symbol };
}
