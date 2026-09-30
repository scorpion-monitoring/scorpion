import { describe, expect, it } from 'vitest';
import { compareModules, parseListing } from './check-image-modules.ts';

const known = ['@scorpion/kpi-framework', '@scorpion/kpi-ingestion', '@scorpion/maturity'];

describe('compareModules', () => {
  const cases: [string, string[], string[], { extra: string[]; missing: string[] }][] = [
    [
      'exactly the profile',
      ['@scorpion/kpi-framework'],
      ['@scorpion/kpi-framework'],
      { extra: [], missing: [] },
    ],
    ['no modules, none expected', [], [], { extra: [], missing: [] }],
    [
      'a module outside the profile is present',
      ['@scorpion/kpi-framework', '@scorpion/maturity'],
      ['@scorpion/kpi-framework'],
      { extra: ['@scorpion/maturity'], missing: [] },
    ],
    [
      'a module of the profile is missing',
      ['@scorpion/kpi-framework'],
      ['@scorpion/kpi-framework', '@scorpion/kpi-ingestion'],
      { extra: [], missing: ['@scorpion/kpi-ingestion'] },
    ],
    [
      'both',
      ['@scorpion/maturity'],
      ['@scorpion/kpi-framework'],
      { extra: ['@scorpion/maturity'], missing: ['@scorpion/kpi-framework'] },
    ],
    [
      'packages that are not modules do not count',
      ['@scorpion/kernel', '@scorpion/contracts', '@scorpion/server', '@scorpion/kpi-framework'],
      ['@scorpion/kpi-framework'],
      { extra: [], missing: [] },
    ],
  ];
  it.each(cases)('%s', (_name, found, expected, result) => {
    expect(compareModules(found, known, expected)).toEqual(result);
  });

  it('counts a module once however often it is found', () => {
    expect(compareModules(['@scorpion/maturity', '@scorpion/maturity'], known, [])).toEqual({
      extra: ['@scorpion/maturity'],
      missing: [],
    });
  });
});

describe('parseListing', () => {
  it('reads links from find output and names from grep output', () => {
    const listing = [
      '/app/apps/server/node_modules/@scorpion/kernel',
      '/app/apps/server/node_modules/@scorpion/kpi-framework',
      '/app/node_modules/.pnpm/node_modules/@scorpion/maturity',
      '/app/modules/kpi-framework/package.json:  "name": "@scorpion/kpi-framework",',
      '/app/apps/server/package.json:  "name": "@scorpion/server",',
      '/app/node_modules/.pnpm/zod@4/node_modules/zod/package.json:  "name": "zod",',
      '',
    ].join('\n');
    expect(parseListing(listing)).toEqual([
      '@scorpion/kernel',
      '@scorpion/kpi-framework',
      '@scorpion/maturity',
      '@scorpion/server',
    ]);
  });

  it('finds a module that only exists as a directory, without a link', () => {
    expect(parseListing('/app/modules/x/package.json:  "name": "@scorpion/maturity",')).toEqual([
      '@scorpion/maturity',
    ]);
  });

  it('finds a module that only exists as a hidden link', () => {
    expect(parseListing('/app/node_modules/.pnpm/node_modules/@scorpion/maturity')).toEqual([
      '@scorpion/maturity',
    ]);
  });

  it('is empty for an empty listing', () => {
    expect(parseListing('')).toEqual([]);
  });
});
