// The registry rules of the M13 plan §3, table by table: abbreviation, slug (decision 7: derived), stage spellings,
// licence, provider count, consortium by name or by abbreviation.
import { describe, expect, it } from 'vitest';
import { describeDatabase } from './target.ts';
import {
  checkAbbreviation,
  checkName,
  consortiumKind,
  deriveSlug,
  isValidSlug,
  providerCount,
  resolveLicence,
  resolveStage,
  spdxIndex,
  uniqueSlug,
} from './rules.ts';

describe('checkAbbreviation', () => {
  it.each([
    ['BioNet', 'BioNet', false],
    ['  BioNet ', 'BioNet', true],
    ['Bio-Net_2.0', 'Bio-Net_2.0', false],
    ['x'.repeat(64), 'x'.repeat(64), false],
  ])('%j is kept as %j (changed: %s)', (input, value, changed) => {
    expect(checkAbbreviation(input)).toEqual({ ok: true, value, changed });
  });

  it.each([
    ['white space inside', 'Seed Lab'],
    ['a slash', 'Bio/Net'],
    ['over 64', 'x'.repeat(65)],
    ['empty', '   '],
    ['a control character', 'Bio\u0007Net'],
  ])('refuses %s', (_name, input) => {
    expect(checkAbbreviation(input).ok).toBe(false);
  });
});

describe('checkName', () => {
  it.each([
    ['Leaf Database', true],
    ['  Leaf   Database ', true],
    ['', false],
    ['x'.repeat(201), false],
  ])('%j → ok %s', (input, ok) => {
    expect(checkName(input).ok).toBe(ok);
  });
});

describe('slugs (decision 7: derived from the abbreviation, the mapping may override)', () => {
  it.each([
    ['GeneFlow', true],
    ['Leaf.DB_2-x', true],
    ['Root Atlas', false],
    ['-leading', false],
    ['new', false],
    ['01890a5d-ac96-774b-bcce-b302099a8057', false],
    ['x'.repeat(65), false],
  ])('%j is a valid slug: %s', (input, valid) => {
    expect(isValidSlug(input)).toBe(valid);
  });

  it.each([
    ['Root Atlas', 'Root-Atlas'],
    ['Root  /  Atlas', 'Root-Atlas'],
    ['Pflanzen­daten Ü', 'Pflanzen-daten-U'],
    ['  -GeneFlow!', 'GeneFlow'],
    ['Leaf DB.', 'Leaf-DB'],
    ['new', 'new-service'],
    ['Edit', 'Edit-service'],
    ['01890a5d-ac96-774b-bcce-b302099a8057', '01890a5d-ac96-774b-bcce-b302099a8057-service'],
    ['!!!', 'service'],
    ['ä'.repeat(70), 'a'.repeat(64)],
  ])('derives %j → %j', (input, slug) => {
    const derived = deriveSlug(input);
    expect(derived).toBe(slug);
    expect(isValidSlug(derived)).toBe(true);
  });

  it.each([
    ['Root-Atlas', [], 'Root-Atlas'],
    ['Root-Atlas', ['root-atlas'], 'Root-Atlas-2'],
    ['Root-Atlas', ['root-atlas', 'root-atlas-2'], 'Root-Atlas-3'],
    ['x'.repeat(64), ['x'.repeat(64)], `${'x'.repeat(62)}-2`],
  ])('makes %j unique against %j → %j', (slug, taken, unique) => {
    expect(uniqueSlug(slug, new Set(taken))).toBe(unique);
  });
});

