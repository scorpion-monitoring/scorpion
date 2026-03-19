<script lang="ts">
	import { onMount } from 'svelte';

	let { label = '', attr, value = $bindable(), showLabel = true } = $props();

	let licenses: { spdx_id: string; name: string }[] = $state([]);

	onMount(async () => {
		if (!label) {
			label = attr;
		}

		const response = await fetch('https://api.github.com/licenses');
		licenses = await response.json();
		return;
	});
</script>

<section class="px-4">
	<fieldset class="fieldset">
		{#if showLabel}
			<legend class="fieldset-legend">{label}</legend>
		{/if}
		<select bind:value class="input w-full">
			<option value="" disabled>Select a {label}</option>
			{#each licenses as license}
				<option value={license.spdx_id}>{license.name}</option>
			{/each}
		</select>
	</fieldset>
</section>
