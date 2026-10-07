// The second check of the catalogue (M5 plan §2): a `.svelte` file may not write a user-visible text
// itself. Text nodes with letters in them, and the attributes a person reads or hears (`aria-label`,
// `title`, `placeholder`, `alt`), must be `{t('key')}`. It parses the component with the Svelte compiler,
// so a word inside an expression, a script or a style is not mistaken for text. Used by tests only.
import { parse } from 'svelte/compiler';

/** Attributes whose value a person reads or a screen reader speaks. */
const VISIBLE_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'title',
  'placeholder',
  'alt',
]);

export interface LiteralText {
  line: number;
  text: string;
}

interface Node {
  type: string;
  start: number;
  data?: string;
  name?: string;
  value?: unknown;
  [key: string]: unknown;
}

const hasLetter = (text: string) => /\p{L}/u.test(text);

export function findLiteralText(source: string): LiteralText[] {
  const found: LiteralText[] = [];
  const lineOf = (offset: number) => source.slice(0, offset).split('\n').length;
  const add = (node: Node, text: string) =>
    found.push({ line: lineOf(node.start), text: text.trim().replace(/\s+/g, ' ').slice(0, 60) });

  const visit = (value: unknown, inAttribute: string | undefined): void => {
    if (Array.isArray(value)) return value.forEach((item) => visit(item, inAttribute));
    if (typeof value !== 'object' || value === null) return;
    const node = value as Node;
    if (node.type === 'Text' && typeof node.data === 'string' && hasLetter(node.data)) {
      if (inAttribute === undefined || VISIBLE_ATTRIBUTES.has(inAttribute)) add(node, node.data);
      return;
    }
    if (node.type === 'Attribute') {
      visit(node.value, String(node.name).toLowerCase());
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'parent' || key === 'metadata') continue;
      visit(child, inAttribute);
    }
  };

  const root = parse(source, { modern: true }) as unknown as { fragment: unknown };
  visit(root.fragment, undefined);
  return found;
}
