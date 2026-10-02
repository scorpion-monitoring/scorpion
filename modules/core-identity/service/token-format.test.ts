import { describe, expect, it } from 'vitest';
import {
  cacheKey,
  generateToken,
  parseToken,
  PREFIX_LENGTH,
  SECRET_LENGTH,
  TOKEN_LENGTH,
} from './token-format.ts';

const SECRET = 'A'.repeat(SECRET_LENGTH);
const good = `scp_abcd1234_${SECRET}`;

describe('parseToken', () => {
  it('splits a token into prefix and secret', () => {
    expect(parseToken(good)).toEqual({ prefix: 'abcd1234', secret: SECRET });
  });

  it('accepts "_" and "-" inside the secret, and keeps the separator at a fixed place', () => {
    const secret = `a_b-${'c'.repeat(SECRET_LENGTH - 4)}`;
    expect(parseToken(`scp_abcd1234_${secret}`)).toEqual({ prefix: 'abcd1234', secret });
  });

  it.each<[string, unknown]>([
    ['empty', ''],
    ['whitespace', '   '],
    ['not a string', 42],
    ['undefined', undefined],
    ['null', null],
    ['an object', { token: good }],
    ['the mark only', 'scp_'],
    ['no secret', 'scp_abcd1234_'],
    ['no separator after the prefix', `scp_abcd1234${SECRET}x`],
    ['a dash instead of the separator', `scp_abcd1234-${SECRET}`],
    ['no mark', `abcd1234_${SECRET}`],
    ['a wrong mark', `pat_abcd1234_${SECRET}`],
    ['an upper-case mark', `SCP_abcd1234_${SECRET}`],
    ['a short prefix', `scp_abcd123_${SECRET}x`],
    ['a long prefix', `scp_abcd12345_${SECRET.slice(1)}`],
    ['a "_" in the prefix', `scp_abcd12_4_${SECRET}`],
    ['a short secret', `scp_abcd1234_${SECRET.slice(1)}`],
    ['a long secret', `scp_abcd1234_${SECRET}A`],
    ['a leading space', ` ${good}`],
    ['a trailing space', `${good} `],
    ['a trailing newline', `${good}\n`],
    ['a space inside', `scp_abcd1234_${'A'.repeat(20)} ${'A'.repeat(SECRET_LENGTH - 21)}`],
    ['a non-ASCII letter in the prefix', `scp_abcdé234_${SECRET}`],
    ['a non-ASCII letter in the secret', `scp_abcd1234_${'é'.repeat(SECRET_LENGTH)}`],
    ['an emoji of the right length', `scp_abcd1234_${'😀'.repeat(SECRET_LENGTH / 2)}`],
    ['a NUL byte', `scp_abcd1234_${'A'.repeat(SECRET_LENGTH - 1)}\u0000`],
    ['SQL', `scp_abcd1234_' OR '1'='1${'A'.repeat(SECRET_LENGTH - 10)}`],
    ['two tokens', `${good},${good}`],
    ['a megabyte', 'scp_'.repeat(262_144)],
    ['a very long run of one letter', 'A'.repeat(100_000)],
  ])('says "invalid" for %s, and never throws', (_name, value) => {
    expect(() => parseToken(value)).not.toThrow();
    expect(parseToken(value)).toBeUndefined();
  });
});

describe('generateToken', () => {
  it('makes a token that parses back to its parts', () => {
    const made = generateToken();
    expect(made.token).toHaveLength(TOKEN_LENGTH);
    expect(made.prefix).toHaveLength(PREFIX_LENGTH);
    expect(parseToken(made.token)).toEqual({ prefix: made.prefix, secret: made.secret });
  });

  it('makes a different token every time', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken().token));
    expect(tokens.size).toBe(200);
  });
});

describe('cacheKey', () => {
  it('is a hash: stable, and it does not contain the token', () => {
    expect(cacheKey(good)).toBe(cacheKey(good));
    expect(cacheKey(good)).not.toBe(cacheKey(`${good}x`));
    expect(cacheKey(good)).not.toContain('abcd1234');
  });
});
