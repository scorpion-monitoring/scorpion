// Shared by the template tests: a branding with every optional part set, and the strings an
// attacker would type into a name (markup, a bidirectional override, a line break).
import type { TemplateBranding } from '../service/templates/layout.ts';

export const BRANDING: TemplateBranding = {
  productName: 'Scorpion',
  instanceName: 'Test Instance',
  contactEmail: 'help@example.org',
  imprintUrl: 'https://example.org/imprint',
  logoUrl: 'https://example.org/api/internal/files/abc',
  baseUrl: 'https://example.org',
};

/** Right-to-left override and an isolate, as `"\u202E"` in a name that would show reversed. */
export const BIDI_OVERRIDE = '\u202E';

export const HOSTILE = {
  markup: '<script>alert(1)</script>',
  quote: '"><img src=x onerror=alert(1)>',
  bidi: `evil${BIDI_OVERRIDE}gnp.exe\u2066`,
  lineBreak: 'Alice\r\nBcc: attacker@example.org',
  paragraphSeparator: 'Bob\u2028Subject: injected',
};
