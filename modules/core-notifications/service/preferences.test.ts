// The preference rules, pure: which channels a person wants for a template, the shape of the stored
// value, and the category list built from the templates.
import { describe, expect, it } from 'vitest';
import { categoriesOf, preferencesSchema, resolveChannels } from './preferences.ts';

const normal = { category: 'account', mandatory: false };
const mandatory = { category: 'security', mandatory: true };

describe('resolveChannels', () => {
  const cases: [string, { category: string; mandatory: boolean }, unknown, boolean, boolean][] = [
    ['nothing stored: both on', normal, undefined, true, true],
    ['null stored: both on', normal, null, true, true],
    ['an empty object: both on', normal, {}, true, true],
    ['email off', normal, { account: { email: false } }, false, true],
    ['in-app off', normal, { account: { inApp: false } }, true, false],
    ['both off', normal, { account: { email: false, inApp: false } }, false, false],
    ['explicitly on', normal, { account: { email: true, inApp: true } }, true, true],
    ['another category off: no effect', normal, { reminders: { email: false } }, true, true],
    [
      'a stored value of the wrong shape: treated as not set',
      normal,
      { account: 'off' },
      true,
      true,
    ],
    ['a stored value that is not an object: treated as not set', normal, 'nope', true, true],
    [
      'a mandatory template ignores email off',
      mandatory,
      { security: { email: false } },
      true,
      true,
    ],
    [
      'a mandatory template ignores both off',
      mandatory,
      { security: { email: false, inApp: false } },
      true,
      true,
    ],
  ];
  it.each(cases)('%s', (_name, template, stored, email, inApp) => {
    expect(resolveChannels(template, stored)).toEqual({ email, inApp });
  });
});

describe('preferencesSchema', () => {
  it.each([
    [{}, true],
    [{ account: { email: false } }, true],
    [{ 'a-b1': { inApp: true, email: true } }, true],
    [{ Account: { email: false } }, false], // upper case
    [{ account: { sms: true } }, false], // unknown channel
    [{ account: { email: 'no' } }, false],
    [{ account: null }, false],
    ['nope', false],
    [Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`c${i}`, {}])), false],
  ])('%j → %s', (value, valid) => {
    expect(preferencesSchema.safeParse(value).success).toBe(valid);
  });

  it('accepts a category no template has today, so a profile change never resets a person’s choices', () => {
    expect(preferencesSchema.safeParse({ 'removed-module': { email: false } }).success).toBe(true);
  });
});

describe('categoriesOf', () => {
  const t = (key: string, category: string, mandatory: boolean, en?: string) => ({
    key,
    category,
    mandatory,
    categoryDescription: en ? { en, de: `${en} (de)` } : undefined,
  });
  it('groups templates by category, sorted, with the first description and mandatory only when all are', () => {
    expect(
      categoriesOf([
        t('x.b', 'security', true, 'Sec'),
        t('x.c', 'account', false),
        t('x.a', 'account', false, 'Acc'),
        t('x.d', 'mixed', true),
        t('x.e', 'mixed', false, 'Mix'),
      ]),
    ).toEqual([
      {
        category: 'account',
        description: { en: 'Acc', de: 'Acc (de)' },
        mandatory: false,
        templates: ['x.a', 'x.c'],
      },
      {
        category: 'mixed',
        description: { en: 'Mix', de: 'Mix (de)' },
        mandatory: false,
        templates: ['x.d', 'x.e'],
      },
      {
        category: 'security',
        description: { en: 'Sec', de: 'Sec (de)' },
        mandatory: true,
        templates: ['x.b'],
      },
    ]);
  });
  it('has no category when there are no templates', () => {
    expect(categoriesOf([])).toEqual([]);
  });
});
