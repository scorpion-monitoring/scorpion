<script lang="ts">
  import { iconShapes } from '@scorpion/contracts/icons';

  // A small set of outline icons, drawn on a 24 x 24 grid. A name that is not here shows a dot, so a
  // typo in a navigation entry cannot break a page.
  let { name, size = 20 }: { name: string; size?: number } = $props();

  const path = $derived(iconShapes[name] ?? iconShapes.dot);
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
