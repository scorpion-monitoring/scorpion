<script lang="ts">
  import { iconShapes } from '@scorpion/contracts/icons';

  // A small set of outline icons on a 24 x 24 grid (the closed table of `@scorpion/contracts/icons`). A name that
  // is not there shows a dot, so a typo in a registry entry cannot break a page. Always decorative: the button
  // or link that holds it carries the name.
  let { name, size = 20 }: { name: string; size?: number } = $props();

  const path = $derived(Object.hasOwn(iconShapes, name) ? iconShapes[name]! : iconShapes.dot!);
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  <path d={path} />
</svg>
