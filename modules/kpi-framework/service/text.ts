// Two small pure helpers of the services: the slug made from a name and the escaping of a `like` pattern.

/** The slug rule of a service (ADR-0035): a path-safe key, 1 to 64 characters. */
export const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const MAX_SLUG_LENGTH = 64;

/** Escapes `\`, `%` and `_` so that a search text is matched as typed (`escape '\'` in the query). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * A slug from a name: accents are folded (`Größe` → `grosse`, `é` → `e`), everything that is not a letter or a
 * digit becomes one `-`, the ends are trimmed, and the result is at most 64 characters. A name with nothing
 * left (`***`) gives `fallback`. The result always matches `SLUG_PATTERN`. Loops, not regular expressions, for
 * the runs: no backtracking on a long input.
 */
export function slugFromName(name: string, fallback: string): string {
  const folded = name
    .replaceAll('ß', 'ss')
    .replaceAll('Æ', 'AE')
    .replaceAll('æ', 'ae')
    .replaceAll('Ø', 'O')
    .replaceAll('ø', 'o')
    .normalize('NFKD')
    .toLowerCase();
  let slug = '';
  let pendingDash = false;
  for (const char of folded) {
    const isAlnum = (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9');
    if (isAlnum) {
      if (pendingDash && slug !== '') slug += '-';
      pendingDash = false;
      slug += char;
    } else if (!/\p{M}/u.test(char)) {
      // A combining mark (the accent left by NFKD) is dropped without splitting the word.
      pendingDash = true;
    }
    if (slug.length >= MAX_SLUG_LENGTH) break;
  }
  slug = slug.slice(0, MAX_SLUG_LENGTH);
  while (slug.endsWith('-')) slug = slug.slice(0, -1);
  return slug === '' ? fallback : slug;
}

/** `base`, then `base-2`, `base-3`, … cut so that the whole stays within 64 characters. */
export function slugCandidate(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  const suffix = `-${attempt}`;
  let head = base.slice(0, MAX_SLUG_LENGTH - suffix.length);
  while (head.endsWith('-')) head = head.slice(0, -1);
  return `${head}${suffix}`;
}
