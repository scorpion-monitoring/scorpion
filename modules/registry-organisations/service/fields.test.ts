// Table-driven tests of the pure field rules: normalisation, the sameAs list, the ROR id, the contact
// point, the search escape. No database, no network.
import { describe, expect, it } from 'vitest';
import {
  escapeLike,
  MAX_SAME_AS,
  normaliseText,
  parseAbbreviation,
  parseContactEmail,
  parseContactType,
  parseDescription,
  parseName,
  parseRorId,
  parseSameAs,
  parseUrl,
  rorChecksum,
} from './fields.ts';
import { createOrganisationSchema, updateOrganisationSchema } from './input.ts';

const valueOf = <T>(parsed: { ok: true; value: T } | { ok: false; message: string }) =>
  parsed.ok ? parsed.value : `ERR: ${parsed.message}`;
const failed = (parsed: { ok: boolean }) => !parsed.ok;

describe('normaliseText', () => {
  it.each([
    ['  a  b ', 'a b'],
    ['a\tb\nc', 'a b c'],
    ['', ''],
    [' x ', 'x'],
  ])('%j → %j', (input, expected) => {
    expect(normaliseText(input)).toBe(expected);
  });
});

describe('names and abbreviations', () => {
  it.each([
    ['  Leibniz   Institute ', 'Leibniz Institute'],
    ['<b>x</b>', '<b>x</b>'], // HTML is text; it is escaped on output
    ['a'.repeat(200), 'a'.repeat(200)],
  ])('name %j is stored as %j', (input, expected) => {
    expect(valueOf(parseName(input))).toBe(expected);
  });

  it.each(['', '   ', 'a'.repeat(201), 'bad\u0000name', 'bell\u0007', '‎\u0085x'.slice(0, 0)])(
    'refuses the name %j',
    (input) => {
      expect(failed(parseName(input))).toBe(true);
    },
  );

  it.each([
    ['IPK', 'IPK'],
    [' de.NBI ', 'de.NBI'],
    ['a'.repeat(64), 'a'.repeat(64)],
  ])('abbreviation %j is stored as %j', (input, expected) => {
    expect(valueOf(parseAbbreviation(input))).toBe(expected);
  });

  it.each(['', 'a b', 'a/b', 'a'.repeat(65), '/', 'x\ty'])(
    'refuses the abbreviation %j',
    (input) => {
      expect(failed(parseAbbreviation(input))).toBe(true);
    },
  );
});

describe('description', () => {
  it.each([
    ['  text  ', 'text'],
    ['a\r\nb\rc', 'a\nb\nc'],
    ['', null],
    ['   \n ', null],
    ['<script>x</script>', '<script>x</script>'],
    ['tab\tand\nnewline', 'tab\tand\nnewline'],
  ])('%j → %j', (input, expected) => {
    expect(valueOf(parseDescription(input))).toBe(expected);
  });

  it.each(['a\u0000b', 'a\u001bb', 'a'.repeat(4001)])('refuses %j', (input) => {
    expect(failed(parseDescription(input))).toBe(true);
  });
});

describe('URLs (website and sameAs)', () => {
  it.each([
    ['https://example.org', 'https://example.org'],
    ['https://example.org/', 'https://example.org'],
    ['  HTTPS://Example.ORG/Path  ', 'https://example.org/Path'],
    ['http://example.org/a?b=1#c', 'http://example.org/a?b=1#c'],
    ['https://example.org/?x=1', 'https://example.org/?x=1'],
    ['https://example.org:8443/x', 'https://example.org:8443/x'],
  ])('%j → %j', (input, expected) => {
    expect(valueOf(parseUrl(input))).toBe(expected);
  });

  it.each([
    '',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>1</script>',
    'ftp://example.org',
    'file:///etc/passwd',
    'mailto:a@b.org',
    '//example.org',
    'example.org',
    'https://user:pw@example.org',
    'https://user@example.org',
    'https://exa mple.org',
    'https://example.org/a b',
    'https://example.org/\u0000',
    `https://example.org/${'a'.repeat(500)}`,
    'https://',
    'https:///x',
  ])('refuses %j', (input) => {
    expect(failed(parseUrl(input))).toBe(true);
  });
});

describe('sameAs', () => {
  it('trims, normalises, removes duplicates and keeps the order', () => {
    expect(
      valueOf(
        parseSameAs([
          'https://a.org/',
          ' https://b.org ',
          'https://a.org',
          'HTTPS://B.ORG/',
          'https://c.org/x',
        ]),
      ),
    ).toEqual(['https://a.org', 'https://b.org', 'https://c.org/x']);
  });

  it(`accepts ${MAX_SAME_AS} entries and refuses one more`, () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => `https://e${i}.org`);
    expect(parseSameAs(make(MAX_SAME_AS)).ok).toBe(true);
    expect(parseSameAs(make(MAX_SAME_AS + 1)).ok).toBe(false);
  });

  it('refuses the whole list when one entry is hostile, and names it', () => {
    const parsed = parseSameAs(['https://a.org', 'javascript:alert(1)']);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.message).toContain('Link 2');
  });

  it('accepts an empty list', () => {
    expect(parseSameAs([])).toEqual({ ok: true, value: [] });
  });
});

