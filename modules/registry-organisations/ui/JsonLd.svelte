<script lang="ts">
  // The JSON-LD block of the organisation page (ADR-0033, plan Decision 17). The one place in the product
  // where organisation data is written into the document without Svelte's escaping, and the only file that
  // may use `{@html}` apart from ui-kit's SafeHtml (the ESLint override names exactly this path).
  //
  // The only input of the `{@html}` is the output of `serializeJsonLd`: JSON in which `<`, `>`, `&` and the
  // line separators are `\u` escapes, so the text can neither end the script block nor open a comment. The
  // tags around it are constants. A script of type `application/ld+json` is a data block: it is never
  // executed, so the CSP needs no allowance and no nonce for it.
  import { serializeJsonLd } from '../service/schema-org.ts';

  let { profile }: { profile: unknown } = $props();

  const block = $derived(
    `<script type="application/ld+json">${serializeJsonLd(profile)}<` + '/script>',
  );
</script>

<svelte:head>
  {@html block}
</svelte:head>
