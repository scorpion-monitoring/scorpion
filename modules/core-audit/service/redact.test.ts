import { describe, expect, it } from 'vitest';
import { capJson, isSecretKey, MAX_STORED_BYTES, prepare, redact, REDACTED } from './redact.ts';
import { DEFAULT_REDACT_KEYS } from './redact.ts';

describe('isSecretKey', () => {
  it.each([
    ['password', true],
    ['Password', true],
    ['newPassword', true],
    ['current_password', true],
    ['token', true],
    ['csrfToken', true],
    ['x-csrf-token', true],
    ['secret', true],
    ['clientSecret', true],
    ['Authorization', true],
    ['api-key', true],
    ['apiKey', true],
    ['x-api-key', true],
    ['API_KEY', true],
    ['code', true],
    ['value', true],
    // not secrets: a longer word that only contains one, an id of a token, a list of values
    ['values', false],
    ['tokenId', false],
    ['username', false],
    ['role', false],
    ['codes', false],
    ['', false],
  ])('%s → %s', (key, expected) => {
    expect(isSecretKey(key, DEFAULT_REDACT_KEYS)).toBe(expected);
  });
});

describe('redact', () => {
  it('replaces secret keys at any depth, in objects and arrays', () => {
    const body = {
      name: 'ok',
      password: 'hunter2',
      nested: { deep: { token: 't0ps3cret', keep: 1 }, list: [{ secret: 's' }, { fine: true }] },
      array: [[{ authorization: 'Bearer abc' }], 'plain'],
    };
    expect(redact(body)).toEqual({
      name: 'ok',
      password: REDACTED,
      nested: { deep: { token: REDACTED, keep: 1 }, list: [{ secret: REDACTED }, { fine: true }] },
      array: [[{ authorization: REDACTED }], 'plain'],
    });
  });

  it('does not change its input', () => {
    const body = { password: 'x', nested: { token: 'y' } };
    redact(body);
    expect(body).toEqual({ password: 'x', nested: { token: 'y' } });
  });

  it("hides the route's own keys on top of the default ones", () => {
    expect(redact({ iban: 'DE00', Pin: 1, name: 'n' }, ['iban', 'PIN'])).toEqual({
      iban: REDACTED,
      Pin: REDACTED,
      name: 'n',
    });
  });

  it('hides a whole subtree under a secret key, not only strings', () => {
    expect(redact({ secret: { a: 1, b: [1, 2] }, code: 12345 })).toEqual({
      secret: REDACTED,
      code: REDACTED,
    });
  });

  it('keeps __proto__ as data and does not pollute the prototype', () => {
    const parsed = JSON.parse('{"__proto__":{"polluted":true},"a":1}') as unknown;
    const out = redact(parsed) as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(out)).toEqual(['__proto__', 'a']);
  });

  it('cuts nesting deeper than 12 levels instead of walking it', () => {
    let nested: unknown = { password: 'deep' };
    for (let i = 0; i < 40; i += 1) nested = { next: nested };
    const text = JSON.stringify(redact(nested));
    expect(text).toContain('[too deep]');
    expect(text).not.toContain('deep"');
  });

  it('makes strings safe for jsonb: NUL and lone surrogates', () => {
    const out = redact({ 'a\u0000b': 'x\u0000y', lone: 'a\ud800b' }) as Record<string, string>;
    const text = JSON.stringify(out);
    expect(text).not.toContain('\\u0000');
    expect(Object.keys(out)).toEqual(['a�b', 'lone']);
    expect(out.lone).toBe('a�b');
  });

  it('handles values JSON cannot carry', () => {
    expect(redact({ n: Number.NaN, big: 10n, fn: () => 1, d: new Date(0) })).toEqual({
      n: null,
      big: '10',
      fn: null,
      d: '1970-01-01T00:00:00.000Z',
    });
  });

  it('redacts a secret in a query string object', () => {
    expect(redact({ page: '1', apikey: 'k-123', token: ['a', 'b'] })).toEqual({
      page: '1',
      apikey: REDACTED,
      token: REDACTED,
    });
  });
});

describe('capJson', () => {
  it('keeps what fits, unchanged', () => {
    const value = { a: 'x'.repeat(100) };
    expect(capJson(value)).toEqual({ value, truncated: false });
    expect(capJson(undefined)).toEqual({ value: undefined, truncated: false });
  });

  it.each([
    ['one long string', { text: 'a'.repeat(50_000) }],
    ['many small keys', Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, i]))],
    ['multi-byte text', { text: 'ä€😀'.repeat(5000) }],
    ['text that grows when escaped', { text: '"\n\\'.repeat(5000) }],
    ['a long array', Array.from({ length: 10_000 }, () => 'item')],
  ])('stores a stand-in of at most 8 KB for %s', (_name, value) => {
    const capped = capJson(value);
    expect(capped.truncated).toBe(true);
    const text = JSON.stringify(capped.value);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_STORED_BYTES);
    expect(capped.value).toMatchObject({ _truncated: true });
    expect(() => JSON.parse(text) as unknown).not.toThrow();
  });

  it('does not cut a character in half', () => {
    const capped = capJson({ text: '😀'.repeat(5000) }, 1000);
    expect(JSON.stringify(capped.value)).not.toContain('�');
  });
});

describe('prepare', () => {
  it('redacts before it caps, so a secret does not survive in the preview', () => {
    const body = { password: 'hunter2-hunter2', filler: 'x'.repeat(20_000) };
    const prepared = prepare(body);
    expect(prepared.truncated).toBe(true);
    expect(JSON.stringify(prepared.value)).not.toContain('hunter2');
  });

  it('passes undefined through', () => {
    expect(prepare(undefined)).toEqual({ value: undefined, truncated: false });
  });

  it('stores a body that is not JSON as the note the pipeline made of it', () => {
    expect(prepare('[non-JSON body, 12 bytes]').value).toBe('[non-JSON body, 12 bytes]');
  });
});
