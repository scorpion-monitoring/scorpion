// The file a person saves from an export (M11 sprint 5). Pure: the name the server gave. The bytes are saved with `saveBlob` of the UI kit. No URL is built here: the typed client sends the request.

/**
 * The file name a download should have: the one the server named in `Content-Disposition` (the service's abbreviation, the range and the
 * extension), else `fallback`. Never a path.
 */
export function fileNameOf(header: string | null, fallback: string): string {
  const match = header && /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  let raw = '';
  if (match) {
    try {
      raw = decodeURIComponent(match[1]!);
    } catch {
      // a malformed escape is no name
    }
  }
  const name = raw.split(/[\\/]/).pop()?.trim();
  return name ? name : fallback;
}
