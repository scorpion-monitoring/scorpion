import { describe, expect, it } from 'vitest';
import { withExtraOrigin, withStyleNonce } from './csp.ts';

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

describe('withExtraOrigin (ADR-0054)', () => {
  const page =
    "default-src 'none'; script-src 'self' 'nonce-abc'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";
  const origin = 'https://stats.example.org';

  it('adds the origin to script-src, img-src and connect-src only', () => {
    expect(withExtraOrigin(page, origin)).toBe(
      "default-src 'none'; script-src 'self' 'nonce-abc' https://stats.example.org; style-src 'self'; img-src 'self' data: https://stats.example.org; connect-src 'self' https://stats.example.org; frame-ancestors 'none'",
    );
  });

  it('is idempotent and never adds unsafe-inline', () => {
    const once = withExtraOrigin(page, origin);
    expect(withExtraOrigin(once, origin)).toBe(once);
    expect(once).not.toContain('unsafe-inline');
  });

  it('changes nothing while tracking is off', () => {
    expect(withExtraOrigin(page, null)).toBe(page);
  });

  it.each([
    'http://stats.example.org',
    'https://stats.example.org/',
    'https://stats.example.org/matomo',
    "https://stats.example.org; script-src 'unsafe-inline'",
    "https://a.org 'unsafe-eval'",
    '*',
    'https://*.example.org',
    'not a url',
  ])('changes nothing for %s, which is not a plain https origin', (value) => {
    expect(withExtraOrigin(page, value)).toBe(page);
  });

  it('leaves a policy without a script nonce alone (not a page of the shell)', () => {
    const other = "default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self'";
    expect(withExtraOrigin(other, origin)).toBe(other);
  });

  it('does not add a directive the policy does not have (default-src stays the fallback)', () => {
    expect(withExtraOrigin("default-src 'none'; script-src 'nonce-abc'", origin)).toBe(
      "default-src 'none'; script-src 'nonce-abc' https://stats.example.org",
    );
  });
});
