import { describe, expect, it } from 'vitest';
import { logoSources, type LogoSettings } from './lib/logos.ts';

const BUILT_IN = { light: '/_app/scorpion-light.png', dark: '/_app/scorpion.dark.png' };
const file = (hash: string) => `/api/internal/files/${hash}`;

describe('logoSources', () => {
  const cases: [string, LogoSettings, { light: string; dark: string; custom: boolean }][] = [
    [
      'no upload: both built-in logos',
      { light: null, dark: null },
      { light: BUILT_IN.light, dark: BUILT_IN.dark, custom: false },
    ],
    [
      'a light upload: it is used for both themes, the built-in dark one is not mixed in',
      { light: 'a'.repeat(64), dark: null },
      { light: file('a'.repeat(64)), dark: file('a'.repeat(64)), custom: true },
    ],
    [
      'both uploaded: each theme its own',
      { light: 'a'.repeat(64), dark: 'b'.repeat(64) },
      { light: file('a'.repeat(64)), dark: file('b'.repeat(64)), custom: true },
    ],
    [
      'a dark upload only: the light theme keeps the built-in light logo',
      { light: null, dark: 'b'.repeat(64) },
      { light: BUILT_IN.light, dark: file('b'.repeat(64)), custom: true },
    ],
  ];
  it.each(cases)('%s', (_name, logos, expected) => {
    expect(logoSources(logos, BUILT_IN, file)).toEqual(expected);
  });
});
