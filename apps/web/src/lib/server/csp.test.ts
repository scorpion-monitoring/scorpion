import { describe, expect, it } from 'vitest';
import { withStyleNonce } from './csp.ts';

describe('withStyleNonce', () => {
  it.each([
    {
      name: 'adds the script nonce to style-src',
      policy:
        "default-src 'none'; script-src 'self' 'nonce-abc+/='; style-src 'self'; style-src-attr 'unsafe-hashes' 'sha256-x='",
      expected:
        "default-src 'none'; script-src 'self' 'nonce-abc+/='; style-src 'self' 'nonce-abc+/='; style-src-attr 'unsafe-hashes' 'sha256-x='",
    },
    {
      name: 'leaves a policy with inline styles alone (a nonce would disable them)',
      policy: "script-src 'self' 'nonce-abc'; style-src 'self' 'unsafe-inline'",
      expected: "script-src 'self' 'nonce-abc'; style-src 'self' 'unsafe-inline'",
    },
    {
      name: 'leaves a style-src that has a nonce alone',
      policy: "script-src 'nonce-abc'; style-src 'self' 'nonce-abc'",
      expected: "script-src 'nonce-abc'; style-src 'self' 'nonce-abc'",
    },
    {
      name: 'does nothing without a script nonce',
      policy: "script-src 'self'; style-src 'self'",
      expected: "script-src 'self'; style-src 'self'",
    },
    {
      name: 'does not add a style-src that is not there (default-src stays the fallback)',
      policy: "default-src 'self'; script-src 'nonce-abc'",
      expected: "default-src 'self'; script-src 'nonce-abc'",
    },
    {
      name: 'does not take style-src-attr for style-src',
      policy: "script-src 'nonce-abc'; style-src-attr 'none'",
      expected: "script-src 'nonce-abc'; style-src-attr 'none'",
    },
  ])('$name', ({ policy, expected }) => {
    expect(withStyleNonce(policy)).toBe(expected);
  });
});
