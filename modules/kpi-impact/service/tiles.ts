// The tiles of a consortium: pure counting over the rows of its services, the terms of the vocabulary `stage` and the SPDX facts of the
// licences. No stage key and no licence id is written here: every stage line comes from the vocabulary (defect 9), every licence verdict from
// the list (decision 19 of the M12 plan).

/** The vocabulary the stage of a service is a term of. It names the vocabulary, not a stage. */
export const STAGE_VOCABULARY = 'stage';

/** What the tiles need of a service. */
export interface TileRow {
  stage: string;
  license: string | null;
  published: boolean;
}

/** A term of the vocabulary, as `core.settings` lists it (the label is already in the caller's language). */
export interface StageTerm {
  key: string;
  label: string;
  active: boolean;
}

/** What the SPDX list says of a licence id. */
export interface LicenceFact {
  osiApproved: boolean;
  deprecated: boolean;
}

export interface StageLine extends StageTerm {
  count: number;
}

export interface Tiles {
  /** The services counted: every one of the consortium, or only the published ones. */
  total: number;
  /** An OSI-approved licence that is not deprecated. */
  openSource: number;
  /** A deprecated licence id, OSI-approved or not: not open source. */
  licenceDeprecated: number;
  /** No licence, or an id the SPDX list does not know: not open source. */
  licenceUnknown: number;
  /** A current licence that is not OSI-approved. `total` is the sum of the four. */
  otherLicence: number;
  /** One line per term of the vocabulary, deactivated ones included, in the vocabulary's order, zero counts too. */
  stages: StageLine[];
  /** A stage key some service holds and the vocabulary does not list: shown by its key, by key. */
  otherStages: { key: string; count: number }[];
}

export interface TileInput {
  rows: readonly TileRow[];
  terms: readonly StageTerm[];
  /** The facts by licence id **lower-cased**; an id that is missing is unknown. */
  licences: Readonly<Record<string, LicenceFact>>;
  /** Count the unpublished services too (decision 16). */
  includeUnpublished: boolean;
}

export function countTiles({ rows, terms, licences, includeUnpublished }: TileInput): Tiles {
  const counted = includeUnpublished ? rows : rows.filter((row) => row.published);
  const tiles: Tiles = {
    total: counted.length,
    openSource: 0,
    licenceDeprecated: 0,
    licenceUnknown: 0,
    otherLicence: 0,
    stages: terms.map((term) => ({ ...term, count: 0 })),
    otherStages: [],
  };
  const lines = new Map(tiles.stages.map((line) => [line.key, line]));
  const others = new Map<string, number>();
  for (const row of counted) {
    const fact = row.license === null ? undefined : licences[row.license.trim().toLowerCase()];
    if (!fact) tiles.licenceUnknown++;
    else if (fact.deprecated) tiles.licenceDeprecated++;
    else if (fact.osiApproved) tiles.openSource++;
    else tiles.otherLicence++;
    const line = lines.get(row.stage);
    if (line) line.count++;
    else others.set(row.stage, (others.get(row.stage) ?? 0) + 1);
  }
  tiles.otherStages = [...others]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return tiles;
}
