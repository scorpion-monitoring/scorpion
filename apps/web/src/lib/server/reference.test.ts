import { describe, expect, it } from 'vitest';
import { newNonce, referencePolicy, renderReference, THEME_SCRIPT } from './reference.ts';

const input = (overrides: Partial<Parameters<typeof renderReference>[0]> = {}) => ({
  nonce: 'bm9uY2UtZm9yLXRlc3Q=',
  documentUrl: '/a/b/api/v1/openapi.json',
  assetUrl: '/a/b/_app/immutable/scalar/api-reference.0123456789ab.js',
  backUrl: '/a/b/docs',
  instanceName: 'Test Instance',
  backLabel: 'Back to the API documentation',
  ...overrides,
});

/** The configuration object the wrapper writes into its inline script (it holds no function). */
function configurationOf(html: string): Record<string, unknown> {
  const start =
    html.indexOf("Scalar.createApiReference('#app', ") +
    "Scalar.createApiReference('#app', ".length;
  const end = html.indexOf('\n    </script>', start);
  return JSON.parse(html.slice(start, end).trim().replace(/\)$/, '')) as Record<string, unknown>;
}

describe('referencePolicy', () => {
  it('is exactly the policy of ADR-0038', () => {
    expect(referencePolicy('N')).toBe(
      [
        "default-src 'none'",
        "script-src 'self' 'nonce-N'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "manifest-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "object-src 'none'",
      ].join('; '),
    );
  });

  it('relaxes styles only: no unsafe script, no eval, nothing but this origin to talk to', () => {
    const policy = referencePolicy('N');
    const directive = (name: string) =>
      policy
        .split('; ')
        .find((part) => part.startsWith(`${name} `))
        ?.split(' ')
        .slice(1);
    expect(directive('script-src')).toEqual(["'self'", "'nonce-N'"]);
    expect(directive('connect-src')).toEqual(["'self'"]);
    expect(directive('style-src')).toContain("'unsafe-inline'");
    // A nonce in `style-src` would switch 'unsafe-inline' off.
    expect(directive('style-src')?.join(' ')).not.toContain('nonce');
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toMatch(/https?:/);
  });
});

describe('newNonce', () => {
  it('is new each time and long enough to guess nothing', () => {
    const nonces = new Set(Array.from({ length: 200 }, () => newNonce()));
    expect(nonces.size).toBe(200);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe('renderReference', () => {
  it('puts the nonce of the request on every inline tag and the policy needs no other', async () => {
    const html = await renderReference(input());
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>/g)];
    expect(inlineScripts.length).toBeGreaterThanOrEqual(2); // the theme script and the start-up script
    for (const [, attributes] of inlineScripts)
      expect(attributes).toContain('nonce="bm9uY2UtZm9yLXRlc3Q="');
    for (const [, attributes] of html.matchAll(/<script([^>]*\ssrc=[^>]*)>/g)) {
      expect(attributes).toContain('nonce="bm9uY2UtZm9yLXRlc3Q="');
    }
    expect(html).toContain('<meta property="csp-nonce" content="bm9uY2UtZm9yLXRlc3Q=" />');
    for (const [, attributes] of html.matchAll(/<style([^>]*)>/g)) {
      expect(attributes).toContain('nonce="bm9uY2UtZm9yLXRlc3Q="');
    }
    expect(html).not.toMatch(/\son[a-z]+=/);
  });

  it('writes a different nonce for a different request', async () => {
    const [a, b] = await Promise.all([
      renderReference(input({ nonce: newNonce() })),
      renderReference(input({ nonce: newNonce() })),
    ]);
    const nonce = (html: string) => /nonce="([^"]+)"/.exec(html)?.[1];
    expect(nonce(a)).toBeTruthy();
    expect(nonce(a)).not.toBe(nonce(b));
  });

  it('names no host: the script, the document and every link are paths of this instance', async () => {
    const html = await renderReference(input());
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('jsdelivr');
    expect(html).not.toContain('scalar.com');
    expect(html).toContain(
      '<script src="/a/b/_app/immutable/scalar/api-reference.0123456789ab.js"',
    );
    expect(configurationOf(html).url).toBe('/a/b/api/v1/openapi.json');
    expect(html).toContain('<a href="/a/b/docs">Back to the API documentation</a>');
  });

  it('keeps the options that would store, send or fetch something switched off', async () => {
    const configuration = configurationOf(await renderReference(input()));
    expect(configuration).toMatchObject({
      withDefaultFonts: false,
      telemetry: false,
      persistAuth: false,
      showDeveloperTools: 'never',
      hideDarkModeToggle: true,
      hideClientButton: true,
      mcp: { disabled: true },
      agent: { disabled: true },
    });
    for (const option of ['proxyUrl', 'servers', 'baseServerURL', 'pluginUrls', 'proxy', 'fetch']) {
      expect(configuration).not.toHaveProperty(option);
    }
  });

  it('declares its language and follows the shell in light and dark', async () => {
    const html = await renderReference(input());
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta name="color-scheme" content="light dark" />');
    // The theme script wraps the starter, so it sits after the library and before the start-up script.
    const library = html.indexOf('<script src=');
    const theme = html.indexOf('forceDarkModeState');
    const start = html.indexOf("Scalar.createApiReference('#app'");
    expect(library).toBeLessThan(theme);
    expect(theme).toBeLessThan(start);
    expect(THEME_SCRIPT).toContain("'scorpion.theme'");
    expect(THEME_SCRIPT).not.toContain('setItem');
  });

  it('writes the instance name as text, never as markup', async () => {
    const html = await renderReference(
      input({ instanceName: '<img src=x onerror=alert(1)> & "co"' }),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;co&quot;');
    expect(html).toContain('<title>&lt;img');
  });
});
