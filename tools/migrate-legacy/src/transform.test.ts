// The registry transform: which rule decides each record, over a made-up snapshot shaped like the maintainer's
// discovery (empty stage and licence, a provider abbreviation with a space, consortia given by name).
import { describe, expect, it } from 'vitest';
import { service } from '../test/snapshot-factory.ts';
import { emptyMapping, mappingSchema, MAPPING_FORMAT, type Mapping } from './mapping.ts';
import { spdxIndex } from './rules.ts';
import { transformRegistry, type Finding } from './transform.ts';

const facts = {
  stageTerms: ['DEV', 'DEMO', 'PROD', 'TERM'],
  spdx: spdxIndex(['MIT', 'Apache-2.0']),
};
const mapping = (m: Partial<Mapping> = {}) => mappingSchema.parse({ format: MAPPING_FORMAT, ...m });

const providers = [
  { abbreviation: 'BioNet', name: 'BioNet Services' },
  { abbreviation: 'PlantData', name: 'PlantData Centre' },
  { abbreviation: 'Seed Lab', name: 'Seed Laboratory' },
];

const rulesOf = (findings: Finding[], legacy: string) =>
  findings.filter((f) => f.legacy === legacy).map((f) => `${f.effect}:${f.rule}`);

describe('transformRegistry: providers', () => {
  it.each([
    ['a valid abbreviation is kept', 'BioNet', {}, []],
    [
      'white space inside is refused and leaves a gap',
      'Seed Lab',
      {},
      ['dropped:provider.abbreviation-invalid'],
    ],
    [
      'the mapping renames it',
      'Seed Lab',
      { providers: { 'Seed Lab': { abbreviation: 'SeedLab' } } },
      ['adjusted:provider.abbreviation-mapped'],
    ],
    [
      'an open gap drops it',
      'Seed Lab',
      { providers: { 'Seed Lab': { abbreviation: null } } },
      ['dropped:provider.abbreviation-open'],
    ],
    [
      'a mapped abbreviation that breaks the rule',
      'Seed Lab',
      { providers: { 'Seed Lab': { abbreviation: 'Seed/Lab' } } },
      ['dropped:provider.abbreviation-invalid'],
    ],
    [
      'the mapping drops it',
      'BioNet',
      { providers: { BioNet: { drop: true } } },
      ['dropped:provider.dropped-by-mapping'],
    ],
    [
      'a renamed one that collides without case',
      'Seed Lab',
      { providers: { 'Seed Lab': { abbreviation: 'bionet' } } },
      ['adjusted:provider.abbreviation-mapped', 'dropped:provider.abbreviation-duplicate'],
    ],
  ] as const)('%s', (_name, legacy, m, rules) => {
    const plan = transformRegistry({ providers, services: [] }, mapping(m), facts);
    expect(rulesOf(plan.findings, legacy)).toEqual(rules);
  });

  it('refuses a second provider with the same name (case is ignored)', () => {
    const plan = transformRegistry(
      { providers: [...providers, { abbreviation: 'BN', name: 'bionet services' }], services: [] },
      emptyMapping(),
      facts,
    );
    expect(rulesOf(plan.findings, 'BioNet')).toEqual(['dropped:provider.name-duplicate']);
    expect(plan.providers.map((p) => p.legacy)).toEqual(['BN', 'PlantData']);
  });
});

describe('transformRegistry: consortia (the API gives names)', () => {
  const services = [service('GeneFlow', { consortia: ['Imaginary Consortium', 'PLX'] })];
  it.each([
    [
      'a name needs an abbreviation from the mapping',
      {},
      'Imaginary Consortium',
      ['dropped:consortium.abbreviation-open'],
    ],
    [
      'the mapping gives it',
      { consortia: { 'Imaginary Consortium': { abbreviation: 'IMC' } } },
      'Imaginary Consortium',
      ['adjusted:consortium.abbreviation-mapped'],
    ],
    ['a name that is a valid abbreviation is kept', {}, 'PLX', []],
  ] as const)('%s', (_name, m, legacy, rules) => {
    const plan = transformRegistry({ providers, services }, mapping(m), facts);
    expect(rulesOf(plan.findings, legacy)).toEqual(rules);
  });

  it('keeps the name, and drops the link of a service to a consortium that is not migrated', () => {
    const plan = transformRegistry(
      { providers, services },
      mapping({ missingStage: 'PROD' }),
      facts,
    );
    expect(plan.consortia).toEqual([
      { kind: 'consortium', legacy: 'PLX', abbreviation: 'PLX', name: 'PLX' },
    ]);
    expect(plan.services[0]!.consortia).toEqual(['PLX']);
    expect(rulesOf(plan.findings, 'GeneFlow')).toContain(
      'adjusted:service.consortium-link-dropped',
    );
  });
});

