<script lang="ts">
	import { onMount } from 'svelte';

	let { label = '', attr, value = $bindable(), showLabel = true, mapping = {} } = $props();

	onMount(async () => {
		if (!label) {
			label = attr;
		}
	});
</script>

<section class="px-4">
	<fieldset class="fieldset">
		{#if showLabel}
			<legend class="fieldset-legend">{label}</legend>
		{/if}
		<select bind:value class="input w-full">
			<option value="" disabled>Select a {label}</option>
			{#each mapping.options as option}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
	</fieldset>
</section>
