import { describe, expect, it } from 'vitest';
import {
  computeModuleDependencies,
  packageNameForModule,
  type PackageDeps,
} from './package-deps.ts';

const modulePackages = new Set([
  '@scorpion/kpi-framework',
  '@scorpion/kpi-impact',
  '@scorpion/registry-services',
]);
const isModule = (name: string) => modulePackages.has(name);

describe('computeModuleDependencies', () => {
  const cases: [string, PackageDeps, { required: string[]; optional: string[] }][] = [
    ['no dependencies', {}, { required: [], optional: [] }],
    [
      'module packages in dependencies are required',
      {
        dependencies: {
          '@scorpion/registry-services': 'workspace:*',
          '@scorpion/kpi-framework': 'workspace:*',
        },
      },
      { required: ['@scorpion/kpi-framework', '@scorpion/registry-services'], optional: [] },
    ],
    [
      'other packages are ignored, also @scorpion ones that are not modules',
      {
        dependencies: {
          zod: '^4',
          '@scorpion/kernel': 'workspace:*',
          '@scorpion/contracts': 'workspace:*',
        },
      },
      { required: [], optional: [] },
    ],
    [
      'optional peer dependencies are optional',
      {
        peerDependencies: { '@scorpion/kpi-impact': 'workspace:*' },
        peerDependenciesMeta: { '@scorpion/kpi-impact': { optional: true } },
      },
      { required: [], optional: ['@scorpion/kpi-impact'] },
    ],
    [
      'a peer dependency not marked optional is not a module dependency',
      { peerDependencies: { '@scorpion/kpi-impact': 'workspace:*' } },
      { required: [], optional: [] },
    ],
    [
      'peerDependenciesMeta without a peer entry declares nothing',
      { peerDependenciesMeta: { '@scorpion/kpi-impact': { optional: true } } },
      { required: [], optional: [] },
    ],
    [
      'a package in both lists is required',
      {
        dependencies: { '@scorpion/kpi-impact': 'workspace:*' },
        peerDependencies: { '@scorpion/kpi-impact': 'workspace:*' },
        peerDependenciesMeta: { '@scorpion/kpi-impact': { optional: true } },
      },
      { required: ['@scorpion/kpi-impact'], optional: [] },
    ],
  ];

  it.each(cases)('%s', (_name, pkg, expected) => {
    expect(computeModuleDependencies(pkg, isModule)).toEqual(expected);
  });

  it('does not read devDependencies', () => {
    const pkg = { devDependencies: { '@scorpion/kpi-impact': 'workspace:*' } } as PackageDeps;
    expect(computeModuleDependencies(pkg, isModule)).toEqual({ required: [], optional: [] });
  });
});

describe('packageNameForModule', () => {
  it.each([
    ['kpi.ingestion', '@scorpion/kpi-ingestion'],
    ['core.ui-shell', '@scorpion/core-ui-shell'],
    ['maturity', '@scorpion/maturity'],
  ])('%s → %s', (id, name) => {
    expect(packageNameForModule(id)).toBe(name);
  });
});
