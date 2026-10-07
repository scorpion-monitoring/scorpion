import { describe, expect, it } from 'vitest';
import { hashMailToken, isMailTokenShape, newMailToken } from './mail-tokens.ts';

describe('mail token format', () => {
  it('is 256 random bits behind a mark, different every time [ASVS-6.5.3] [ASVS-6.5.4]', () => {
    const a = newMailToken('password-reset');
    const b = newMailToken('password-reset');
    expect(a).toMatch(/^srt_[A-Za-z0-9_-]{43}$/);
    expect(newMailToken('email-verification')).toMatch(/^sev_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('hashes to SHA-256 hex, so the hash says nothing about the token [ASVS-6.5.2]', () => {
    const hash = hashMailToken(newMailToken('password-reset'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['srt_' + 'A'.repeat(43), 'password-reset', true],
    ['sev_' + 'A'.repeat(43), 'password-reset', false], // the other purpose
    ['sev_' + 'A'.repeat(43), 'email-verification', true],
    ['srt_' + 'A'.repeat(42), 'password-reset', false],
    ['srt_' + 'A'.repeat(44), 'password-reset', false],
    ['srt_' + 'A'.repeat(42) + '!', 'password-reset', false],
    ['scp_abcd1234_' + 'A'.repeat(43), 'password-reset', false], // an access token
    ['', 'password-reset', false],
    ['srt_' + 'Ä'.repeat(43), 'password-reset', false],
  ] as const)('checks the shape of %s for %s', (token, purpose, expected) => {
    expect(isMailTokenShape(token, purpose)).toBe(expected);
  });
});
