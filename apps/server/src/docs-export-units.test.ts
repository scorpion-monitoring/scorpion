import { describe, expect, it } from 'vitest';
import { flagsOf, usageLines } from './commands.ts';
import { parsePlannedProfiles } from './docs-export/collect.ts';
import { byString, sortKeys, stableJson } from './docs-export/json.ts';

describe('stableJson', () => {
  it('sorts keys at every depth, keeps the order of arrays, drops undefined and ends with a newline', () => {
    expect(stableJson({ b: 1, a: { d: [3, { z: 1, y: undefined, x: 2 }], c: null } })).toBe(
      '{\n  "a": {\n    "c": null,\n    "d": [\n      3,\n      {\n        "x": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n',
    );
  });

  it('gives the same text for the same data in another key order', () => {
    expect(stableJson({ a: 1, b: { c: 2, d: 3 } })).toBe(stableJson({ b: { d: 3, c: 2 }, a: 1 }));
    expect(sortKeys([{ b: 1, a: 2 }])).toEqual([{ a: 2, b: 1 }]);
  });

  it.each([
    ['a', 'b', -1],
    ['b', 'a', 1],
    ['a', 'a', 0],
    ['Z', 'a', -1],
  ])('compares %s with %s by code unit', (a, b, expected) => {
    expect(byString(a, b)).toBe(expected);
  });
});

describe('flagsOf', () => {
  it.each([
    ['start', []],
    [
      'create-admin --username <name> --email <address>',
      [
        ['--username', 'name', true],
        ['--email', 'address', true],
      ],
    ],
    [
      'profile:generate <name> [--check] [--profile-file <path>] [--modules-root <dir>]...',
      [
        ['--check', null, false],
        ['--profile-file', 'path', false],
        ['--modules-root', 'dir', false],
      ],
    ],
    [
      'seed --demo [--profile <name>] [--allow-production]',
      [
        ['--demo', null, true],
        ['--profile', 'name', false],
        ['--allow-production', null, false],
      ],
    ],
  ])('reads the flags of %s', (usage, expected) => {
    expect(flagsOf(usage).map((flag) => [flag.name, flag.value, flag.required])).toEqual(expected);
  });
});

describe('usageLines', () => {
  it('puts a short command and its description on one line, and a long one on two', () => {
    expect(usageLines({ usage: 'start', description: 'Run it.' })).toBe(
      `  start${' '.repeat(21)} Run it.`,
    );
    const long = usageLines({
      usage: 'profile:generate <name> [--check]',
      description: 'Write it.\nSecond line.',
    });
    expect(long.split('\n')).toEqual([
      '  profile:generate <name> [--check]',
      `  ${' '.repeat(26)} Write it.`,
      `  ${' '.repeat(26)} Second line.`,
    ]);
  });
});

describe('parsePlannedProfiles', () => {
  const table = [
    '| Module | `full` | `registry` | `nfdi-onboarding` | `kpi-tracker` |',
    '| --- | --- | --- | --- | --- |',
    '| Core (all seven) | ● | ● | ● | ● |',
    '| registry.services | ● | ● | ● | ● |',
    '| kpi.framework, kpi.analytics | ● |  | ○ | ● |',
    '| network-graph | ● |  |  |  |',
    '',
    'Text after the table.',
  ].join('\n');

  it('takes the columns that have no profile file, with the core modules, lists and the marks', () => {
    const planned = parsePlannedProfiles(
      table,
      ['core-only', 'full', 'registry'],
      ['core.authz', 'core.identity'],
    );
    expect(planned.map((profile) => profile.name)).toEqual(['kpi-tracker', 'nfdi-onboarding']);
    const nfdi = planned.find((profile) => profile.name === 'nfdi-onboarding')!;
    expect(nfdi.modules).toEqual([
      { id: 'core.authz', inclusion: 'included' },
      { id: 'core.identity', inclusion: 'included' },
      { id: 'registry.services', inclusion: 'included' },
      { id: 'kpi.framework', inclusion: 'optional' },
      { id: 'kpi.analytics', inclusion: 'optional' },
    ]);
    expect(
      planned.find((profile) => profile.name === 'kpi-tracker')!.modules.map((m) => m.id),
    ).not.toContain('network-graph');
  });

  it('gives nothing for a document without the matrix, and nothing for a column that has a file', () => {
    expect(parsePlannedProfiles('# nothing here', [], [])).toEqual([]);
    expect(
      parsePlannedProfiles(
        table,
        ['core-only', 'full', 'registry', 'nfdi-onboarding', 'kpi-tracker'],
        [],
      ),
    ).toEqual([]);
  });
});
