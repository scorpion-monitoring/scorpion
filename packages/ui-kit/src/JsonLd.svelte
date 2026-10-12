<script lang="ts">
  // The JSON-LD block of a page (ADR-0033, ADR-0036; plan Decision 17, M7 Decision 15). The one place in the
  // product where record data is written into the document without Svelte's escaping, and the only file that
  // may use `{@html}` apart from SafeHtml (the ESLint override names exactly this path). It serves the
  // organisation page and the service page.
  //
  // The only input of the `{@html}` is the output of `serializeJsonLd` (registry.organisations/public): JSON in
  // which `<`, `>`, `&` and the line separators are `\u` escapes, so the text can neither end the script block
  // nor open a comment. The component does not trust its caller: a string that holds one of those characters or
  // is not JSON is refused (it throws, so a mistake shows in development and renders nothing in a page). The tags
  // around the text are constants. A script of type `application/ld+json` is a data block: it is never executed,
  // so the CSP needs no allowance and no nonce for it.
  let { json }: { json: string } = $props();

  /** What `serializeJsonLd` guarantees, checked again here. */
  function checked(text: string): string {
    if (/[<>&\u2028\u2029]/.test(text)) {
      throw new Error('JsonLd: the text is not the output of serializeJsonLd');
    }
    JSON.parse(text);
    return text;
  }

  const block = $derived(`<script type="application/ld+json">${checked(json)}<` + '/script>');
</script>

<svelte:head>
  {@html block}
</svelte:head>
