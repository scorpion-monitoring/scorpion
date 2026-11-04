// The pure counting of the tiles, table-driven: zero services, one, a deactivated stage, an unknown stage, no licence, an unknown licence, a
// deprecated OSI licence (not open source, decision 19) and the published filter on and off.
import { describe, expect, it } from 'vitest';
import { countTiles, type LicenceFact, type StageTerm, type TileRow } from './tiles.ts';

const terms: StageTerm[] = [
  { key: 'a', label: 'Alpha', active: true },
  { key: 'b', label: 'Beta', active: true },
  { key: 'c', label: 'Gamma (retired)', active: false },
];
const licences: Record<string, LicenceFact> = {
  osi: { osiApproved: true, deprecated: false },
  'osi-old': { osiApproved: true, deprecated: true },
  free: { osiApproved: false, deprecated: false },
  'free-old': { osiApproved: false, deprecated: true },
};
const row = (stage: string, license: string | null, published = true): TileRow => ({
  stage,
  license,
  published,
});
const count = (rows: TileRow[], includeUnpublished = false, list = terms) =>
  countTiles({ rows, terms: list, licences, includeUnpublished });

describe('countTiles', () => {
  it('lists every term at zero for no services', () => {
    const tiles = count([]);
    expect(tiles).toMatchObject({
      total: 0,
      openSource: 0,
      licenceDeprecated: 0,
      licenceUnknown: 0,
      otherLicence: 0,
      otherStages: [],
    });
    expect(tiles.stages).toEqual(terms.map((term) => ({ ...term, count: 0 })));
  });

  it('lists nothing but the others for a vocabulary with no term', () => {
    const tiles = count([row('a', 'osi')], false, []);
    expect(tiles.stages).toEqual([]);
    expect(tiles.otherStages).toEqual([{ key: 'a', count: 1 }]);
  });

  const licenceRows: [string, string | null, Partial<Record<string, number>>][] = [
    ['an OSI-approved id is open source', 'osi', { openSource: 1 }],
    ['the id is matched without case', 'OSI', { openSource: 1 }],
    ['the id is trimmed', ' osi ', { openSource: 1 }],
    ['a deprecated OSI id is not open source', 'osi-old', { licenceDeprecated: 1 }],
    ['a deprecated id that is not OSI is deprecated', 'free-old', { licenceDeprecated: 1 }],
    ['a current non-OSI id is another licence', 'free', { otherLicence: 1 }],
    ['an id the list does not know is unknown', 'nope', { licenceUnknown: 1 }],
    ['no licence is unknown', null, { licenceUnknown: 1 }],
  ];
  it.each(licenceRows)('%s', (_name, license, expected) => {
    const tiles = count([row('a', license)]);
    expect({
      openSource: tiles.openSource,
      licenceDeprecated: tiles.licenceDeprecated,
      licenceUnknown: tiles.licenceUnknown,
      otherLicence: tiles.otherLicence,
    }).toEqual({
      openSource: 0,
      licenceDeprecated: 0,
      licenceUnknown: 0,
      otherLicence: 0,
      ...expected,
    });
    expect(tiles.total).toBe(1);
  });

  it('adds up: the total is the sum of the four licence counts and of the stage lines and others', () => {
    const rows = [
      row('a', 'osi'),
      row('b', 'osi-old'),
      row('c', 'free'),
      row('zzz', null),
      row('yyy', 'nope'),
      row('a', 'free-old'),
    ];
    const tiles = count(rows);
    expect(tiles.total).toBe(6);
    expect(
      tiles.openSource + tiles.licenceDeprecated + tiles.licenceUnknown + tiles.otherLicence,
    ).toBe(6);
    const staged =
      tiles.stages.reduce((sum, line) => sum + line.count, 0) +
      tiles.otherStages.reduce((sum, line) => sum + line.count, 0);
    expect(staged).toBe(6);
  });

  it('counts a deactivated term under its own line with its label', () => {
    const tiles = count([row('c', null), row('c', null)]);
    expect(tiles.stages.find((line) => line.key === 'c')).toEqual({
      key: 'c',
      label: 'Gamma (retired)',
      active: false,
      count: 2,
    });
  });

  it('puts a key the vocabulary does not list into otherStages by key, never dropped, sorted', () => {
    const tiles = count([row('zed', null), row('Q', null), row('zed', null), row('a', null)]);
    expect(tiles.otherStages).toEqual([
      { key: 'Q', count: 1 },
      { key: 'zed', count: 2 },
    ]);
    expect(tiles.stages.map((line) => line.count)).toEqual([1, 0, 0]);
  });

  it('keeps the vocabulary order of the lines', () => {
    const reversed = [...terms].reverse();
    expect(count([], false, reversed).stages.map((line) => line.key)).toEqual(['c', 'b', 'a']);
  });

  const published: [string, boolean, number][] = [
    ['counts only the published services by default', false, 2],
    ['counts every service with includeUnpublished', true, 3],
  ];
  it.each(published)('%s', (_name, includeUnpublished, total) => {
    const rows = [row('a', 'osi'), row('b', 'osi', false), row('a', 'free')];
    const tiles = count(rows, includeUnpublished);
    expect(tiles.total).toBe(total);
    expect(tiles.stages.reduce((sum, line) => sum + line.count, 0)).toBe(total);
    expect(tiles.stages.find((line) => line.key === 'b')?.count).toBe(includeUnpublished ? 1 : 0);
  });

  it('does not change its input', () => {
    const rows = [row('a', 'osi')];
    const before = JSON.stringify({ rows, terms });
    count(rows);
    expect(JSON.stringify({ rows, terms })).toBe(before);
  });
});
