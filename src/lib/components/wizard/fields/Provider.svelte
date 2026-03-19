<script lang="ts">
	import type { Provider } from '$lib/openapi/schemas';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';

	let { label = '', attr, value = $bindable(), showLabel = true } = $props();

	let providers: Provider[] = $state([]);

	onMount(async () => {
		if (!label) {
			label = attr;
		}

		const response = await fetch(resolve('/api/providers') + '?is_member=true');
		providers = await response.json();
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
			{#each providers as provider}
				<option value={provider.abbreviation}>{provider.name}</option>
			{/each}
		</select>
	</fieldset>
</section>
