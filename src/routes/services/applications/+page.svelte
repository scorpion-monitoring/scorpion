<script lang="ts">
	import { resolve } from '$app/paths';
	import MaturityRadar from '$lib/components/visualization/MaturityRadar.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let selectedService: any = $state(null);
</script>

<div class="space-y-4 p-4">
	<div class="flex items-center gap-4">
		<select class="select" bind:value={selectedService}>
			<option disabled selected value={null}>Choose a service</option>
			{#each data.applications as application}
				<option value={application}>{application.serviceName}</option>
			{/each}
		</select>
		{#if selectedService}
			<input
				type="text"
				placeholder="Service Abbreviation"
				class="input-bordered input w-full max-w-xs"
			/>
			<select class="select">
				<option disabled selected value={null}>Choose a Service Provider</option>
				{#each data.providers as provider}
					<option value={provider}>{provider.name}</option>
				{/each}
			</select>
			<select class="select">
				<option disabled selected value={null}>Choose a Service Category</option>
				{#each data.categories as category}
					<option value={category}>{category.name}</option>
				{/each}
			</select>
			<button class="btn btn-success" onclick={() => (selectedService = null)}>Approve</button>
			<button class="btn btn-error" onclick={() => (selectedService = null)}>Decline</button>
		{/if}
	</div>
	{#if selectedService}
		{#await fetch(resolve(`/api/maturitymodel`) + `?model=${selectedService.maturityModel}`).then( (res) => res.json() )}
			<p>Loading maturity model...</p>
		{:then model}
			{#key model}
				<MaturityRadar {model} bind:value={selectedService} />
			{/key}
		{/await}
	{/if}
</div>
