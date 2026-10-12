import * as organisations from '@scorpion/registry-organisations/public';
import { describe, expect, it } from 'vitest';
import * as fields from './fields.ts';
import { parsePlain, parseSlug, RESERVED_SLUGS, TEXT_PARSERS, TEXT_FORMATS } from './fields.ts';

describe('parseSlug', () => {
  it.each([
    ['ipk', 'ipk'],
    ['  Galaxy-EU  ', 'Galaxy-EU'],
    ['a', 'a'],
    ['9lives', '9lives'],
    ['a.b_c-d', 'a.b_c-d'],
    ['x'.repeat(64), 'x'.repeat(64)],
    // 32 hex characters without dashes are not a UUID shape, and a valid slug.
    ['0123456789abcdef0123456789abcdef', '0123456789abcdef0123456789abcdef'],
  ])('accepts %j', (input, expected) => {
    expect(parseSlug(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['', /must not be empty/],
    ['   ', /must not be empty/],
    ['x'.repeat(65), /at most 64/],
    ['-leading', /must start with a letter or a digit/],
    ['.leading', /must start with a letter or a digit/],
    ['has space', /letters, digits/],
    ['slash/inside', /letters, digits/],
    ['ümlaut', /letters, digits/],
    ['tab\tinside', /letters, digits/],
    ['a%20b', /letters, digits/],
    ['123e4567-e89b-42d3-a456-426614174000', /look like an id/],
    ['123E4567-E89B-42D3-A456-426614174000', /look like an id/],
    ['0198f9c0-1234-7abc-8def-0123456789ab', /look like an id/],
  ])('refuses %j', (input, message) => {
    const parsed = parseSlug(input);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(message);
  });

  it.each(RESERVED_SLUGS.flatMap((word) => [word, word.toUpperCase(), ` ${word} `]))(
    'refuses the reserved page word %j without case',
    (word) => {
      const parsed = parseSlug(word);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.message).toMatch(/reserved/);
    },
  );

  it('reserves `new`, the page that creates a service, and the internal routes under /services', () => {
    expect(RESERVED_SLUGS).toEqual(
      expect.arrayContaining(['new', 'facets', 'schema', 'by-slug', 'public', 'edit']),
    );
  });
});

describe('the rules shared with organisations', () => {
  it('are the organisation’s functions, not copies that can drift', () => {
    expect(fields.parseUrl).toBe(organisations.parseUrl);
    expect(fields.parseSameAs).toBe(organisations.parseSameAs);
    expect(fields.parseContactEmail).toBe(organisations.parseContactEmail);
    expect(fields.parseContactType).toBe(organisations.parseContactType);
    expect(fields.parseDescription).toBe(organisations.parseDescription);
    expect(fields.parseName).toBe(organisations.parseName);
    expect(fields.MAX_SAME_AS).toBe(20);
    expect(fields.MAX_NAME_LENGTH).toBe(200);
    expect(fields.MAX_DESCRIPTION_LENGTH).toBe(4000);
  });
});

describe('the text formats', () => {
  it.each([
    ['name', '  A   B  ', 'A B'],
    ['name', 'x'.repeat(200), 'x'.repeat(200)],
    ['description', 'line one\r\nline two  ', 'line one\nline two'],
    ['description', '   ', null],
    ['url', 'https://Example.org/', 'https://example.org'],
    ['email', 'Ops@Example.ORG', 'Ops@example.org'],
    ['contact-type', ' Support ', 'Support'],
    ['plain', '  free  text ', 'free text'],
    ['slug', 'ok-slug', 'ok-slug'],
  ] as const)('%s accepts %j', (format, input, expected) => {
    expect(TEXT_PARSERS[format](input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['name', ''],
    ['name', 'x'.repeat(201)],
    ['name', 'bad\u0000name'],
    ['description', 'x'.repeat(4001)],
    ['url', 'ftp://example.org'],
    ['url', 'javascript:alert(1)'],
    ['url', 'https://user:pw@example.org'],
    ['email', 'not-an-address'],
    ['contact-type', ''],
    ['plain', 'x'.repeat(501)],
    ['slug', 'new'],
  ] as const)('%s refuses %j', (format, input) => {
    expect(TEXT_PARSERS[format](input).ok).toBe(false);
  });

  it('has a parser for every format', () => {
    expect(Object.keys(TEXT_PARSERS).sort()).toEqual([...TEXT_FORMATS].sort());
  });

  it('plain names the value, not the name, in its message', () => {
    expect(parsePlain('')).toEqual({ ok: false, message: 'The value must not be empty.' });
  });
});
