// Sanitising of HTML that the server produced from Markdown (legal texts). The Markdown renderer
// escapes raw HTML already; DOMPurify is the second, independent layer (CLAUDE.md security rules).
import { createPurifier } from './dom.ts';

const TAGS = [
  'a',
  'blockquote',
  'br',
  'code',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'strong',
  'ul',
];

let purifier: ReturnType<typeof createPurifier> | undefined;

function html() {
  if (purifier) return purifier;
  const instance = createPurifier();
  // Links leave the page without a referrer and without a handle on it; only these schemes work.
  instance.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('rel', 'noopener noreferrer');
      node.setAttribute('target', '_blank');
    }
  });
  purifier = instance;
  return instance;
}

/**
 * Strips everything but the formatting tags of `TAGS` and the `href` of links (`http:`, `https:`,
 * `mailto:`, and relative or fragment links). Scripts, handlers, styles, forms, images and data
 * attributes never survive.
 */
export function sanitizeHtml(dirty: string): string {
  return html().sanitize(dirty, {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ['href', 'title'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/(?!\/))/i,
    RETURN_TRUSTED_TYPE: false,
  });
}
