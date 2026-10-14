// The API reference (ADR-0038): one full-page document that draws the OpenAPI document of this instance
// with Scalar. The page is made here, apart from SvelteKit, so that its headers and its HTML can be tested
// with a table: a new nonce per request on every inline tag, the policy of the ADR, no address of another
// host, and the options that must stay off.
import { randomBytes } from 'node:crypto';
import { ScalarApiReference } from '@scalar/sveltekit';
import { REFERENCE_PALETTES, referenceCss } from './reference-theme.ts';

/**
 * The Content-Security-Policy of the reference, and of nothing else. It differs from the policy of every other
 * page (vite.config.ts) in one directive: Scalar writes `<style>` elements and `style` attributes while it
 * runs, which only `'unsafe-inline'` admits (a nonce cannot authorise an attribute, and a nonce in `style-src`
 * would switch `'unsafe-inline'` off). Scripts stay `'self'` plus this request's nonce, and `connect-src` stays
 * `'self'`, so the page can talk to this origin only.
 */
export function referencePolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
}

export interface ReferenceInput {
  /** The nonce of this request: new for each. */
  nonce: string;
  /** Where the OpenAPI document of this instance is, below the base path. */
  documentUrl: string;
  /** Where the script of the pinned Scalar build is, below the base path. */
  assetUrl: string;
  /** The landing page, below the base path. */
  backUrl: string;
  /** The instance's name, from the settings. */
  instanceName: string;
  /** The text of the link back to the landing page. */
  backLabel: string;
}

export function newNonce(): string {
  return randomBytes(16).toString('base64');
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Runs before Scalar starts. Scalar has its own light and dark switch, which we hide; this makes it follow
 * the shell's: the stored choice of `scorpion.theme` (read, never written), else the system's.
 */
export const THEME_SCRIPT = `(function () {
  var choice = null;
  try { choice = window.localStorage.getItem('scorpion.theme'); } catch (e) { choice = null; }
  if (choice !== 'light' && choice !== 'dark') {
    choice = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  var create = window.Scalar.createApiReference;
  window.Scalar.createApiReference = function (selector, configuration) {
    configuration.forceDarkModeState = choice;
    return create.call(this, selector, configuration);
  };
})();`;

/** Where the wrapper's second `<script>` begins: our theme script goes in front of it. */
const INIT_MARKER = '<!-- Initialize the Scalar API Reference -->';

/** The document, as `@scalar/sveltekit` writes it, with what the wrapper does not offer added. */
export async function renderReference(input: ReferenceInput): Promise<string> {
  const response = ScalarApiReference({
    url: input.documentUrl,
    cdn: input.assetUrl,
    nonce: input.nonce,
    pageTitle: input.instanceName,
    // Nothing leaves this origin and nothing is kept in the browser (ADR-0038).
    withDefaultFonts: false,
    telemetry: false,
    persistAuth: false,
    showDeveloperTools: 'never',
    hideDarkModeToggle: true,
    // The sidebar's "Open API Client" button, the AI agent and the MCP generator are Scalar's own offers.
    hideClientButton: true,
    mcp: { disabled: true },
    agent: { disabled: true },
    authentication: { preferredSecurityScheme: 'HTTPBearer' },
    // The `scalar` theme of the wrapper is replaced by the shell's colours.
    theme: 'default',
    customCss: referenceCss(),
    // Scalar's variables follow the shell's choice of light or dark.
    darkMode: false,
  })();
  const html = await response.text();

  const nonce = escapeHtml(input.nonce);
  const bar = `<nav class="scorpion-bar" aria-label="${escapeHtml(input.instanceName)}"><a href="${escapeHtml(input.backUrl)}">${escapeHtml(input.backLabel)}</a><span>${escapeHtml(input.instanceName)}</span></nav>`;
  const script = `<script nonce="${nonce}">${THEME_SCRIPT}</script>\n    `;
  if (!html.includes('<html>') || !html.includes('<body>') || !html.includes(INIT_MARKER)) {
    throw new Error('The shape of the document @scalar/sveltekit writes changed (see ADR-0038).');
  }
  return html
    .replace('<html>', '<html lang="en">')
    .replace('<head>', '<head>\n    <meta name="color-scheme" content="light dark" />')
    .replace('<body>', `<body>\n    ${bar}`)
    .replace(INIT_MARKER, `${script}${INIT_MARKER}`);
}

export { REFERENCE_PALETTES };
