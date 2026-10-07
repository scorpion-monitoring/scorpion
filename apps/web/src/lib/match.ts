// Resolves a request path against the page patterns of the modules (ADR-0027). Segments only: no
// regular expression is built from a module's pattern, so a pattern cannot cause backtracking, and the
// request path is taken apart before anything is compared.

/**
 * The decoded segments of a path, or `undefined` for a path that is not one we serve: an empty segment
 * (`//`), `.` or `..` (also percent-encoded), an encoded `/` or `\`, a control character, or a broken
 * escape. One trailing slash is allowed (`/docs/` is `/docs`).
 */
export function splitPath(pathname: string): string[] | undefined {
  if (!pathname.startsWith('/')) return undefined;
  if (pathname === '/') return [];
  const raw = (pathname.endsWith('/') ? pathname.slice(0, -1) : pathname).slice(1).split('/');
  const segments: string[] = [];
  for (const part of raw) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return undefined;
    }
    if (decoded === '' || decoded === '.' || decoded === '..' || hasForbiddenChar(decoded)) {
      return undefined;
    }
    segments.push(decoded);
  }
  return segments;
}

/** `/`, `\`, and the control characters (including NUL and DEL) never belong in a segment. */
function hasForbiddenChar(segment: string): boolean {
  for (const char of segment) {
    const code = char.codePointAt(0)!;
    if (char === '/' || char === '\\' || code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export interface Match {
  pattern: string;
  params: Record<string, string>;
}

/** The pattern that fits the path best: at the first segment where two fit differently, the fixed word wins. */
export function resolvePath(patterns: readonly string[], pathname: string): Match | undefined {
  const segments = splitPath(pathname);
  if (!segments) return undefined;
  let best: { pattern: string; parts: string[]; params: Record<string, string> } | undefined;
  for (const pattern of patterns) {
    const parts = pattern === '/' ? [] : pattern.slice(1).split('/');
    if (parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const fits = parts.every((part, index) => {
      const segment = segments[index]!;
      if (part.startsWith(':')) {
        params[part.slice(1)] = segment;
        return true;
      }
      return part === segment;
    });
    if (!fits) continue;
    if (!best || moreSpecific(parts, best.parts)) best = { pattern, parts, params };
  }
  return best && { pattern: best.pattern, params: best.params };
}

function moreSpecific(a: string[], b: string[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const aParam = a[i]!.startsWith(':');
    const bParam = b[i]!.startsWith(':');
    if (aParam !== bParam) return !aParam;
  }
  return false;
}