describe('ROR id', () => {
  // Real, published ids (Harvard, MIT, Stanford, IPK Gatersleben) and their check digits.
  const published = ['03vek6s52', '042nb2s44', '00f54p054', '02skbsp27'];

  it.each(published)('accepts the published id %s and computes its check digits', (id) => {
    expect(valueOf(parseRorId(id))).toBe(id);
    expect(rorChecksum(id.slice(1, 7))).toBe(id.slice(7));
  });

  it.each([
    ['https://ror.org/02skbsp27', '02skbsp27'],
    ['http://ror.org/02skbsp27', '02skbsp27'],
    ['ror.org/02skbsp27', '02skbsp27'],
    ['  02SKBSP27 ', '02skbsp27'],
    ['HTTPS://ROR.ORG/02SKBSP27', '02skbsp27'],
  ])('normalises %j to %j', (input, expected) => {
    expect(valueOf(parseRorId(input))).toBe(expected);
  });

  it.each([
    '',
    '02skbsp28', // wrong check digits
    '12skbsp27', // must start with 0
    '02skbsu27', // `u` is not in the alphabet
    '02skbsl27', // `l`
    '02skbso27', // `o`
    '02skbsi27', // `i`
    '02skbsp2', // too short
    '02skbsp277', // too long
    '02skbsp2a', // check digits are digits
    'https://ror.org/02skbsp27/',
    'https://evil.example/02skbsp27',
    'https://ror.org.evil.example/02skbsp27',
    '02skbsp27 extra',
  ])('refuses %j', (input) => {
    expect(failed(parseRorId(input))).toBe(true);
  });
});

describe('contact point', () => {
  it.each([
    ['info@example.org', 'info@example.org'],
    [' Info@Example.ORG ', 'Info@example.org'],
    ['a.b+tag@sub.example.org', 'a.b+tag@sub.example.org'],
  ])('email %j → %j', (input, expected) => {
    expect(valueOf(parseContactEmail(input))).toBe(expected);
  });

  it.each([
    '',
    'no-at.example.org',
    '@example.org',
    'a@',
    'a@b',
    'a@@b.org',
    'a b@example.org',
    '.a@example.org',
    'a.@example.org',
    'a..b@example.org',
    'a@-example.org',
    'a@example..org',
    'a@exa_mple.org',
    `${'a'.repeat(65)}@example.org`,
    `a@${'b'.repeat(250)}.org`,
    'a@example.org\r\nBcc: x@y.org',
    '"quoted"@example.org',
    'a@[127.0.0.1]',
  ])('refuses the email %j', (input) => {
    expect(failed(parseContactEmail(input))).toBe(true);
  });

  it.each([
    ['customer support', 'customer support'],
    ['  press   office ', 'press office'],
  ])('contact type %j → %j', (input, expected) => {
    expect(valueOf(parseContactType(input))).toBe(expected);
  });

  it.each(['', '  ', 'x'.repeat(65), 'a\u0000b'])('refuses the contact type %j', (input) => {
    expect(failed(parseContactType(input))).toBe(true);
  });
});

describe('escapeLike', () => {
  it.each([
    ['plain', 'plain'],
    ['100%', '100\\%'],
    ['a_b', 'a\\_b'],
    ['back\\slash', 'back\\\\slash'],
    ['%_\\', '\\%\\_\\\\'],
    ['', ''],
  ])('%j → %j', (input, expected) => {
    expect(escapeLike(input)).toBe(expected);
  });
});

describe('the body schemas', () => {
  const base = { type: 'provider', abbreviation: ' IPK ', name: '  Leibniz   Institute ' };

  it('normalises a create body and fills nothing the caller did not send', () => {
    const parsed = createOrganisationSchema.parse({
      ...base,
      website: 'https://example.org/',
      rorId: 'https://ror.org/02skbsp27',
      sameAs: ['https://a.org/', 'https://a.org'],
    });
    expect(parsed).toEqual({
      type: 'provider',
      abbreviation: 'IPK',
      name: 'Leibniz Institute',
      website: 'https://example.org',
      rorId: '02skbsp27',
      sameAs: ['https://a.org'],
    });
  });

  it.each<[Record<string, unknown>, string]>([
    [{ ...base, contactEmail: 'info@example.org' }, 'an address without a type'],
    [{ ...base, contactType: 'support' }, 'a type without an address'],
    [{ ...base, extra: 1 }, 'an unknown field'],
    [{ ...base, name: 'x'.repeat(5000) }, 'a huge name'],
    [{ ...base, sameAs: Array.from({ length: 21 }, (_, i) => `https://e${i}.org`) }, 'a 21st link'],
    [{ ...base, website: 'javascript:alert(1)' }, 'a javascript: website'],
    [{ ...base, rorId: '02skbsu27' }, 'a ROR id with a forbidden letter'],
  ])('refuses a create body with %#: %s', (body) => {
    expect(createOrganisationSchema.safeParse(body).success).toBe(false);
  });

  it('accepts a contact point only as a pair on create', () => {
    expect(
      createOrganisationSchema.safeParse({
        ...base,
        contactEmail: 'info@example.org',
        contactType: 'customer support',
      }).success,
    ).toBe(true);
  });

  it.each([
    [{}, false],
    [{ description: null }, true],
    [{ website: null, rorId: null, sameAs: [] }, true],
    [{ contactEmail: null, contactType: null }, true],
    [{ contactEmail: 'info@example.org', contactType: 'support' }, true],
    [{ contactEmail: 'info@example.org' }, false],
    [{ contactType: null }, false],
    [{ contactEmail: null, contactType: 'support' }, false],
    [{ name: null }, false],
    [{ type: 'consortium' }, true],
  ])('update body %j is valid: %s', (body, valid) => {
    expect(updateOrganisationSchema.safeParse(body).success).toBe(valid);
  });
});
