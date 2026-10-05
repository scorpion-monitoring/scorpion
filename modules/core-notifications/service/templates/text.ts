// What may go into a mail from a value that somebody else typed (a name, an instance name, a
// note). Every interpolated value passes through here, so the escaping is by construction and no
// template has to remember it.

/**
 * Characters that reorder or hide text: the bidirectional overrides, embeddings and isolates
 * (a name written "gnp.exe" that shows as "exe.png"), and the marks that go with them.
 */
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
/** Control characters, including CR and LF, and the Unicode line and paragraph separators. */
const CONTROL_AND_BREAKS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;
/** Controls other than a line feed and a tab, for text that may span lines. */
const CONTROL_KEEP_BREAKS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/g;

/** One line, for a subject or a name: no line breaks, no controls, no bidi marks, single spaces. */
export function oneLine(value: string, max = 200): string {
  return value
    .replace(BIDI, '')
    .replace(CONTROL_AND_BREAKS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Text that may have line breaks (a note): bidi marks and other controls go, `\n` stays. */
export function multiLine(value: string, max = 2000): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(BIDI, '')
    .replace(CONTROL_KEEP_BREAKS, '')
    .slice(0, max);
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for an HTML text node or a quoted attribute value. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}

/**
 * A link that may be put in an `href`: `https:`, `http:` or `mailto:` and nothing else (no
 * `javascript:`, no `data:`). Returns `undefined` for anything else, and the caller then shows
 * the text without a link.
 */
export function safeUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048 || /[\u0000- \u007F-\u009F]/.test(trimmed)) {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    return ['https:', 'http:', 'mailto:'].includes(parsed.protocol) ? trimmed : undefined;
  } catch {
    return undefined;
  }
}
