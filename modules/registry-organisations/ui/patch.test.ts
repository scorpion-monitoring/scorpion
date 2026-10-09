import { describe, expect, it } from 'vitest';
import { ADMIN_FIELDS, EDITOR_FIELDS } from '../service/field-rules.ts';
import type { FormField } from './form-schema.ts';
import { buildCreate, buildPatch, formValues, type StoredOrganisation } from './patch.ts';

const stored: StoredOrganisation = {
  type: 'provider',
  abbreviation: 'IPK',
  name: 'Leibniz IPK',
  description: 'old text',
  website: 'https://old.example.org',
  rorId: '02skbsp27',
  sameAs: ['https://a.example.org', 'https://b.example.org'],
  contactEmail: 'info@example.org',
  contactType: 'support',
};
const ALL: FormField[] = [...ADMIN_FIELDS, ...EDITOR_FIELDS];
const EDITOR: FormField[] = [...EDITOR_FIELDS];

describe('buildPatch', () => {
  it('is empty when the form sends back what is stored', () => {
    expect(buildPatch(stored, formValues(stored), ALL)).toEqual({});
  });

  it.each([
    ['a changed description', { description: 'new text' }, { description: 'new text' }],
    [
      'a changed website',
      { website: 'https://new.example.org' },
      { website: 'https://new.example.org' },
    ],
    ['a changed ROR id', { rorId: '03yrm5c26' }, { rorId: '03yrm5c26' }],
    ['a trimmed value that is the same', { description: '  old text  ' }, {}],
    [
      'a changed list of links',
      { sameAs: ['https://a.example.org'] },
      { sameAs: ['https://a.example.org'] },
    ],
    [
      'the same links in another order',
      { sameAs: ['https://b.example.org', 'https://a.example.org'] },
      {
        sameAs: ['https://b.example.org', 'https://a.example.org'],
      },
    ],
    ['an emptied description (null clears it)', { description: undefined }, { description: null }],
    ['a blank website (null clears it)', { website: '   ' }, { website: null }],
    ['an emptied ROR id', { rorId: '' }, { rorId: null }],
    ['an emptied list of links ([] clears it)', { sameAs: [] }, { sameAs: [] }],
    [
      'blank links are dropped',
      { sameAs: ['https://a.example.org', 'https://b.example.org', ' '] },
      {},
    ],
    [
      'a changed contact type sends both halves',
      { contactType: 'press' },
      { contactEmail: 'info@example.org', contactType: 'press' },
    ],
    [
      'a changed address sends both halves',
      { contactEmail: 'new@example.org' },
      { contactEmail: 'new@example.org', contactType: 'support' },
    ],
    [
      'an emptied contact point clears both',
      { contactEmail: undefined, contactType: undefined },
      { contactEmail: null, contactType: null },
    ],
    [
      'half an emptied contact point is sent as it is, for the server to refuse',
      { contactType: undefined },
      { contactEmail: 'info@example.org', contactType: null },
    ],
  ])('%s', (_name, change, expected) => {
    const values = { ...formValues(stored), ...change };
    for (const key of Object.keys(change) as (keyof typeof change)[]) {
      if (change[key] === undefined) delete (values as Record<string, unknown>)[key];
    }
    expect(buildPatch(stored, values, EDITOR)).toEqual(expected);
  });

  it('lets an administrator change the identity fields, and only what differs', () => {
    expect(
      buildPatch(
        stored,
        { ...formValues(stored), name: 'Renamed', abbreviation: 'IPK', type: 'consortium' },
        ALL,
      ),
    ).toEqual({ name: 'Renamed', type: 'consortium' });
  });

  it('never sends an identity field for a caller who may not write it, whatever the values say', () => {
    const values = {
      ...formValues(stored),
      name: 'Hacked',
      abbreviation: 'HACK',
      type: 'consortium',
    };
    expect(buildPatch(stored, values, EDITOR)).toEqual({});
  });

  it('never sends a field that is not among those the caller may write', () => {
    const values = {
      ...formValues(stored),
      description: 'changed',
      website: 'https://changed.example.org',
      contactType: 'changed',
    };
    expect(buildPatch(stored, values, ['description'])).toEqual({ description: 'changed' });
    expect(buildPatch(stored, values, [])).toEqual({});
  });

  it('handles an organisation with no optional values', () => {
    const bare: StoredOrganisation = {
      type: 'provider',
      abbreviation: 'X',
      name: 'X',
      description: null,
      website: null,
      rorId: null,
      sameAs: [],
    };
    expect(buildPatch(bare, formValues(bare), ALL)).toEqual({});
    expect(buildPatch(bare, { ...formValues(bare), description: 'now' }, ALL)).toEqual({
      description: 'now',
    });
  });
});

describe('buildCreate', () => {
  it('sends what was filled in, trimmed, and leaves out the rest and an empty list of links', () => {
    expect(
      buildCreate({
        type: 'provider',
        abbreviation: ' IPK ',
        name: 'Leibniz IPK',
        description: '',
        website: 'https://ipk.example.org',
        sameAs: [],
        contactEmail: 'info@example.org',
        contactType: 'support',
      }),
    ).toEqual({
      type: 'provider',
      abbreviation: 'IPK',
      name: 'Leibniz IPK',
      website: 'https://ipk.example.org',
      contactEmail: 'info@example.org',
      contactType: 'support',
    });
  });

  it('always sends the three required fields, empty when missing, so the server names them', () => {
    expect(buildCreate({})).toEqual({ type: '', abbreviation: '', name: '' });
  });

  it('sends the links when there are some', () => {
    expect(buildCreate({ sameAs: ['https://a.example.org', ' '] }).sameAs).toEqual([
      'https://a.example.org',
    ]);
  });
});

describe('formValues', () => {
  it('starts the form from the record, leaving out what is empty', () => {
    expect(
      formValues({
        type: 'provider',
        abbreviation: 'X',
        name: 'X',
        description: null,
        website: null,
        rorId: null,
        sameAs: [],
        contactEmail: null,
        contactType: null,
      }),
    ).toEqual({ type: 'provider', abbreviation: 'X', name: 'X', sameAs: [] });
  });
});
