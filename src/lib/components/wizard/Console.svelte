<script lang="ts">
	import { serviceStr } from '$lib/service';
</script>

<details class="mb-4 w-full">
	<summary class="cursor-pointer font-semibold">Debug Service JSON</summary>
	<div class="mt-2 rounded-lg border border-neutral-300 p-2">
		<textarea class="h-full min-h-[30vh] w-full focus-visible:outline-none" bind:value={$serviceStr}
		></textarea>
	</div>
</details>