describe('resolveStage (ADR-0018: the keys keep the legacy spellings, TERM is a stage)', () => {
  const terms = ['DEV', 'DEMO', 'PROD', 'TERM'];
  const none = { stages: {}, missingStage: null };
  it.each([
    ['PROD', none, { ok: true, key: 'PROD' }],
    ['TERM', none, { ok: true, key: 'TERM' }],
    [' DEV ', none, { ok: true, key: 'DEV' }],
    ['prod', none, { ok: true, key: 'PROD', rule: 'stage.respelled' }],
    ['Production', none, { ok: false, rule: 'stage.unknown' }],
    [
      'Production',
      { stages: { Production: 'PROD' }, missingStage: null },
      { ok: true, key: 'PROD', rule: 'stage.mapped' },
    ],
    [
      'Production',
      { stages: { Production: null }, missingStage: null },
      { ok: false, rule: 'stage.unknown' },
    ],
    [
      'Production',
      { stages: { Production: 'LIVE' }, missingStage: null },
      { ok: false, rule: 'stage.unknown' },
    ],
    [null, none, { ok: false, rule: 'stage.missing' }],
    ['', none, { ok: false, rule: 'stage.missing' }],
    [
      null,
      { stages: {}, missingStage: 'DEV' },
      { ok: true, key: 'DEV', rule: 'stage.missing-mapped' },
    ],
  ] as const)('%j with %j → %j', (spelling, mapping, result) => {
    expect(resolveStage(spelling, terms, mapping)).toEqual(result);
  });

  it('takes the terms as data: a deployment with other stage keys', () => {
    expect(resolveStage('beta', ['ALPHA', 'BETA'], { stages: {}, missingStage: null })).toEqual({
      ok: true,
      key: 'BETA',
      rule: 'stage.respelled',
    });
  });
});

describe('resolveLicence', () => {
  const index = spdxIndex(['MIT', 'Apache-2.0', 'GPL-3.0-only']);
  const none = { licences: {} };
  it.each([
    [null, none, { license: null }],
    ['  ', none, { license: null }],
    ['MIT', none, { license: 'MIT' }],
    ['apache-2.0', none, { license: 'Apache-2.0', rule: 'licence.respelled' }],
    ['Proprietary', none, { license: null, rule: 'licence.not-spdx' }],
    [
      'GPLv3',
      { licences: { GPLv3: 'GPL-3.0-only' } },
      { license: 'GPL-3.0-only', rule: 'licence.mapped' },
    ],
    ['GPLv3', { licences: { GPLv3: null } }, { license: null, rule: 'licence.not-spdx' }],
    ['GPLv3', { licences: { GPLv3: 'GPL-3' } }, { license: null, rule: 'licence.not-spdx' }],
  ] as const)('%j with %j → %j', (spelling, mapping, result) => {
    expect(resolveLicence(spelling, mapping, index)).toEqual(result);
  });

  it('knows the ids of the bundled SPDX list by default', () => {
    expect(spdxIndex().get('mit')).toBe('MIT');
  });
});

describe('providerCount (the new model needs exactly one provider)', () => {
  it.each([
    [[{ provider: 'BioNet' }], { ok: true, provider: 'BioNet' }],
    [[{ provider: 'BioNet' }, { provider: 'BioNet' }], { ok: true, provider: 'BioNet' }],
    [
      [{ provider: 'BioNet' }, { provider: 'PlantData' }],
      { ok: false, rule: 'service.two-providers', providers: ['BioNet', 'PlantData'] },
    ],
    [[{ provider: null }], { ok: false, rule: 'service.no-provider', providers: [] }],
    [[{ provider: ' ' }], { ok: false, rule: 'service.no-provider', providers: [] }],
  ])('%j → %j', (rows, result) => {
    expect(providerCount(rows)).toEqual(result);
  });
});

describe('consortiumKind (the API gives the consortium name)', () => {
  it.each([
    ['IMC', 'abbreviation'],
    ['Imaginary-Consortium', 'abbreviation'],
    ['Imaginary Consortium', 'name'],
    [' IMC', 'name'],
    ['A/B', 'name'],
  ])('%j is given by %s', (name, kind) => {
    expect(consortiumKind(name)).toBe(kind);
  });
});

describe('describeDatabase (what the operator is shown of DATABASE_URL)', () => {
  it.each([
    ['postgres://scorpion:secret@localhost:5432/scorpion', 'localhost:5432/scorpion'],
    ['postgres://u:p@db.example.org/prod', 'db.example.org/prod'],
    ['not a url', '(DATABASE_URL is not a URL)'],
  ])('%s → %s, never the credentials', (url, shown) => {
    expect(describeDatabase(url)).toBe(shown);
    expect(describeDatabase(url)).not.toMatch(/secret|:p@/);
  });
});
