// One place that builds and checks the paths of the application under `BASE_PATH` (defect 11: the
// legacy app assumed a one-segment base). Shared by the server's redirects and the web app.

/** `/` or a path like `/a/b`: no trailing slash, no empty or dot segments. Same rule as `BASE_PATH`. */
const BASE_PATH = /^\/([A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*)?$/;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
// eslint-disable-next-line no-control-regex -- the point is to refuse them
const CONTROL = /[\u0000-\u001f\u007f\\]/;
/** A host that cannot exist, so a path that resolves against it stayed a path. */
const PROBE = 'http://local.invalid';

/** The prefix for a `BASE_PATH`: `''` for the root, else `/a/b`. Throws for a value the server would refuse. */
export function basePrefix(basePath: string): string {
  if (!BASE_PATH.test(basePath) || basePath.split('/').some((s) => s === '.' || s === '..')) {
    throw new Error('BASE_PATH must be "/" or a path like "/a/b" (no trailing slash)');
  }
  return basePath === '/' ? '' : basePath;
}

/** Splits `/path?query#fragment` so that the path can be checked on its own. */
function split(target: string): { path: string; rest: string } {
  const cut = target.search(/[?#]/);
  return cut === -1
    ? { path: target, rest: '' }
    : { path: target.slice(0, cut), rest: target.slice(cut) };
}

function hasDotSegment(path: string): boolean {
  return path.split('/').some((segment) => {
    try {
      const decoded = decodeURIComponent(segment);
      return decoded === '.' || decoded === '..';
    } catch {
      return true; // a broken escape is not a path we build
    }
  });
}

/**
 * The URL path of `target` (a path of the application such as `/login` or `/a?x=1#y`) under `basePath`.
 * Works for any number of base segments, keeps a trailing slash as written, and keeps the query and
 * the fragment. Refuses what is not a path of this application: an absolute URL, a scheme-relative
 * `//host`, a backslash, a control character, a dot segment (`..`, also percent-encoded).
 */
export function url(basePath: string, target: string): string {
  const prefix = basePrefix(basePath);
  const { path, rest } = split(target);
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    SCHEME.test(target) ||
    CONTROL.test(target) ||
    hasDotSegment(path)
  ) {
    throw new Error('url() takes a path of this application that starts with a single "/"');
  }
  return `${prefix}${path}${rest}`;
}

/**
 * `pathname` without the base: `/a/b/x` → `/x`, `/a/b` → `/`. `undefined` when the path is not under
 * the base (`/a/bc` is not under `/a/b`).
 */
export function stripBase(basePath: string, pathname: string): string | undefined {
  const prefix = basePrefix(basePath);
  if (prefix === '') return pathname.startsWith('/') ? pathname : undefined;
  if (pathname === prefix) return '/';
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : undefined;
}

/**
 * Whether `candidate` (a `returnTo` from the query string) is a path on this instance: it starts with
 * a single `/`, names no host or scheme, holds no backslash or control character, and lies under
 * `basePath`. The open-redirect check: anything else is replaced by the start page.
 */
export function isLocalPath(basePath: string, candidate: unknown): candidate is string {
  if (typeof candidate !== 'string' || candidate === '') return false;
  if (!candidate.startsWith('/') || candidate.startsWith('//') || CONTROL.test(candidate)) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate, PROBE);
  } catch {
    return false;
  }
  if (parsed.origin !== PROBE) return false;
  return (
    stripBase(basePath, parsed.pathname) !== undefined && !hasDotSegment(split(candidate).path)
  );
}
