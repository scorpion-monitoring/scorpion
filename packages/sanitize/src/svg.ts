// Sanitising of uploaded SVG. An SVG is a document that can run script, load other resources and
// embed HTML, so what is stored is not what was sent: DOMPurify keeps drawing elements, and
// everything that executes or fetches is removed (script, foreignObject, style, animation, event
// handlers, every reference that does not point inside the file).
import { createPurifier } from './dom.ts';

let purifier: ReturnType<typeof createPurifier> | undefined;

/** Elements that can run code, load something or embed another document, whatever the profile says. */
const FORBIDDEN_TAGS = [
  'script',
  'foreignObject',
  'style',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'image', // can load a remote or data: URL
  'a', // links out
  'animate',
  'animateMotion',
  'animateTransform',
  'set', // can set href or event attributes over time
  'handler',
  'listener',
  'discard',
  'use', // a reference to another document is refused below; inside the file it is not needed for a logo
];

function svg() {
  if (purifier) return purifier;
  const instance = createPurifier();
  instance.addHook('uponSanitizeAttribute', (_node, data) => {
    const name = data.attrName.toLowerCase();
    // Only a reference to something inside the file can stay (`url(#gradient)`, `#id`).
    if (name === 'href' || name === 'xlink:href') {
      if (!/^#[\w.:-]+$/.test(data.attrValue.trim())) data.keepAttr = false;
      return;
    }
    if (/url\(/i.test(data.attrValue) && !/^\s*url\(\s*#[\w.:-]+\s*\)\s*$/.test(data.attrValue)) {
      data.keepAttr = false;
    }
    if (/^on/.test(name) || name === 'style' || /expression\(|javascript:/i.test(data.attrValue)) {
      data.keepAttr = false;
    }
  });
  purifier = instance;
  return instance;
}

export class InvalidSvg extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSvg';
  }
}

const startsAt = (text: string, at: number, prefix: string) =>
  text.slice(at, at + prefix.length).toLowerCase() === prefix;

const endOf = (text: string, closer: string, from: number) => {
  const at = text.indexOf(closer, from);
  return at === -1 ? -1 : at + closer.length;
};

/**
 * Where the XML declaration, doctype or comment that starts at `at` ends: `at` when none starts
 * there, -1 when it is never closed. A doctype ends at the first `>` outside its `[...]` subset.
 */
function declarationEnd(text: string, at: number): number {
  if (startsAt(text, at, '<?xml')) return endOf(text, '?>', at + 5);
  if (startsAt(text, at, '<!--')) return endOf(text, '-->', at + 4);
  if (!startsAt(text, at, '<!doctype')) return at;
  for (let i = at + 9; i < text.length; i++) {
    if (text[i] === '>') return i + 1;
    if (text[i] === '[') {
      i = text.indexOf(']', i + 1);
      if (i === -1) return -1;
    }
  }
  return -1;
}

/**
 * The text without XML declarations, doctypes and comments, in one pass that never reads a
 * character twice. Regular expressions for the same job backtrack on an unclosed `<?xml`,
 * `<!DOCTYPE` or `<!--` and took minutes for a small upload (CodeQL js/polynomial-redos). An unclosed
 * one ends the scan: the rest stays as it is, and DOMPurify reads it as text or a comment.
 */
function stripDeclarations(text: string): string {
  let out = '';
  let kept = 0;
  let at = text.indexOf('<');
  while (at !== -1) {
    const end = declarationEnd(text, at);
    if (end === -1) break;
    if (end === at) {
      at = text.indexOf('<', at + 1);
    } else {
      out += text.slice(kept, at);
      kept = end;
      at = text.indexOf('<', end);
    }
  }
  return out + text.slice(kept);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * The sanitised SVG as text, always with an `<svg>` root and the SVG namespace. Throws `InvalidSvg`
 * when the input is not an SVG document or when nothing is left of it.
 */
export function sanitizeSvg(source: string): string {
  // The prolog, doctype and comments are dropped: a doctype can declare entities, and the output is
  // a fresh document.
  const body = stripDeclarations(source.replace(/^\uFEFF/, '')).trim();
  if (!/^<svg[\s>/]/i.test(body)) throw new InvalidSvg('The file is not an SVG document.');
  const clean = svg()
    .sanitize(body, {
      USE_PROFILES: { svg: true },
      FORBID_TAGS: FORBIDDEN_TAGS,
      FORBID_ATTR: ['style'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      RETURN_TRUSTED_TYPE: false,
    })
    .trim();
  if (!/^<svg[\s>/]/i.test(clean)) throw new InvalidSvg('The file is not an SVG document.');
  // The HTML serialisation has no namespace declarations; a standalone SVG needs them.
  return clean.replace(/^<svg\b([^>]*)>/i, (_match, attributes: string) => {
    let declared = attributes;
    if (!/\sxmlns\s*=/.test(declared)) declared += ` xmlns="${SVG_NS}"`;
    if (/\sxlink:/.test(clean) && !/\sxmlns:xlink\s*=/.test(declared)) {
      declared += ` xmlns:xlink="${XLINK_NS}"`;
    }
    return `<svg${declared}>`;
  });
}
