/**
 * Gives a page's `style-src` the nonce SvelteKit put on its `script-src`.
 *
 * In a build SvelteKit adds a style nonce only when it inlines CSS itself, which it does not, so the policy says
 * `style-src 'self'`. The dashboard's drag library (dnd-kit) writes `<style>` elements while a tile is dragged and
 * signs them with the page's nonce (`packages/ui-kit/src/dashboard-grid/Provider.svelte`); without the nonce in
 * `style-src` the browser drops them and the dragged tile stays where it was (ADR-0042). The dev server allows
 * inline styles, so this never shows there.
 *
 * A policy that already allows inline styles (the API reference, ADR-0038) is left alone: a nonce would make the
 * browser ignore its `'unsafe-inline'`. So is one with no script nonce or with a style nonce already.
 */
export function withStyleNonce(policy: string): string {
  const directives = policy.split(';').map((part) => part.trim());
  const nonce = directives
    .find((part) => part.startsWith('script-src '))
    ?.match(/'nonce-[^']+'/)?.[0];
  if (!nonce) return policy;
  const index = directives.findIndex((part) => part.startsWith('style-src '));
  const style = directives[index];
  if (!style || style.includes("'nonce-") || style.includes("'unsafe-inline'")) return policy;
  directives[index] = `${style} ${nonce}`;
  return directives.filter((part) => part !== '').join('; ');
}

/** The directives the usage tracker needs (ADR-0054): the script, its hits (`sendBeacon`/`fetch`) and its image fallback. */
const TRACKER_DIRECTIVES = ['script-src', 'connect-src', 'img-src'] as const;

/** An `https:` origin and nothing else (no wildcard), so no value can add a source or a directive to the header. */
function isHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value && !value.includes('*');
  } catch {
    return false;
  }
}

/**
 * Allows one more origin, the configured Matomo's, in `script-src`, `connect-src` and `img-src` of a page's policy (ADR-0054).
 * Only a page's policy (one with a script nonce) is changed, never with `'unsafe-inline'`, and a directive the policy does
 * not have is not added (`default-src` stays the fallback). Anything but a plain `https:` origin changes nothing.
 */
export function withExtraOrigin(policy: string, origin: string | null): string {
  if (origin === null || !isHttpsOrigin(origin)) return policy;
  const directives = policy.split(';').map((part) => part.trim());
  const script = directives.find((part) => part.startsWith('script-src '));
  if (!script?.includes("'nonce-")) return policy;
  return directives
    .filter((part) => part !== '')
    .map((part) => {
      const [name, ...sources] = part.split(/\s+/);
      if (!TRACKER_DIRECTIVES.includes(name as (typeof TRACKER_DIRECTIVES)[number])) return part;
      return sources.includes(origin) ? part : `${part} ${origin}`;
    })
    .join('; ');
}
