<script lang="ts">
  // The only place in the application that renders HTML from a string. The text must have been made
  // safe on the server (Markdown rendered and cleaned by DOMPurify, `packages/sanitize`); a lint rule
  // bans `{@html}` everywhere else, so a new use has to come through here and through review.
  let { html }: { html: string } = $props();
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- the one allowed use, see above -->
<div>{@html html}</div>