describe('transformRegistry: services', () => {
  const run = (rows: ReturnType<typeof service>[], m: Partial<Mapping> = {}) =>
    transformRegistry(
      { providers, services: rows },
      mapping({ missingStage: 'PROD', ...m }),
      facts,
    );

  it.each([
    ['all valid', service('GeneFlow'), []],
    [
      'no stage → missingStage (decision 14)',
      service('GeneFlow', { stage: '' }),
      ['adjusted:service.stage.missing-mapped'],
    ],
    [
      'a stage in another case',
      service('GeneFlow', { stage: 'prod' }),
      ['adjusted:service.stage.respelled'],
    ],
    ['an unknown stage', service('GeneFlow', { stage: 'Live' }), ['dropped:service.stage.unknown']],
    ['no licence stays none', service('GeneFlow', { license: '' }), []],
    [
      'a licence in another case',
      service('GeneFlow', { license: 'apache-2.0' }),
      ['adjusted:service.licence.respelled'],
    ],
    [
      'a licence that is not an SPDX id is left empty',
      service('GeneFlow', { license: 'Proprietary' }),
      ['adjusted:service.licence.not-spdx'],
    ],
    [
      'an abbreviation that is no slug (decision 7: derived)',
      service('Root Atlas'),
      ['adjusted:service.slug-derived'],
    ],
    ['no provider', service('GeneFlow', { provider: null }), ['dropped:service.no-provider']],
    [
      'a provider that is not migrated',
      service('GeneFlow', { provider: 'Seed Lab' }),
      ['dropped:service.provider-dropped'],
    ],
    [
      'a provider not in the list',
      service('GeneFlow', { provider: 'Elsewhere' }),
      ['dropped:service.provider-unknown'],
    ],
    [
      'a name the rule refuses',
      service('GeneFlow', { name: '' }),
      ['dropped:service.name-invalid'],
    ],
  ] as const)('%s', (_name, row, rules) => {
    expect(rulesOf(run([row]).findings, row.abbreviation)).toEqual(rules);
  });

  it('drops a service with two providers (two rows)', () => {
    const plan = run([service('Twin'), service('Twin', { provider: 'PlantData' })]);
    expect(rulesOf(plan.findings, 'Twin')).toEqual(['dropped:service.two-providers']);
    expect(plan.services).toEqual([]);
  });

  it('drops a service without stage when the mapping has no missingStage', () => {
    const plan = transformRegistry(
      { providers, services: [service('GeneFlow', { stage: '' })] },
      emptyMapping(),
      facts,
    );
    expect(plan.findings.filter((f) => f.kind === 'service')).toEqual([
      expect.objectContaining({
        rule: 'service.stage.missing',
        effect: 'dropped',
        gap: 'missingStage',
      }),
    ]);
  });

  it('takes the mapping before the rules: a slug, a stage, a licence, a drop', () => {
    const plan = run(
      [service('Root Atlas', { license: 'GPLv3', stage: '' }), service('GeneFlow')],
      {
        services: { 'Root Atlas': { slug: 'root-atlas', stage: 'DEV' }, GeneFlow: { drop: true } },
        licences: { GPLv3: 'MIT' },
      },
    );
    expect(plan.services).toEqual([
      expect.objectContaining({
        legacy: 'Root Atlas',
        slug: 'root-atlas',
        stage: 'DEV',
        license: 'MIT',
      }),
    ]);
    expect(rulesOf(plan.findings, 'GeneFlow')).toEqual(['dropped:service.dropped-by-mapping']);
  });

  it('keeps valid slugs first and makes derived ones unique against them', () => {
    const plan = run([service('Root Atlas'), service('Root-Atlas'), service('root atlas')]);
    expect(plan.services.map((s) => [s.legacy, s.slug])).toEqual([
      ['Root Atlas', 'Root-Atlas-2'],
      ['Root-Atlas', 'Root-Atlas'],
      ['root atlas', 'root-atlas-3'],
    ]);
  });

  it('counts what it read, and gives the same plan for the same input', () => {
    const rows = [
      service('B'),
      service('A'),
      service('Twin'),
      service('Twin', { provider: 'PlantData' }),
    ];
    const plan = run(rows);
    expect(plan.read).toEqual({ provider: 3, consortium: 0, service: 3 });
    expect(run([...rows].reverse())).toEqual(plan);
  });
});

describe('transformRegistry: decision 15, the legacy workaround for consortia', () => {
  const legacy = {
    providers: [
      { abbreviation: 'BioNet', name: 'BioNet Services' },
      { abbreviation: 'GreenHub', name: 'Green Hub Consortium' },
    ],
    services: [
      service('GeneFlow', { consortia: ['Green Hub Consortium'] }),
      service('GreenHub', { provider: 'GreenHub' }),
    ],
  };

  it('migrates a provider marked as a consortium as one, merged with the consortium of its name', () => {
    const plan = transformRegistry(
      legacy,
      mapping({ missingStage: 'PROD', providers: { GreenHub: { type: 'consortium' } } }),
      facts,
    );
    expect(plan.providers.map((p) => p.abbreviation)).toEqual(['BioNet']);
    expect(plan.consortia).toEqual([
      {
        kind: 'consortium',
        legacy: 'GreenHub',
        abbreviation: 'GreenHub',
        name: 'Green Hub Consortium',
      },
    ]);
    expect(plan.services.find((s) => s.legacy === 'GeneFlow')!.consortia).toEqual(['GreenHub']);
    expect(rulesOf(plan.findings, 'GreenHub')).toEqual([
      'adjusted:provider.migrated-as-consortium',
      'dropped:service.provider-is-consortium',
    ]);
    expect(rulesOf(plan.findings, 'Green Hub Consortium')).toEqual([
      'adjusted:consortium.abbreviation-from-provider',
      'merged:consortium.merged',
    ]);
    expect(plan.read).toEqual({ provider: 1, consortium: 2, service: 2 });
  });

  it('merges only the same organisation: the same abbreviation with another name is a duplicate', () => {
    const plan = transformRegistry(
      legacy,
      mapping({
        missingStage: 'PROD',
        providers: { GreenHub: { type: 'consortium', name: 'Another Name' } },
      }),
      facts,
    );
    expect(rulesOf(plan.findings, 'Green Hub Consortium')).toContain(
      'dropped:consortium.abbreviation-duplicate',
    );
  });

  it('without the mapping, the workaround stays as it was: a provider with its service', () => {
    const plan = transformRegistry(legacy, mapping({ missingStage: 'PROD' }), facts);
    expect(plan.providers.map((p) => p.abbreviation)).toEqual(['BioNet', 'GreenHub']);
    expect(plan.services.map((s) => s.slug)).toEqual(['GeneFlow', 'GreenHub']);
  });
});
