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
