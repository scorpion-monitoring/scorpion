// A small Markdown renderer for the texts an administrator writes (legal pages). It supports what
// those texts need: headings, paragraphs, bold, italic, inline code, links, bullet and numbered
// lists, block quotes, fenced code and rules. Raw HTML is not supported: it is escaped and shows
// as text. The output goes through `sanitizeHtml` as a second layer, so a bug here cannot become
// markup in a page. A full CommonMark parser would be a new dependency (backlog).
import { sanitizeHtml } from './html.ts';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** `http:`, `https:`, `mailto:`, an absolute path or a fragment; anything else is not a link. */
const SAFE_URL = /^(?:https?:\/\/|mailto:|#|\/(?!\/))[^\s<>"'`]*$/i;

function inline(text: string): string {
  // Code spans first, so that nothing inside them is formatted. They are put back last.
  const spans: string[] = [];
  const withoutCode = text.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    spans.push(`<code>${escapeHtml(code)}</code>`);
    return `\uE000${spans.length - 1}\uE000`;
  });
  let out = escapeHtml(withoutCode);
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label: string, url: string) => {
    // The text was escaped, so `&amp;` stands for `&` in the URL.
    const raw = url.replace(/&amp;/g, '&');
    return SAFE_URL.test(raw) ? `<a href="${escapeHtml(raw)}">${label}</a>` : match;
  });
  out = out
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return out.replace(/\uE000(\d+)\uE000/g, (_m, index: string) => spans[Number(index)] ?? '');
}

/** The most input that is rendered; longer text is cut, not refused, because it is an admin's. */
export const MAX_MARKDOWN_LENGTH = 100_000;

export function renderMarkdown(markdown: string): string {
  const lines = markdown.slice(0, MAX_MARKDOWN_LENGTH).replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let paragraph: string[] = [];
  let i = 0;

  const flush = () => {
    if (paragraph.length > 0) html.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  while (i < lines.length) {
    const line = lines[i]!;
    if (/^\s*$/.test(line)) {
      flush();
      i += 1;
      continue;
    }
    const fence = /^```/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i]!)) code.push(lines[i++]!);
      i += 1;
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      html.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      html.push('<hr>');
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!))
        quote.push(lines[i++]!.replace(/^>\s?/, ''));
      html.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`);
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = numbered !== null;
      const pattern = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      const items: string[] = [];
      while (i < lines.length) {
        const match = pattern.exec(lines[i]!);
        if (!match) break;
        items.push(`<li>${inline(match[1]!)}</li>`);
        i += 1;
      }
      html.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    paragraph.push(line.trim());
    i += 1;
  }
  flush();
  return sanitizeHtml(html.join('\n'));
}
