<script lang="ts">
	import { onMount } from 'svelte';

	let { label = '', attr, value = $bindable(), showLabel = true } = $props();

	onMount(() => {
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
		<input type="text" class="input w-full" bind:value />
	</fieldset>
</section>
